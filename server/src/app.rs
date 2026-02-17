use std::{
    collections::{HashMap, HashSet},
    env,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use crate::types::*;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use futures_util::{sink::SinkExt, stream::StreamExt};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use tokio::sync::{mpsc, Mutex};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}

fn json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn parse_json_text(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or(Value::Null)
}

async fn persist_session(pool: &PgPool, session: &Session) {
    let _ = sqlx::query(
        r#"
        INSERT INTO sessions (
            id, tenant_id, created_at, updated_at, channel, assignee_agent_id, inbox_id, team_id, flow_id,
            handover_active, status, priority, contact_id, visitor_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            updated_at = EXCLUDED.updated_at,
            channel = EXCLUDED.channel,
            assignee_agent_id = EXCLUDED.assignee_agent_id,
            inbox_id = EXCLUDED.inbox_id,
            team_id = EXCLUDED.team_id,
            flow_id = EXCLUDED.flow_id,
            handover_active = EXCLUDED.handover_active,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            contact_id = EXCLUDED.contact_id,
            visitor_id = EXCLUDED.visitor_id
        "#,
    )
    .bind(&session.id)
    .bind(&session.tenant_id)
    .bind(&session.created_at)
    .bind(&session.updated_at)
    .bind(&session.channel)
    .bind(&session.assignee_agent_id)
    .bind(&session.inbox_id)
    .bind(&session.team_id)
    .bind(&session.flow_id)
    .bind(session.handover_active)
    .bind(&session.status)
    .bind(&session.priority)
    .bind(&session.contact_id)
    .bind(&session.visitor_id)
    .execute(pool)
    .await;
}

async fn persist_message(pool: &PgPool, message: &ChatMessage) {
    let widget = message.widget.as_ref().map(json_text);
    let suggestions =
        serde_json::to_string(&message.suggestions).unwrap_or_else(|_| "[]".to_string());
    let _ = sqlx::query(
        r#"
        INSERT INTO chat_messages (id, session_id, sender, text, suggestions, widget, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(&message.id)
    .bind(&message.session_id)
    .bind(&message.sender)
    .bind(&message.text)
    .bind(suggestions)
    .bind(widget)
    .bind(&message.created_at)
    .execute(pool)
    .await;
}

async fn get_session_summary_db(pool: &PgPool, session_id: &str) -> Option<SessionSummary> {
    let session_row = sqlx::query(
        "SELECT id, tenant_id, created_at, updated_at, channel, assignee_agent_id, inbox_id, team_id, flow_id, handover_active, status, priority, contact_id FROM sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;

    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM chat_messages WHERE session_id = $1")
            .bind(session_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as usize;

    let last_message_row = sqlx::query(
        "SELECT id, session_id, sender, text, suggestions, widget, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let last_message = last_message_row.map(|row| ChatMessage {
        id: row.get("id"),
        session_id: row.get("session_id"),
        sender: row.get("sender"),
        text: row.get("text"),
        suggestions: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("suggestions"))
            .unwrap_or_default(),
        widget: row
            .get::<Option<String>, _>("widget")
            .map(|v| parse_json_text(&v))
            .filter(|v| !v.is_null()),
        created_at: row.get("created_at"),
    });

    Some(SessionSummary {
        tenant_id: session_row.get("tenant_id"),
        id: session_row.get("id"),
        created_at: session_row.get("created_at"),
        updated_at: session_row.get("updated_at"),
        last_message,
        message_count: count,
        channel: session_row.get("channel"),
        assignee_agent_id: session_row.get("assignee_agent_id"),
        inbox_id: session_row.get("inbox_id"),
        team_id: session_row.get("team_id"),
        flow_id: session_row.get("flow_id"),
        contact_id: session_row.get("contact_id"),
        handover_active: session_row.get("handover_active"),
        status: session_row.get("status"),
        priority: session_row.get("priority"),
    })
}

async fn get_session_messages_db(pool: &PgPool, session_id: &str) -> Vec<ChatMessage> {
    let rows = sqlx::query(
        "SELECT id, session_id, sender, text, suggestions, widget, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|row| ChatMessage {
            id: row.get("id"),
            session_id: row.get("session_id"),
            sender: row.get("sender"),
            text: row.get("text"),
            suggestions: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("suggestions"))
                .unwrap_or_default(),
            widget: row
                .get::<Option<String>, _>("widget")
                .map(|v| parse_json_text(&v))
                .filter(|v| !v.is_null()),
            created_at: row.get("created_at"),
        })
        .collect()
}

async fn get_flow_by_id_db(pool: &PgPool, flow_id: &str) -> Option<ChatFlow> {
    let row = sqlx::query(
        "SELECT id, tenant_id, name, description, enabled, created_at, updated_at, nodes, edges, input_variables, ai_tool, ai_tool_description FROM flows WHERE id = $1",
    )
    .bind(flow_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;
    Some(ChatFlow {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        name: row.get("name"),
        description: row.get("description"),
        enabled: row.get("enabled"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        nodes: serde_json::from_str::<Vec<FlowNode>>(&row.get::<String, _>("nodes"))
            .unwrap_or_default(),
        edges: serde_json::from_str::<Vec<FlowEdge>>(&row.get::<String, _>("edges"))
            .unwrap_or_default(),
        input_variables: serde_json::from_str(&row.get::<String, _>("input_variables"))
            .unwrap_or_default(),
        ai_tool: row.get("ai_tool"),
        ai_tool_description: row.get("ai_tool_description"),
    })
}

fn first_http_url(text: &str) -> Option<String> {
    // Prefer markdown destination URLs, e.g. [label](https://real-link.example)
    let markdown_regex = Regex::new(r#"(?is)\[[^\]]*\]\(\s*(https?://[^)\s]+)\s*\)"#).ok()?;
    if let Some(capture) = markdown_regex.captures(text) {
        if let Some(url) = capture.get(1) {
            let cleaned = url
                .as_str()
                .trim()
                .trim_end_matches(&['.', ',', ';', ')', ']'][..])
                .to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }

    // Fallback to plain URL detection.
    let regex = Regex::new(r#"https?://[^\s<>()"]+"#).ok()?;
    let capture = regex.find(text)?;
    Some(
        capture
            .as_str()
            .trim_end_matches(&['.', ',', ';', ')', ']'][..])
            .to_string(),
    )
}

fn extract_meta_tag(html: &str, property: &str) -> Option<String> {
    let pattern = format!(
        r#"(?is)<meta[^>]+(?:property|name)\s*=\s*["']{}["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>"#,
        regex::escape(property)
    );
    let regex = Regex::new(&pattern).ok()?;
    regex
        .captures(html)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|v| !v.is_empty())
}

fn extract_title_tag(html: &str) -> Option<String> {
    let regex = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    regex
        .captures(html)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().replace('\n', " ").trim().to_string())
        .filter(|v| !v.is_empty())
}

fn is_visitor_visible_system_msg(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("ended the chat")
        || lower.contains("conversation closed")
        || lower.contains("reopened")
}

fn visible_messages_for_widget(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    messages
        .iter()
        .filter(|message| {
            if message.sender == "team" {
                return false;
            }
            if message.sender == "system" {
                return is_visitor_visible_system_msg(&message.text);
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>()
}

fn event_payload<T: Serialize>(event: &str, data: T) -> Option<String> {
    serde_json::to_string(&json!({ "event": event, "data": data })).ok()
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let header = headers.get("authorization")?.to_str().ok()?;
    let token = header.strip_prefix("Bearer ")?;
    Some(token.trim().to_string())
}

async fn auth_agent_from_headers(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<AgentProfile, (StatusCode, Json<Value>)> {
    let token = bearer_token(headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "missing bearer token" })),
    ))?;

    let row = sqlx::query(
        "SELECT a.id, a.name, a.email, a.status, a.team_ids, a.inbox_ids FROM auth_tokens t JOIN agents a ON a.id = t.agent_id WHERE t.token = $1",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "invalid token" })),
    ))?;
    let profile = AgentProfile {
        id: row.get("id"),
        name: row.get("name"),
        email: row.get("email"),
        status: row.get("status"),
        team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
            .unwrap_or_default(),
        inbox_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("inbox_ids"))
            .unwrap_or_default(),
    };
    Ok(profile)
}

async fn auth_tenant_from_headers(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<String, (StatusCode, Json<Value>)> {
    let token = bearer_token(headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "missing bearer token" })),
    ))?;

    let tenant_id =
        sqlx::query_scalar::<_, String>("SELECT tenant_id FROM auth_tokens WHERE token = $1")
            .bind(&token)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| state.default_tenant_id.clone());

    Ok(tenant_id)
}

async fn emit_to_client<T: Serialize>(
    state: &Arc<AppState>,
    client_id: usize,
    event: &str,
    data: T,
) {
    let Some(payload) = event_payload(event, data) else {
        return;
    };

    let tx = {
        let rt = state.realtime.lock().await;
        rt.clients.get(&client_id).cloned()
    };

    if let Some(sender) = tx {
        let _ = sender.send(payload);
    }
}

async fn emit_to_clients<T: Serialize + Clone>(
    state: &Arc<AppState>,
    client_ids: &[usize],
    event: &str,
    data: T,
) {
    let Some(payload) = event_payload(event, data) else {
        return;
    };

    let senders = {
        let rt = state.realtime.lock().await;
        client_ids
            .iter()
            .filter_map(|id| rt.clients.get(id).cloned())
            .collect::<Vec<_>>()
    };

    for sender in senders {
        let _ = sender.send(payload.clone());
    }
}

async fn emit_session_snapshot(state: Arc<AppState>) {
    let mut list = {
        let rows = sqlx::query("SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 500")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let session_id: String = row.get("id");
            if let Some(summary) = get_session_summary_db(&state.db, &session_id).await {
                items.push(summary);
            }
        }
        items
    };

    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let agents = {
        let rt = state.realtime.lock().await;
        rt.agents.iter().copied().collect::<Vec<_>>()
    };

    emit_to_clients(&state, &agents, "sessions:list", list).await;
}

async fn emit_session_update(state: &Arc<AppState>, summary: SessionSummary) {
    let agents = {
        let rt = state.realtime.lock().await;
        rt.agents.iter().copied().collect::<Vec<_>>()
    };
    emit_to_clients(state, &agents, "session:updated", summary).await;
}

async fn session_realtime_recipients(state: &Arc<AppState>, session_id: &str) -> Vec<usize> {
    let rt = state.realtime.lock().await;
    let mut recipients = HashSet::new();
    if let Some(watchers) = rt.session_watchers.get(session_id) {
        recipients.extend(watchers.iter().copied());
    }
    recipients.extend(rt.agents.iter().copied());
    recipients.into_iter().collect::<Vec<_>>()
}

fn session_agent_typing_active(rt: &RealtimeState, session_id: &str) -> bool {
    let auto = rt
        .agent_auto_typing_counts
        .get(session_id)
        .copied()
        .unwrap_or_default();
    let human = rt
        .agent_human_typers
        .get(session_id)
        .map(|set| !set.is_empty())
        .unwrap_or(false);
    auto > 0 || human
}

async fn emit_typing_state(state: &Arc<AppState>, session_id: &str, active: bool) {
    let recipients = session_realtime_recipients(state, session_id).await;

    emit_to_clients(
        state,
        &recipients,
        "typing",
        json!({
            "sessionId": session_id,
            "sender": "agent",
            "active": active
        }),
    )
    .await;
}

async fn emit_visitor_typing(state: &Arc<AppState>, session_id: &str, text: &str, active: bool) {
    let recipients = {
        let rt = state.realtime.lock().await;
        rt.agents.iter().copied().collect::<Vec<_>>()
    };

    emit_to_clients(
        state,
        &recipients,
        "visitor:typing",
        json!({
            "sessionId": session_id,
            "text": text,
            "active": active
        }),
    )
    .await;
}

async fn is_agent_typing(state: &Arc<AppState>, session_id: &str) -> bool {
    let rt = state.realtime.lock().await;
    session_agent_typing_active(&rt, session_id)
}

async fn start_agent_typing(state: Arc<AppState>, session_id: &str) {
    let should_emit_active = {
        let mut rt = state.realtime.lock().await;
        let was_active = session_agent_typing_active(&rt, session_id);
        let count = rt
            .agent_auto_typing_counts
            .entry(session_id.to_string())
            .or_insert(0);
        *count += 1;
        let now_active = session_agent_typing_active(&rt, session_id);
        !was_active && now_active
    };

    if should_emit_active {
        emit_typing_state(&state, session_id, true).await;
    }
}

async fn stop_agent_typing(state: Arc<AppState>, session_id: &str) {
    let should_emit_inactive = {
        let mut rt = state.realtime.lock().await;
        let was_active = session_agent_typing_active(&rt, session_id);
        if let Some(count) = rt.agent_auto_typing_counts.get_mut(session_id) {
            if *count > 1 {
                *count -= 1;
            } else {
                rt.agent_auto_typing_counts.remove(session_id);
            }
        }
        let now_active = session_agent_typing_active(&rt, session_id);
        was_active && !now_active
    };

    if should_emit_inactive {
        emit_typing_state(&state, session_id, false).await;
    }
}

async fn set_agent_human_typing(
    state: Arc<AppState>,
    client_id: usize,
    session_id: &str,
    active: bool,
) {
    let changed = {
        let mut rt = state.realtime.lock().await;
        let mut affected = HashSet::<String>::new();

        if let Some(existing) = rt.agent_human_typing_session.get(&client_id) {
            affected.insert(existing.clone());
        }
        if !session_id.is_empty() {
            affected.insert(session_id.to_string());
        }

        let before = affected
            .iter()
            .map(|sid| (sid.clone(), session_agent_typing_active(&rt, sid)))
            .collect::<HashMap<_, _>>();

        if active {
            if session_id.is_empty() {
                return;
            }

            if let Some(previous) = rt
                .agent_human_typing_session
                .insert(client_id, session_id.to_string())
            {
                if previous != session_id {
                    if let Some(set) = rt.agent_human_typers.get_mut(&previous) {
                        set.remove(&client_id);
                    }
                }
            }

            rt.agent_human_typers
                .entry(session_id.to_string())
                .or_default()
                .insert(client_id);
        } else if let Some(previous) = rt.agent_human_typing_session.remove(&client_id) {
            if let Some(set) = rt.agent_human_typers.get_mut(&previous) {
                set.remove(&client_id);
            }
        } else if !session_id.is_empty() {
            if let Some(set) = rt.agent_human_typers.get_mut(session_id) {
                set.remove(&client_id);
            }
        }

        affected
            .iter()
            .filter_map(|sid| {
                let was = *before.get(sid).unwrap_or(&false);
                let now = session_agent_typing_active(&rt, sid);
                if was != now {
                    Some((sid.clone(), now))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    };

    for (sid, is_active) in changed {
        emit_typing_state(&state, &sid, is_active).await;
    }
}

/// Given a visitor_id, look up any previous session that already has a contact_id.
/// If found, link that contact to the given session_id and store the visitor_id.
/// This enables persistent identity across multiple conversations.
async fn resolve_contact_from_visitor_id(
    state: &Arc<AppState>,
    session_id: &str,
    visitor_id: &str,
) {
    if visitor_id.is_empty() {
        return;
    }

    // Store the visitor_id on the session
    let _ = sqlx::query("UPDATE sessions SET visitor_id = $1 WHERE id = $2")
        .bind(visitor_id)
        .bind(session_id)
        .execute(&state.db)
        .await;

    // Skip if session already has a contact
    let existing: Option<Option<String>> =
        sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    if let Some(Some(ref cid)) = existing {
        if !cid.is_empty() {
            return;
        }
    }

    // Find the most recent other session with this visitor_id that has a contact
    let prev_contact: Option<String> = sqlx::query_scalar(
        "SELECT contact_id FROM sessions \
         WHERE visitor_id = $1 AND id != $2 AND contact_id IS NOT NULL AND contact_id != '' \
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(visitor_id)
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(cid) = prev_contact {
        let _ = sqlx::query("UPDATE sessions SET contact_id = $1 WHERE id = $2")
            .bind(&cid)
            .bind(session_id)
            .execute(&state.db)
            .await;

        // Update contact last_seen_at
        let _ = sqlx::query("UPDATE contacts SET last_seen_at = $1 WHERE id = $2")
            .bind(now_iso())
            .bind(&cid)
            .execute(&state.db)
            .await;

        if let Some(summary) = get_session_summary_db(&state.db, session_id).await {
            emit_session_update(state, summary).await;
        }
    }
}

async fn ensure_session(state: Arc<AppState>, session_id: &str) -> Session {
    let existing = sqlx::query(
        "SELECT id, tenant_id, created_at, updated_at, channel, assignee_agent_id, inbox_id, team_id, flow_id, handover_active, status, priority, contact_id, visitor_id FROM sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let mut created = false;
    let session = if let Some(row) = existing {
        Session {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            channel: row.get("channel"),
            assignee_agent_id: row.get("assignee_agent_id"),
            inbox_id: row.get("inbox_id"),
            team_id: row.get("team_id"),
            flow_id: row.get("flow_id"),
            contact_id: row.get("contact_id"),
            visitor_id: row.get("visitor_id"),
            handover_active: row.get("handover_active"),
            status: row.get("status"),
            priority: row.get("priority"),
            messages: get_session_messages_db(&state.db, session_id).await,
        }
    } else {
        created = true;
        let now = now_iso();
        let session = Session {
            tenant_id: state.default_tenant_id.clone(),
            id: session_id.to_string(),
            created_at: now.clone(),
            updated_at: now,
            messages: vec![],
            channel: "web".to_string(),
            assignee_agent_id: None,
            inbox_id: None,
            team_id: None,
            flow_id: Some(state.default_flow_id.clone()),
            contact_id: None,
            visitor_id: String::new(),
            handover_active: false,
            status: "open".to_string(),
            priority: "normal".to_string(),
        };
        persist_session(&state.db, &session).await;
        session
    };

    if created {
        emit_session_snapshot(state.clone()).await;
        let state_clone = state.clone();
        let session_clone = session_id.to_string();
        tokio::spawn(async move {
            run_flow_for_visitor_message(state_clone, session_clone, String::new(), "page_open")
                .await;
        });
    }

    session
}

async fn resolve_visitor_target_session(
    state: Arc<AppState>,
    requested_session_id: &str,
) -> (String, bool) {
    let is_closed = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM sessions WHERE id = $1 AND status = 'closed'",
    )
    .bind(requested_session_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;

    if !is_closed {
        return (requested_session_id.to_string(), false);
    }

    let new_session_id = Uuid::new_v4().to_string();
    let _ = ensure_session(state, &new_session_id).await;
    (new_session_id, true)
}

async fn add_message(
    state: Arc<AppState>,
    session_id: &str,
    sender: &str,
    text: &str,
    suggestions: Option<Vec<String>>,
    widget: Option<Value>,
) -> Option<ChatMessage> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut final_widget = widget;
    if sender == "agent" && final_widget.is_none() {
        final_widget = build_link_preview_widget(&state, trimmed).await;
    }

    let message = ChatMessage {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        sender: sender.to_string(),
        text: trimmed.to_string(),
        suggestions: suggestions.unwrap_or_default(),
        widget: final_widget,
        created_at: now_iso(),
    };
    let _ = sqlx::query("UPDATE sessions SET updated_at = $1 WHERE id = $2")
        .bind(&message.created_at)
        .bind(session_id)
        .execute(&state.db)
        .await;
    persist_message(&state.db, &message).await;
    let summary = get_session_summary_db(&state.db, session_id).await?;

    let watchers = {
        let rt = state.realtime.lock().await;
        rt.session_watchers
            .get(session_id)
            .map(|ids| ids.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default()
    };

    let agents = {
        let rt = state.realtime.lock().await;
        rt.agents.iter().copied().collect::<Vec<_>>()
    };

    if sender == "team" {
        emit_to_clients(&state, &agents, "message:new", message.clone()).await;
    } else if sender == "system" {
        emit_to_clients(&state, &agents, "message:new", message.clone()).await;
        if is_visitor_visible_system_msg(&message.text) {
            emit_to_clients(&state, &watchers, "message:new", message.clone()).await;
        }
    } else {
        emit_to_clients(&state, &watchers, "message:new", message.clone()).await;
        emit_to_clients(&state, &agents, "message:new", message.clone()).await;
    }

    emit_to_clients(&state, &agents, "session:updated", summary).await;

    Some(message)
}

async fn build_link_preview_widget(state: &Arc<AppState>, text: &str) -> Option<Value> {
    let url = first_http_url(text)?;
    let response = state
        .ai_client
        .get(&url)
        .timeout(Duration::from_secs(5))
        .header("user-agent", "chat-exp-link-preview/1.0")
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body = response.text().await.ok()?;
    let title = extract_meta_tag(&body, "og:title")
        .or_else(|| extract_meta_tag(&body, "twitter:title"))
        .or_else(|| extract_title_tag(&body))
        .unwrap_or_else(|| url.clone());
    let description = extract_meta_tag(&body, "og:description")
        .or_else(|| extract_meta_tag(&body, "description"))
        .or_else(|| extract_meta_tag(&body, "twitter:description"))
        .unwrap_or_default();
    let image = extract_meta_tag(&body, "og:image").unwrap_or_default();
    let site_name = extract_meta_tag(&body, "og:site_name").unwrap_or_default();

    Some(json!({
        "type": "link_preview",
        "url": url,
        "title": title,
        "description": description,
        "image": image,
        "siteName": site_name
    }))
}

fn flow_node_data_text(node: &FlowNode, key: &str) -> Option<String> {
    node.data
        .get(key)
        .and_then(Value::as_str)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn flow_node_data_u64(node: &FlowNode, key: &str) -> Option<u64> {
    node.data.get(key).and_then(Value::as_u64)
}

fn flow_node_data_suggestions(node: &FlowNode, key: &str) -> Vec<String> {
    node.data
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .take(6)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn flow_node_data_buttons(node: &FlowNode, key: &str) -> Vec<Value> {
    node.data
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(label) = item.as_str() {
                        let trimmed = label.trim();
                        if trimmed.is_empty() {
                            return None;
                        }
                        return Some(json!({ "label": trimmed, "value": trimmed }));
                    }
                    let label = item
                        .get("label")
                        .and_then(Value::as_str)?
                        .trim()
                        .to_string();
                    if label.is_empty() {
                        return None;
                    }
                    let value = item
                        .get("value")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| label.clone());
                    Some(json!({ "label": label, "value": value }))
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn flow_node_data_carousel_items(node: &FlowNode, key: &str) -> Vec<Value> {
    node.data
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = item
                        .get("title")
                        .and_then(Value::as_str)?
                        .trim()
                        .to_string();
                    if title.is_empty() {
                        return None;
                    }
                    let description = item
                        .get("description")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let price = item
                        .get("price")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let image_url = item
                        .get("imageUrl")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let buttons = item
                        .get("buttons")
                        .and_then(Value::as_array)
                        .map(|buttons| {
                            buttons
                                .iter()
                                .filter_map(|button| {
                                    if let Some(label) = button.as_str() {
                                        let label = label.trim().to_string();
                                        if label.is_empty() {
                                            return None;
                                        }
                                        return Some(json!({ "label": label, "value": label }));
                                    }
                                    let label = button
                                        .get("label")
                                        .and_then(Value::as_str)?
                                        .trim()
                                        .to_string();
                                    if label.is_empty() {
                                        return None;
                                    }
                                    let value = button
                                        .get("value")
                                        .and_then(Value::as_str)
                                        .map(|v| v.trim().to_string())
                                        .filter(|v| !v.is_empty())
                                        .unwrap_or_else(|| label.clone());
                                    Some(json!({ "label": label, "value": value }))
                                })
                                .take(4)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_else(|| {
                            vec![json!({ "label": "View", "value": title.clone() })]
                        });
                    Some(json!({
                        "title": title,
                        "description": description,
                        "price": price,
                        "imageUrl": image_url,
                        "buttons": buttons
                    }))
                })
                .take(10)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn flow_node_data_options(node: &FlowNode, key: &str) -> Vec<Value> {
    node.data
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(label) = item.as_str() {
                        let label = label.trim().to_string();
                        if label.is_empty() {
                            return None;
                        }
                        return Some(json!({ "label": label, "value": label }));
                    }
                    let label = item
                        .get("label")
                        .and_then(Value::as_str)?
                        .trim()
                        .to_string();
                    if label.is_empty() {
                        return None;
                    }
                    let value = item
                        .get("value")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| label.clone());
                    Some(json!({ "label": label, "value": value }))
                })
                .take(20)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn flow_node_data_fields(node: &FlowNode, key: &str) -> Vec<Value> {
    node.data
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(Value::as_str)?.trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    let label = item
                        .get("label")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| name.clone());
                    let placeholder = item
                        .get("placeholder")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    let field_type = item
                        .get("type")
                        .and_then(Value::as_str)
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| "text".to_string());
                    let required = item
                        .get("required")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    Some(json!({
                        "name": name,
                        "label": label,
                        "placeholder": placeholder,
                        "type": field_type,
                        "required": required
                    }))
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn flow_edge_condition(edge: &FlowEdge) -> String {
    edge.data
        .get("condition")
        .and_then(Value::as_str)
        .or(edge.source_handle.as_deref())
        .unwrap_or("default")
        .to_ascii_lowercase()
}

async fn is_first_visitor_message(state: &Arc<AppState>, session_id: &str) -> bool {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM chat_messages WHERE session_id = $1 AND sender = 'visitor'",
    )
    .bind(session_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    count <= 1
}

async fn mark_trigger_fired_once(
    state: &Arc<AppState>,
    session_id: &str,
    trigger_event: &str,
) -> bool {
    sqlx::query(
        "INSERT INTO session_triggers (session_id, trigger_event, created_at) VALUES ($1,$2,$3) ON CONFLICT (session_id, trigger_event) DO NOTHING",
    )
    .bind(session_id)
    .bind(trigger_event)
    .bind(now_iso())
    .execute(&state.db)
    .await
    .map(|r| r.rows_affected() > 0)
    .unwrap_or(false)
}

fn flow_trigger_matches_event(
    flow: &ChatFlow,
    visitor_text: &str,
    trigger_event: &str,
    first_visitor_message: bool,
) -> bool {
    let Some(trigger) = flow
        .nodes
        .iter()
        .find(|node| node.node_type == "trigger" || node.node_type == "start")
    else {
        return trigger_event == "visitor_message";
    };

    let trigger_on = trigger
        .data
        .get("on")
        .and_then(Value::as_str)
        .unwrap_or("widget_open")
        .to_ascii_lowercase();

    let event_match = match trigger_on.as_str() {
        "page_open" => trigger_event == "page_open",
        "widget_open" => trigger_event == "widget_open",
        "first_message" => trigger_event == "visitor_message" && first_visitor_message,
        "any_message" => trigger_event == "visitor_message",
        _ => trigger_event == "visitor_message",
    };

    if !event_match {
        return false;
    }

    if trigger_event != "visitor_message" {
        return true;
    }

    let Some(keywords) = trigger.data.get("keywords").and_then(Value::as_array) else {
        return true;
    };
    if keywords.is_empty() {
        return true;
    }
    let text = visitor_text.to_ascii_lowercase();
    keywords
        .iter()
        .filter_map(Value::as_str)
        .map(|k| k.trim().to_ascii_lowercase())
        .any(|needle| !needle.is_empty() && text.contains(&needle))
}

fn has_handover_intent(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let terms = [
        "human",
        "real person",
        "representative",
        "live agent",
        "transfer",
        "handover",
        "talk to agent",
        "speak to agent",
        "speak with agent",
    ];
    terms.iter().any(|needle| lower.contains(needle))
}

#[derive(Debug, Clone)]
struct AiDecision {
    reply: String,
    handover: bool,
    close_chat: bool,
    suggestions: Vec<String>,
    trigger_flow: Option<(String, HashMap<String, String>)>, // (flow_id, variables)
}

fn parse_ai_decision_from_text(raw: &str) -> Option<AiDecision> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut candidates = Vec::<String>::new();
    candidates.push(trimmed.to_string());

    if trimmed.starts_with("```") {
        let stripped = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();
        if !stripped.is_empty() {
            candidates.push(stripped);
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            let inner = trimmed[start..=end].to_string();
            candidates.push(inner);
        }
    }

    for candidate in candidates {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };

        let reply = parsed
            .get("reply")
            .and_then(Value::as_str)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_default();
        if reply.is_empty() {
            continue;
        }

        let handover = parsed
            .get("handover")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let close_chat = parsed
            .get("closeChat")
            .and_then(Value::as_bool)
            .or_else(|| parsed.get("close_chat").and_then(Value::as_bool))
            .unwrap_or(false);
        let suggestions = parsed
            .get("suggestions")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|text| text.trim().to_string())
                    .filter(|text| !text.is_empty())
                    .take(6)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let trigger_flow = parsed
            .get("triggerFlow")
            .or_else(|| parsed.get("trigger_flow"))
            .and_then(Value::as_object)
            .and_then(|obj| {
                let flow_id = obj
                    .get("flowId")
                    .or_else(|| obj.get("flow_id"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())?;
                let mut vars = HashMap::new();
                if let Some(v) = obj.get("variables").and_then(Value::as_object) {
                    for (k, val) in v {
                        if let Some(s) = val.as_str() {
                            vars.insert(k.clone(), s.to_string());
                        }
                    }
                }
                Some((flow_id, vars))
            });

        return Some(AiDecision {
            reply,
            handover,
            close_chat,
            suggestions,
            trigger_flow,
        });
    }

    None
}

async fn set_session_handover(
    state: &Arc<AppState>,
    session_id: &str,
    active: bool,
) -> Option<(SessionSummary, bool)> {
    let current =
        sqlx::query_scalar::<_, bool>("SELECT handover_active FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()?;
    let changed = current != active;
    let _ = sqlx::query("UPDATE sessions SET handover_active = $1, updated_at = $2 WHERE id = $3")
        .bind(active)
        .bind(now_iso())
        .bind(session_id)
        .execute(&state.db)
        .await;
    let summary = get_session_summary_db(&state.db, session_id).await?;
    Some((summary, changed))
}

async fn set_session_status(
    state: &Arc<AppState>,
    session_id: &str,
    status: &str,
) -> Option<(SessionSummary, bool)> {
    let normalized = status.trim().to_ascii_lowercase();
    let current = sqlx::query_scalar::<_, String>("SELECT status FROM sessions WHERE id = $1")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()?;
    let changed = current != normalized;
    let _ = sqlx::query("UPDATE sessions SET status = $1, updated_at = $2 WHERE id = $3")
        .bind(&normalized)
        .bind(now_iso())
        .bind(session_id)
        .execute(&state.db)
        .await;
    let summary = get_session_summary_db(&state.db, session_id).await?;
    Some((summary, changed))
}

async fn recent_session_context(state: &Arc<AppState>, session_id: &str, limit: usize) -> String {
    let messages = get_session_messages_db(&state.db, session_id).await;

    if messages.is_empty() {
        return String::new();
    }

    let start_index = messages.len().saturating_sub(limit);
    messages
        .iter()
        .skip(start_index)
        .map(|message| format!("{}: {}", message.sender, message.text))
        .collect::<Vec<_>>()
        .join("\n")
}

async fn generate_ai_reply(
    state: Arc<AppState>,
    session_id: &str,
    prompt: &str,
    visitor_text: &str,
) -> AiDecision {
    let transcript = recent_session_context(&state, session_id, 14).await;

    // Fetch tenant_id for this session
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM sessions WHERE id = $1")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| state.default_tenant_id.clone());

    // Fetch contact info linked to this session
    let mut contact_block = String::new();
    let contact_id: Option<String> =
        sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();
    if let Some(cid) = &contact_id {
        let contact_row = sqlx::query(
            "SELECT display_name, email, phone, company, location FROM contacts WHERE id = $1",
        )
        .bind(cid)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        if let Some(row) = contact_row {
            let name: String = row.get("display_name");
            let email: String = row.get("email");
            let phone: String = row.get("phone");
            let company: String = row.get("company");
            let location: String = row.get("location");
            contact_block.push_str("\nContact information on file:");
            if !name.is_empty() {
                contact_block.push_str(&format!("\n- Name: {}", name));
            }
            if !email.is_empty() {
                contact_block.push_str(&format!("\n- Email: {}", email));
            }
            if !phone.is_empty() {
                contact_block.push_str(&format!("\n- Phone: {}", phone));
            }
            if !company.is_empty() {
                contact_block.push_str(&format!("\n- Company: {}", company));
            }
            if !location.is_empty() {
                contact_block.push_str(&format!("\n- Location: {}", location));
            }
        }
        // Include custom attributes
        let custom_attrs = sqlx::query(
            "SELECT attribute_key, attribute_value FROM contact_custom_attributes WHERE contact_id = $1",
        )
        .bind(cid)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
        for attr_row in &custom_attrs {
            let key: String = attr_row.get("attribute_key");
            let val: String = attr_row.get("attribute_value");
            if !val.is_empty() {
                contact_block.push_str(&format!("\n- {}: {}", key, val));
            }
        }
        if !contact_block.is_empty() {
            contact_block.push('\n');
        }
    }

    // Fetch flows marked as AI tools
    let tool_flows = sqlx::query(
        "SELECT id, name, ai_tool_description, input_variables FROM flows WHERE tenant_id = $1 AND ai_tool = true AND enabled = true",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut tools_block = String::new();
    if !tool_flows.is_empty() {
        tools_block.push_str("\n\nYou have the following TOOLS (flows) you can trigger. When appropriate, trigger a flow instead of answering manually.\nAvailable tools:\n");
        for row in &tool_flows {
            let flow_id: String = row.get("id");
            let flow_name: String = row.get("name");
            let description: String = row.get("ai_tool_description");
            let input_vars_raw: String = row.get("input_variables");
            let input_vars: Vec<FlowInputVariable> =
                serde_json::from_str(&input_vars_raw).unwrap_or_default();

            tools_block.push_str(&format!(
                "- Tool \"{}\" (flowId: \"{}\")",
                flow_name, flow_id
            ));
            if !description.is_empty() {
                tools_block.push_str(&format!(": {}", description));
            }
            if !input_vars.is_empty() {
                let params: Vec<String> = input_vars
                    .iter()
                    .map(|v| {
                        let req = if v.required { "required" } else { "optional" };
                        let label = if v.label.is_empty() {
                            v.key.clone()
                        } else {
                            v.label.clone()
                        };
                        format!("{}({}, {})", v.key, label, req)
                    })
                    .collect();
                tools_block.push_str(&format!(" | parameters: [{}]", params.join(", ")));
            }
            tools_block.push('\n');
        }
        tools_block.push_str("\nTo trigger a tool, include \"triggerFlow\" in your JSON response: {\"reply\":\"I'll help you with that...\",\"triggerFlow\":{\"flowId\":\"<id>\",\"variables\":{\"key\":\"value\"}}}\n");
        tools_block.push_str("If the tool needs required parameters the user hasn't provided yet, ask for them in your reply WITHOUT triggering the flow. Only trigger when you have all required data.\n");
    }

    let system_instruction = if prompt.trim().is_empty() {
        format!("You are a support agent in a chat flow. Use prior conversation context and respond briefly and helpfully. \
If user asks for a human, transfer, escalation, or representative, set handover=true. \
If the conversation is clearly complete and resolved, set closeChat=true.{}", tools_block)
    } else {
        format!("{}{}", prompt.trim(), tools_block)
    };

    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        let fallback = if !transcript.is_empty() {
            format!(
                "I can help with that. I saw this context:\n{}\n\nLatest message: {}",
                transcript,
                visitor_text.trim()
            )
        } else {
            format!("I can help with that. You said: {}", visitor_text.trim())
        };
        return AiDecision {
            reply: fallback,
            handover: has_handover_intent(visitor_text),
            close_chat: false,
            suggestions: vec![],
            trigger_flow: None,
        };
    }

    let json_format_hint = if tool_flows.is_empty() {
        "Return ONLY JSON: {\"reply\":\"string\",\"handover\":boolean,\"closeChat\":boolean,\"suggestions\":[\"short option\", \"another option\"]}"
    } else {
        "Return ONLY JSON: {\"reply\":\"string\",\"handover\":boolean,\"closeChat\":boolean,\"suggestions\":[],\"triggerFlow\":null} — set triggerFlow to {\"flowId\":\"<id>\",\"variables\":{}} when triggering a tool, otherwise null"
    };

    let response = state
        .ai_client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": "gpt-4o-mini",
            "instructions": system_instruction,
            "input": format!(
                "{}\nConversation transcript (oldest to newest):\n{}\n\nLatest visitor message:\n{}\n\n{}",
                contact_block,
                transcript,
                visitor_text.trim(),
                json_format_hint
            ),
        }))
        .send()
        .await;

    let Ok(response) = response else {
        return AiDecision {
            reply: "I had a temporary issue generating an AI reply. Could you rephrase?"
                .to_string(),
            handover: has_handover_intent(visitor_text),
            close_chat: false,
            suggestions: vec![],
            trigger_flow: None,
        };
    };

    let payload = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    let raw_text = payload
        .get("output_text")
        .and_then(Value::as_str)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .or_else(|| {
            payload
                .get("output")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("content"))
                .and_then(Value::as_array)
                .and_then(|content| content.first())
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str)
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
        });

    if let Some(raw_text) = raw_text {
        if let Some(parsed) = parse_ai_decision_from_text(&raw_text) {
            return parsed;
        }

        // If model didn't follow JSON format, use plain text and keep heuristic handover.
        return AiDecision {
            reply: raw_text,
            handover: has_handover_intent(visitor_text),
            close_chat: false,
            suggestions: vec![],
            trigger_flow: None,
        };
    }

    let reply = payload
        .get("output")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| content.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "I can help with that. Tell me a bit more.".to_string());

    AiDecision {
        reply,
        handover: has_handover_intent(visitor_text),
        close_chat: false,
        suggestions: vec![],
        trigger_flow: None,
    }
}

/// Returns the list of missing required input variable keys for a flow.
fn find_missing_required_vars(flow: &ChatFlow, provided: &HashMap<String, String>) -> Vec<String> {
    flow.input_variables
        .iter()
        .filter(|v| v.required)
        .filter(|v| {
            provided
                .get(&v.key)
                .map(|val| val.trim().is_empty())
                .unwrap_or(true)
        })
        .map(|v| {
            if v.label.is_empty() {
                v.key.clone()
            } else {
                v.label.clone()
            }
        })
        .collect()
}

/// Use a focused AI call to extract variable values from a visitor's message.
/// Unlike generate_ai_reply, this uses a minimal prompt that just extracts JSON — no tools,
/// no contact block, no conversation format.
async fn extract_vars_with_ai(
    state: &Arc<AppState>,
    session_id: &str,
    visitor_text: &str,
    var_descriptions: &[(String, String)], // (key, label)
) -> HashMap<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        eprintln!("[extract_vars] No API key");
        return HashMap::new();
    }

    // Include a large conversation window so the AI can see the full collection dialogue
    let transcript = recent_session_context(state, session_id, 20).await;

    // Build contact info block so the AI knows who the user is
    let mut contact_block = String::new();
    let contact_id: Option<String> =
        sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();
    if let Some(cid) = &contact_id {
        let contact_row = sqlx::query(
            "SELECT display_name, email, phone, company, location FROM contacts WHERE id = $1",
        )
        .bind(cid)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        if let Some(row) = contact_row {
            let name: String = row.get("display_name");
            let email: String = row.get("email");
            let phone: String = row.get("phone");
            let company: String = row.get("company");
            let location: String = row.get("location");
            contact_block.push_str("Known contact info:");
            if !name.is_empty() {
                contact_block.push_str(&format!(" name={}", name));
            }
            if !email.is_empty() {
                contact_block.push_str(&format!(" email={}", email));
            }
            if !phone.is_empty() {
                contact_block.push_str(&format!(" phone={}", phone));
            }
            if !company.is_empty() {
                contact_block.push_str(&format!(" company={}", company));
            }
            if !location.is_empty() {
                contact_block.push_str(&format!(" location={}", location));
            }
        }
    }

    let var_list: Vec<String> = var_descriptions
        .iter()
        .map(|(key, label)| {
            if label.is_empty() || label == key {
                format!("\"{}\" ", key)
            } else {
                format!("\"{}\" ({})", key, label)
            }
        })
        .collect();

    let prompt = format!(
        "You are a data extraction assistant. Extract values for the requested variables from the conversation and any known contact information.\n\
         \n\
         {contact}\n\
         \n\
         Conversation transcript:\n{transcript}\n\
         \n\
         Latest user message: \"{visitor}\"\n\
         \n\
         Extract values for these variables: [{vars}]\n\
         \n\
         Rules:\n\
         - Look at the ENTIRE conversation and contact info to find values, not just the latest message.\n\
         - If the user said something like \"its my name\" or \"you already know\", use the contact info to fill in the value.\n\
         - If a value was clearly stated or can be inferred from context, include it.\n\
         - If a value truly cannot be determined, set it to \"\".\n\
         - Output ONLY a JSON object mapping variable keys to string values.\n\
         - No explanation, no markdown, just the raw JSON object.\n\
         \n\
         Example output: {{\"first_name\": \"John\", \"purchase_id\": \"1234\"}}",
        contact = contact_block,
        transcript = transcript,
        visitor = visitor_text,
        vars = var_list.join(", "),
    );

    eprintln!("[extract_vars] Extracting vars: {:?}", var_descriptions);
    eprintln!("[extract_vars] Contact: {}", contact_block);
    eprintln!("[extract_vars] Visitor text: {}", visitor_text);

    let response = state
        .ai_client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(&api_key)
        .json(&json!({
            "model": "gpt-4o-mini",
            "instructions": "You are a precise data extraction tool. Output ONLY valid JSON. No markdown, no explanation.",
            "input": prompt,
        }))
        .send()
        .await;

    let Ok(response) = response else {
        eprintln!("[extract_vars] API request failed");
        return HashMap::new();
    };

    let payload = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    let raw_text = payload
        .get("output_text")
        .and_then(Value::as_str)
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .or_else(|| {
            payload
                .get("output")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("content"))
                .and_then(Value::as_array)
                .and_then(|content| content.first())
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str)
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
        })
        .unwrap_or_default();

    eprintln!("[extract_vars] Raw AI response: {}", raw_text);

    // Find the JSON object in the response (may have markdown wrapping)
    let json_str = if let Some(start) = raw_text.find('{') {
        if let Some(end) = raw_text.rfind('}') {
            &raw_text[start..=end]
        } else {
            &raw_text
        }
    } else {
        &raw_text
    };

    let mut result = HashMap::new();
    if let Ok(parsed) = serde_json::from_str::<HashMap<String, Value>>(json_str) {
        for (key, val) in parsed {
            let str_val = match val {
                Value::String(s) => s,
                other => other.to_string(),
            };
            if !str_val.is_empty() {
                result.insert(key, str_val);
            }
        }
    }
    eprintln!("[extract_vars] Extracted: {:?}", result);
    result
}

async fn send_flow_agent_message(
    state: Arc<AppState>,
    session_id: &str,
    text: &str,
    delay_ms: u64,
    suggestions: Option<Vec<String>>,
    widget: Option<Value>,
) {
    if text.trim().is_empty() {
        return;
    }
    start_agent_typing(state.clone(), session_id).await;
    tokio::time::sleep(Duration::from_millis(delay_ms.clamp(120, 6000))).await;
    let _ = add_message(
        state.clone(),
        session_id,
        "agent",
        text,
        suggestions,
        widget,
    )
    .await;
    stop_agent_typing(state, session_id).await;
}

async fn execute_flow(
    state: Arc<AppState>,
    session_id: String,
    flow: ChatFlow,
    visitor_text: String,
) {
    execute_flow_from(state, session_id, flow, visitor_text, None, HashMap::new()).await;
}

/// Save a flow cursor so the next visitor message resumes from this node.
async fn save_flow_cursor(
    state: &Arc<AppState>,
    session_id: &str,
    flow_id: &str,
    node_id: &str,
    node_type: &str,
    variables: &HashMap<String, String>,
) {
    let vars_json = serde_json::to_string(variables).unwrap_or_else(|_| "{}".to_string());
    let _ = sqlx::query(
        "INSERT INTO flow_cursors (tenant_id, session_id, flow_id, node_id, node_type, variables, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET flow_id = $3, node_id = $4, node_type = $5, variables = $6, created_at = $7",
    )
    .bind(&state.default_tenant_id)
    .bind(session_id)
    .bind(flow_id)
    .bind(node_id)
    .bind(node_type)
    .bind(&vars_json)
    .bind(now_iso())
    .execute(&state.db)
    .await;
}

/// Remove the flow cursor when the flow completes or we no longer need to wait.
async fn clear_flow_cursor(state: &Arc<AppState>, session_id: &str) {
    let _ = sqlx::query("DELETE FROM flow_cursors WHERE tenant_id = $1 AND session_id = $2")
        .bind(&state.default_tenant_id)
        .bind(session_id)
        .execute(&state.db)
        .await;
}

/// Check if a cursor exists. Returns (flow_id, node_id, node_type, variables).
async fn get_flow_cursor(
    state: &Arc<AppState>,
    session_id: &str,
) -> Option<(String, String, String, HashMap<String, String>)> {
    let row = sqlx::query(
        "SELECT flow_id, node_id, node_type, variables FROM flow_cursors WHERE tenant_id = $1 AND session_id = $2",
    )
    .bind(&state.default_tenant_id)
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    let vars_json: String = row.get("variables");
    let variables: HashMap<String, String> = serde_json::from_str(&vars_json).unwrap_or_default();
    Some((
        row.get("flow_id"),
        row.get("node_id"),
        row.get("node_type"),
        variables,
    ))
}

/// Replace {{varName}} or {{contact.name}} placeholders in a string with flow variable values.
fn interpolate_flow_vars(text: &str, vars: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}").unwrap();
    re.replace_all(text, |caps: &regex::Captures| {
        let key = &caps[1];
        vars.get(key).cloned().unwrap_or_default()
    })
    .to_string()
}

/// Find or create a contact by email, link to the session.
async fn resolve_contact_by_email(state: &Arc<AppState>, session_id: &str, email: &str) {
    if email.is_empty() {
        return;
    }
    let tenant_id = sqlx::query_scalar::<_, String>("SELECT tenant_id FROM sessions WHERE id = $1")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    if tenant_id.is_empty() {
        return;
    }

    // Try to find existing contact by email
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM contacts WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1",
    )
    .bind(&tenant_id)
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let contact_id = if let Some(cid) = existing {
        cid
    } else {
        // Create new contact
        let new_id = Uuid::new_v4().to_string();
        let now = now_iso();
        let _ = sqlx::query(
            "INSERT INTO contacts (id, tenant_id, display_name, email, phone, external_id, metadata, created_at, updated_at, company, location, avatar_url, last_seen_at, browser, os) \
             VALUES ($1,$2,'',$3,'','','{}', $4,$5,'','','','','','')",
        )
        .bind(&new_id)
        .bind(&tenant_id)
        .bind(email)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await;
        new_id
    };

    // Link to session
    let _ = sqlx::query("UPDATE sessions SET contact_id = $1 WHERE id = $2")
        .bind(&contact_id)
        .bind(session_id)
        .execute(&state.db)
        .await;

    // Also link all other sessions with the same visitor_id
    let _ = sqlx::query(
        "UPDATE sessions SET contact_id = $1 WHERE visitor_id = (SELECT visitor_id FROM sessions WHERE id = $2) AND visitor_id != '' AND contact_id IS NULL",
    )
    .bind(&contact_id)
    .bind(session_id)
    .execute(&state.db)
    .await;

    if let Some(summary) = get_session_summary_db(&state.db, session_id).await {
        emit_session_update(state, summary).await;
    }
}

/// Given a paused interactive node and the visitor's reply text, find the
/// next node to continue from by matching the reply to the appropriate
/// source handle (btn-N, opt-N, or just the first edge for quick_input/input_form).
fn resolve_interactive_next(
    node: &FlowNode,
    edges: &[FlowEdge],
    visitor_text: &str,
) -> Option<String> {
    match node.node_type.as_str() {
        "buttons" => {
            let buttons = flow_node_data_buttons(node, "buttons");
            let visitor_lower = visitor_text.trim().to_ascii_lowercase();
            // Find which button index the visitor chose (match against label or value)
            let chosen_idx = buttons.iter().position(|b| {
                let label = b
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let value = b
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                label == visitor_lower || value == visitor_lower
            });
            if let Some(idx) = chosen_idx {
                let handle = format!("btn-{}", idx);
                let edge = edges
                    .iter()
                    .find(|e| e.source_handle.as_deref() == Some(handle.as_str()));
                if let Some(e) = edge {
                    return Some(e.target.clone());
                }
            }
            // Fallback: try any edge with matching condition text, then first edge
            edges.first().map(|e| e.target.clone())
        }
        "select" => {
            let options = flow_node_data_options(node, "options");
            let visitor_lower = visitor_text.trim().to_ascii_lowercase();
            let chosen_idx = options.iter().position(|o| {
                let label = o
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let value = o
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                label == visitor_lower || value == visitor_lower
            });
            if let Some(idx) = chosen_idx {
                let handle = format!("opt-{}", idx);
                let edge = edges
                    .iter()
                    .find(|e| e.source_handle.as_deref() == Some(handle.as_str()));
                if let Some(e) = edge {
                    return Some(e.target.clone());
                }
            }
            edges.first().map(|e| e.target.clone())
        }
        // quick_input, input_form, csat, close_conversation — just continue to the first outgoing edge
        _ => edges.first().map(|e| e.target.clone()),
    }
}

/// Execute a flow, optionally starting from a specific node (for resume).
async fn execute_flow_from(
    state: Arc<AppState>,
    session_id: String,
    flow: ChatFlow,
    visitor_text: String,
    resume_from_node: Option<String>,
    mut flow_vars: HashMap<String, String>,
) {
    if !flow.enabled {
        return;
    }

    let node_by_id = flow
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node.clone()))
        .collect::<HashMap<_, _>>();
    let mut outgoing = HashMap::<String, Vec<FlowEdge>>::new();
    for edge in &flow.edges {
        outgoing
            .entry(edge.source.clone())
            .or_default()
            .push(edge.clone());
    }

    let start_id = if let Some(ref resume_id) = resume_from_node {
        // Resuming: find the next node after the paused interactive node
        let paused_node = node_by_id.get(resume_id);
        let edges_from_paused = outgoing.get(resume_id).cloned().unwrap_or_default();
        if let Some(node) = paused_node {
            // Capture submitted values into flow variables
            match node.node_type.as_str() {
                "input_form" => {
                    // Parse "Label: value, Label2: value2" into flow vars by field name
                    let fields = flow_node_data_fields(node, "fields");
                    for field in &fields {
                        let label = field.get("label").and_then(Value::as_str).unwrap_or("");
                        let name = field.get("name").and_then(Value::as_str).unwrap_or("");
                        if !name.is_empty() && !label.is_empty() {
                            let prefix = format!("{}:", label);
                            for part in visitor_text.split(',') {
                                let part = part.trim();
                                if let Some(val) = part.strip_prefix(&prefix) {
                                    flow_vars.insert(name.to_string(), val.trim().to_string());
                                }
                            }
                        }
                    }
                }
                "quick_input" => {
                    let var_name = node
                        .data
                        .get("variableName")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if !var_name.is_empty() {
                        flow_vars.insert(var_name, visitor_text.clone());
                    }
                }
                "start_flow" => {
                    // Resuming from AI-collect on start_flow — extract vars from visitor reply
                    let sf_target_id = flow_vars.remove("__sf_target_flow_id").unwrap_or_default();
                    let sf_sub_vars_json = flow_vars
                        .remove("__sf_sub_vars")
                        .unwrap_or_else(|| "{}".to_string());
                    let mut sub_vars: HashMap<String, String> =
                        serde_json::from_str(&sf_sub_vars_json).unwrap_or_default();

                    eprintln!(
                        "[start_flow resume] target={}, sub_vars={:?}",
                        sf_target_id, sub_vars
                    );

                    if let Some(target_flow) = get_flow_by_id_db(&state.db, &sf_target_id).await {
                        // Always extract ALL required vars (not just missing) so the AI can
                        // leverage accumulated context to fill previously-missed values
                        let all_required_descs: Vec<(String, String)> = target_flow
                            .input_variables
                            .iter()
                            .filter(|v| v.required)
                            .map(|v| (v.key.clone(), v.label.clone()))
                            .collect();

                        if !all_required_descs.is_empty() {
                            let extracted = extract_vars_with_ai(
                                &state,
                                &session_id,
                                &visitor_text,
                                &all_required_descs,
                            )
                            .await;
                            // Merge extracted into sub_vars (only overwrite if new value is non-empty)
                            for (key, val) in extracted {
                                if !val.trim().is_empty() {
                                    sub_vars.insert(key, val);
                                }
                            }
                        }

                        eprintln!(
                            "[start_flow resume] sub_vars after extraction: {:?}",
                            sub_vars
                        );

                        // Check if we now have all required vars
                        let still_missing = find_missing_required_vars(&target_flow, &sub_vars);
                        eprintln!("[start_flow resume] still_missing: {:?}", still_missing);

                        if still_missing.is_empty() {
                            // All collected! Execute the sub-flow
                            eprintln!("[start_flow resume] All vars collected, executing sub-flow");
                            clear_flow_cursor(&state, &session_id).await;
                            Box::pin(execute_flow_from(
                                state.clone(),
                                session_id.clone(),
                                target_flow,
                                visitor_text.clone(),
                                None,
                                sub_vars,
                            ))
                            .await;
                            return;
                        } else {
                            // Still missing — ask again
                            eprintln!("[start_flow resume] Still missing vars, asking again");
                            flow_vars.insert("__sf_target_flow_id".to_string(), sf_target_id);
                            flow_vars.insert(
                                "__sf_sub_vars".to_string(),
                                serde_json::to_string(&sub_vars).unwrap_or_default(),
                            );
                            let ask_prompt = format!(
                                "The user just said: \"{}\". You still need these values from the user: [{}]. \
                                 Acknowledge what they provided (if anything), then ask for the remaining values in a friendly, concise way. \
                                 Do NOT say you have everything or that you'll proceed — you are still waiting for more information.",
                                visitor_text,
                                still_missing.join(", ")
                            );
                            let ai_reply = generate_ai_reply(
                                state.clone(),
                                &session_id,
                                &ask_prompt,
                                &visitor_text,
                            )
                            .await;
                            send_flow_agent_message(
                                state.clone(),
                                &session_id,
                                &ai_reply.reply,
                                500,
                                None,
                                None,
                            )
                            .await;
                            save_flow_cursor(
                                &state,
                                &session_id,
                                &flow.id,
                                &node.id,
                                "start_flow",
                                &flow_vars,
                            )
                            .await;
                            return;
                        }
                    }
                    // If target flow not found, just continue
                }
                _ => {}
            }
            // If resuming from close_conversation (CSAT was collected), close session now
            if node.node_type == "close_conversation" {
                let msg = node
                    .data
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if !msg.is_empty() {
                    send_flow_agent_message(state.clone(), &session_id, msg, 300, None, None).await;
                }
                if let Some((summary, changed)) =
                    set_session_status(&state, &session_id, "closed").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation closed by bot",
                            None,
                            None,
                        )
                        .await;
                    }
                }
                clear_flow_cursor(&state, &session_id).await;
                return;
            }
            resolve_interactive_next(node, &edges_from_paused, &visitor_text)
        } else {
            None
        }
    } else {
        flow.nodes
            .iter()
            .find(|node| node.node_type == "trigger" || node.node_type == "start")
            .map(|node| node.id.clone())
            .or_else(|| flow.nodes.first().map(|node| node.id.clone()))
    };

    let Some(mut current_id) = start_id else {
        clear_flow_cursor(&state, &session_id).await;
        return;
    };

    // Pre-populate contact.* variables so {{contact.name}} etc. resolve in text nodes
    {
        let contact_id: Option<String> =
            sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
                .bind(&session_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();
        if let Some(cid) = contact_id {
            let row = sqlx::query_as::<_, (String, String, String, String, String)>(
                "SELECT COALESCE(display_name,''), COALESCE(email,''), COALESCE(phone,''), COALESCE(company,''), COALESCE(location,'') FROM contacts WHERE id = $1",
            )
            .bind(&cid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
            if let Some((name, email, phone, company, location)) = row {
                if !name.is_empty() {
                    flow_vars.entry("contact.name".to_string()).or_insert(name);
                }
                if !email.is_empty() {
                    flow_vars
                        .entry("contact.email".to_string())
                        .or_insert(email);
                }
                if !phone.is_empty() {
                    flow_vars
                        .entry("contact.phone".to_string())
                        .or_insert(phone);
                }
                if !company.is_empty() {
                    flow_vars
                        .entry("contact.company".to_string())
                        .or_insert(company);
                }
                if !location.is_empty() {
                    flow_vars
                        .entry("contact.location".to_string())
                        .or_insert(location);
                }
            }
            // Also load custom attributes as contact.attr.<key>
            let custom_attrs: Vec<(String, String)> = sqlx::query_as(
                "SELECT attribute_key, attribute_value FROM contact_custom_attributes WHERE contact_id = $1",
            )
            .bind(&cid)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            for (key, val) in custom_attrs {
                flow_vars.entry(format!("contact.{}", key)).or_insert(val);
            }
        }
    }

    for _ in 0..24 {
        let Some(node) = node_by_id.get(&current_id).cloned() else {
            break;
        };
        let edges = outgoing.get(&node.id).cloned().unwrap_or_default();

        match node.node_type.as_str() {
            "trigger" | "start" => {}
            "message" => {
                let raw_text = flow_node_data_text(&node, "text").unwrap_or_default();
                let text = interpolate_flow_vars(&raw_text, &flow_vars);
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let suggestions = flow_node_data_suggestions(&node, "suggestions");
                let suggestions_opt = if suggestions.is_empty() {
                    None
                } else {
                    Some(suggestions)
                };
                send_flow_agent_message(
                    state.clone(),
                    &session_id,
                    &text,
                    delay_ms,
                    suggestions_opt,
                    None,
                )
                .await;
            }
            "buttons" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let buttons = flow_node_data_buttons(&node, "buttons");
                let widget = if buttons.is_empty() {
                    None
                } else {
                    let disable_composer = node
                        .data
                        .get("disableComposer")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    Some(json!({
                        "type": "buttons",
                        "buttons": buttons,
                        "disableComposer": disable_composer
                    }))
                };
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
                // Pause: save cursor and wait for visitor reply
                save_flow_cursor(
                    &state,
                    &session_id,
                    &flow.id,
                    &node.id,
                    "buttons",
                    &flow_vars,
                )
                .await;
                return;
            }
            "carousel" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(500);
                let items = flow_node_data_carousel_items(&node, "items");
                let widget = if items.is_empty() {
                    None
                } else {
                    Some(json!({
                        "type": "carousel",
                        "items": items
                    }))
                };
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
            }
            "select" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let options = flow_node_data_options(&node, "options");
                let widget = if options.is_empty() {
                    None
                } else {
                    Some(json!({
                        "type": "select",
                        "placeholder": node.data.get("placeholder").and_then(Value::as_str).unwrap_or("Choose an option"),
                        "buttonLabel": node.data.get("buttonLabel").and_then(Value::as_str).unwrap_or("Send"),
                        "options": options
                    }))
                };
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
                // Pause: save cursor and wait for visitor reply
                save_flow_cursor(
                    &state,
                    &session_id,
                    &flow.id,
                    &node.id,
                    "select",
                    &flow_vars,
                )
                .await;
                return;
            }
            "input_form" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let fields = flow_node_data_fields(&node, "fields");
                let widget = if fields.is_empty() {
                    None
                } else {
                    let disable_composer = node
                        .data
                        .get("disableComposer")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    Some(json!({
                        "type": "input_form",
                        "submitLabel": node.data.get("submitLabel").and_then(Value::as_str).unwrap_or("Submit"),
                        "fields": fields,
                        "disableComposer": disable_composer
                    }))
                };
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
                // Pause: save cursor and wait for visitor reply
                save_flow_cursor(
                    &state,
                    &session_id,
                    &flow.id,
                    &node.id,
                    "input_form",
                    &flow_vars,
                )
                .await;
                return;
            }
            "quick_input" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let placeholder = node
                    .data
                    .get("placeholder")
                    .and_then(Value::as_str)
                    .unwrap_or("Enter value")
                    .trim()
                    .to_string();
                let button_label = node
                    .data
                    .get("buttonLabel")
                    .and_then(Value::as_str)
                    .unwrap_or("Send")
                    .trim()
                    .to_string();
                let input_type = node
                    .data
                    .get("inputType")
                    .and_then(Value::as_str)
                    .unwrap_or("text")
                    .trim()
                    .to_string();
                let widget = Some(json!({
                    "type": "quick_input",
                    "placeholder": placeholder,
                    "buttonLabel": button_label,
                    "inputType": input_type,
                    "disableComposer": node.data.get("disableComposer").and_then(Value::as_bool).unwrap_or(false)
                }));
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
                // Pause: save cursor and wait for visitor reply
                save_flow_cursor(
                    &state,
                    &session_id,
                    &flow.id,
                    &node.id,
                    "quick_input",
                    &flow_vars,
                )
                .await;
                return;
            }
            "ai" => {
                let prompt = flow_node_data_text(&node, "prompt").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(700);
                let decision =
                    generate_ai_reply(state.clone(), &session_id, &prompt, &visitor_text).await;
                let suggestions_opt = if decision.suggestions.is_empty() {
                    None
                } else {
                    Some(decision.suggestions.clone())
                };
                send_flow_agent_message(
                    state.clone(),
                    &session_id,
                    &decision.reply,
                    delay_ms,
                    suggestions_opt,
                    None,
                )
                .await;
                if decision.handover {
                    if let Some((summary, changed)) =
                        set_session_handover(&state, &session_id, true).await
                    {
                        emit_session_update(&state, summary).await;
                        if changed {
                            let _ = add_message(
                                state.clone(),
                                &session_id,
                                "system",
                                "Conversation transferred to a human agent",
                                None,
                                None,
                            )
                            .await;
                        }
                    }
                    clear_flow_cursor(&state, &session_id).await;
                    break;
                }
                if decision.close_chat {
                    if let Some((summary, changed)) =
                        set_session_status(&state, &session_id, "closed").await
                    {
                        emit_session_update(&state, summary).await;
                        if changed {
                            let _ = add_message(
                                state.clone(),
                                &session_id,
                                "system",
                                "Conversation closed by bot",
                                None,
                                None,
                            )
                            .await;
                        }
                    }
                    clear_flow_cursor(&state, &session_id).await;
                    break;
                }
                // Handle AI-triggered flow
                if let Some((trigger_flow_id, trigger_vars)) = decision.trigger_flow {
                    if let Some(target_flow) = get_flow_by_id_db(&state.db, &trigger_flow_id).await
                    {
                        let missing = find_missing_required_vars(&target_flow, &trigger_vars);
                        if missing.is_empty() {
                            clear_flow_cursor(&state, &session_id).await;
                            Box::pin(execute_flow_from(
                                state.clone(),
                                session_id.clone(),
                                target_flow,
                                visitor_text.clone(),
                                None,
                                trigger_vars,
                            ))
                            .await;
                            return;
                        } else {
                            // Missing required fields — ask the AI to collect them
                            let retry_prompt = format!(
                                "You tried to trigger the tool \"{}\" but the following REQUIRED parameters are missing: [{}]. \
                                 Ask the user to provide these values. Do NOT trigger the tool until you have all required data.",
                                target_flow.name,
                                missing.join(", ")
                            );
                            let retry = generate_ai_reply(
                                state.clone(),
                                &session_id,
                                &retry_prompt,
                                &visitor_text,
                            )
                            .await;
                            send_flow_agent_message(
                                state.clone(),
                                &session_id,
                                &retry.reply,
                                600,
                                None,
                                None,
                            )
                            .await;
                        }
                    }
                }
            }
            "condition" => {
                // ── Rules-based evaluation (Intercom-style) ──
                let rules = node.data.get("rules").and_then(Value::as_array);
                let logic_op = node
                    .data
                    .get("logicOperator")
                    .and_then(Value::as_str)
                    .unwrap_or("and");

                let matches = if let Some(rules) = rules {
                    if rules.is_empty() {
                        false
                    } else {
                        // Lazy-load session fields for attribute lookups
                        let sess_channel: String =
                            sqlx::query_scalar("SELECT channel FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_default();
                        let sess_status: String =
                            sqlx::query_scalar("SELECT status FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_default();
                        let sess_priority: String =
                            sqlx::query_scalar("SELECT priority FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_default();
                        let sess_assignee: Option<String> = sqlx::query_scalar(
                            "SELECT assignee_agent_id FROM sessions WHERE id = $1",
                        )
                        .bind(&session_id)
                        .fetch_optional(&state.db)
                        .await
                        .ok()
                        .flatten();
                        let sess_team: Option<String> =
                            sqlx::query_scalar("SELECT team_id FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten();
                        let sess_inbox: Option<String> =
                            sqlx::query_scalar("SELECT inbox_id FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten();
                        let sess_contact: Option<String> =
                            sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten();

                        let mut results: Vec<bool> = Vec::new();
                        for rule in rules {
                            let attr = rule
                                .get("attribute")
                                .and_then(Value::as_str)
                                .unwrap_or("message");
                            let operator = rule
                                .get("operator")
                                .and_then(Value::as_str)
                                .unwrap_or("equals");
                            let value = rule.get("value").and_then(Value::as_str).unwrap_or("");
                            let attr_key = rule
                                .get("attributeKey")
                                .and_then(Value::as_str)
                                .unwrap_or("");

                            let actual: String = match attr {
                                "message" => visitor_text.clone(),
                                "channel" => sess_channel.clone(),
                                "status" => sess_status.clone(),
                                "priority" => sess_priority.clone(),
                                "assignee" => {
                                    if let Some(ref aid) = sess_assignee {
                                        sqlx::query_scalar::<_, String>("SELECT email FROM agents WHERE id = $1")
                                            .bind(aid).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                "team" => {
                                    if let Some(ref tid) = sess_team {
                                        sqlx::query_scalar::<_, String>("SELECT name FROM teams WHERE id = $1")
                                            .bind(tid).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                "inbox" => {
                                    if let Some(ref iid) = sess_inbox {
                                        sqlx::query_scalar::<_, String>("SELECT name FROM inboxes WHERE id = $1")
                                            .bind(iid).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                "contact.email" | "contact.name" | "contact.phone" | "contact.company" | "contact.location" => {
                                    if let Some(ref cid) = sess_contact {
                                        let col = match attr {
                                            "contact.email" => "email",
                                            "contact.name" => "display_name",
                                            "contact.phone" => "phone",
                                            "contact.company" => "company",
                                            "contact.location" => "location",
                                            _ => "email",
                                        };
                                        let sql = format!("SELECT {} FROM contacts WHERE id = $1", col);
                                        sqlx::query_scalar::<_, String>(&sql)
                                            .bind(cid).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                "contact.identified" => {
                                    // Returns "true" if a contact with non-empty email is linked
                                    if let Some(ref cid) = sess_contact {
                                        let email: String = sqlx::query_scalar("SELECT email FROM contacts WHERE id = $1")
                                            .bind(cid).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default();
                                        if email.is_empty() { "false".to_string() } else { "true".to_string() }
                                    } else { "false".to_string() }
                                }
                                "contact_attribute" => {
                                    if let Some(ref cid) = sess_contact {
                                        sqlx::query_scalar::<_, String>(
                                            "SELECT attribute_value FROM contact_custom_attributes WHERE contact_id = $1 AND attribute_key = $2"
                                        ).bind(cid).bind(attr_key).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                "conversation_attribute" => {
                                    sqlx::query_scalar::<_, String>(
                                        "SELECT attribute_value FROM conversation_custom_attributes WHERE session_id = $1 AND attribute_key = $2"
                                    ).bind(&session_id).bind(attr_key).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                }
                                other if other.starts_with("contact_attr.") => {
                                    let key = &other["contact_attr.".len()..];
                                    if let Some(ref cid) = sess_contact {
                                        sqlx::query_scalar::<_, String>(
                                            "SELECT attribute_value FROM contact_custom_attributes WHERE contact_id = $1 AND attribute_key = $2"
                                        ).bind(cid).bind(key).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                    } else { String::new() }
                                }
                                other if other.starts_with("conv_attr.") => {
                                    let key = &other["conv_attr.".len()..];
                                    sqlx::query_scalar::<_, String>(
                                        "SELECT attribute_value FROM conversation_custom_attributes WHERE session_id = $1 AND attribute_key = $2"
                                    ).bind(&session_id).bind(key).fetch_optional(&state.db).await.ok().flatten().unwrap_or_default()
                                }
                                _ => String::new(),
                            };

                            let actual_lower = actual.to_ascii_lowercase();
                            let value_lower = value.to_ascii_lowercase();

                            let result = match operator {
                                "equals" => actual_lower == value_lower,
                                "not_equals" => actual_lower != value_lower,
                                "contains" => actual_lower.contains(&value_lower),
                                "not_contains" => !actual_lower.contains(&value_lower),
                                "starts_with" => actual_lower.starts_with(&value_lower),
                                "ends_with" => actual_lower.ends_with(&value_lower),
                                "is_empty" => actual.trim().is_empty(),
                                "is_not_empty" => !actual.trim().is_empty(),
                                "greater_than" => {
                                    actual.parse::<f64>().unwrap_or(0.0)
                                        > value.parse::<f64>().unwrap_or(0.0)
                                }
                                "less_than" => {
                                    actual.parse::<f64>().unwrap_or(0.0)
                                        < value.parse::<f64>().unwrap_or(0.0)
                                }
                                _ => actual_lower == value_lower,
                            };
                            results.push(result);
                        }

                        if logic_op == "or" {
                            results.iter().any(|r| *r)
                        } else {
                            results.iter().all(|r| *r)
                        }
                    }
                } else {
                    // Legacy fallback: old "contains" field
                    let contains = flow_node_data_text(&node, "contains")
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    !contains.is_empty()
                        && visitor_text.to_ascii_lowercase().contains(contains.trim())
                };

                let desired = if matches { "true" } else { "else" };
                let next = edges
                    .iter()
                    .find(|edge| flow_edge_condition(edge) == desired)
                    .or_else(|| {
                        // Also check for legacy "false" handle
                        if !matches {
                            edges
                                .iter()
                                .find(|edge| flow_edge_condition(edge) == "false")
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        edges
                            .iter()
                            .find(|edge| flow_edge_condition(edge) == "default")
                    })
                    .or_else(|| edges.first())
                    .map(|edge| edge.target.clone());
                if let Some(next_id) = next {
                    current_id = next_id;
                    continue;
                }
                break;
            }
            "end" => {
                let behavior = node
                    .data
                    .get("behavior")
                    .and_then(Value::as_str)
                    .unwrap_or("stop");
                match behavior {
                    "close" => {
                        let close_msg = node
                            .data
                            .get("closeMessage")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        if !close_msg.is_empty() {
                            send_flow_agent_message(
                                state.clone(),
                                &session_id,
                                close_msg,
                                300,
                                None,
                                None,
                            )
                            .await;
                        }
                        if let Some((summary, changed)) =
                            set_session_status(&state, &session_id, "closed").await
                        {
                            emit_session_update(&state, summary).await;
                            if changed {
                                let _ = add_message(
                                    state.clone(),
                                    &session_id,
                                    "system",
                                    "Conversation closed by bot",
                                    None,
                                    None,
                                )
                                .await;
                            }
                        }
                    }
                    "handover" => {
                        let handover_msg = node
                            .data
                            .get("handoverMessage")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        if !handover_msg.is_empty() {
                            send_flow_agent_message(
                                state.clone(),
                                &session_id,
                                handover_msg,
                                300,
                                None,
                                None,
                            )
                            .await;
                        }
                        if let Some((summary, changed)) =
                            set_session_handover(&state, &session_id, true).await
                        {
                            emit_session_update(&state, summary).await;
                            if changed {
                                let _ = add_message(
                                    state.clone(),
                                    &session_id,
                                    "system",
                                    "Conversation transferred to a human agent",
                                    None,
                                    None,
                                )
                                .await;
                            }
                        }
                    }
                    _ => { /* "stop" — just break, keep session open */ }
                }
                clear_flow_cursor(&state, &session_id).await;
                break;
            }
            "wait" => {
                let duration = flow_node_data_u64(&node, "duration").unwrap_or(60);
                let unit = node
                    .data
                    .get("unit")
                    .and_then(Value::as_str)
                    .unwrap_or("seconds");
                let millis: u64 = match unit {
                    "minutes" => duration * 60 * 1000,
                    "hours" => duration * 60 * 60 * 1000,
                    "days" => duration * 24 * 60 * 60 * 1000,
                    _ => duration * 1000, // seconds
                };
                // Cap at 5 minutes for in-flow waits to prevent hanging
                let capped = millis.min(300_000);
                tokio::time::sleep(tokio::time::Duration::from_millis(capped)).await;
            }
            "assign" => {
                let assign_to = node
                    .data
                    .get("assignTo")
                    .and_then(Value::as_str)
                    .unwrap_or("team");
                let msg = node
                    .data
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                // Enable handover so a human agent picks up
                if let Some((summary, _changed)) =
                    set_session_handover(&state, &session_id, true).await
                {
                    emit_session_update(&state, summary).await;
                }
                let assignment_note = if assign_to == "agent" {
                    let email = node
                        .data
                        .get("agentEmail")
                        .and_then(Value::as_str)
                        .unwrap_or("unassigned");
                    // Try to find agent by email and actually assign
                    let agent_id =
                        sqlx::query_scalar::<_, String>("SELECT id FROM agents WHERE email = $1")
                            .bind(email)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten();
                    if let Some(aid) = &agent_id {
                        let _ = sqlx::query("UPDATE sessions SET assignee_agent_id = $1, updated_at = $2 WHERE id = $3")
                            .bind(aid)
                            .bind(now_iso())
                            .bind(&session_id)
                            .execute(&state.db)
                            .await;
                        if let Some(s) = get_session_summary_db(&state.db, &session_id).await {
                            emit_session_update(&state, s).await;
                        }
                    }
                    format!("Conversation assigned to agent: {}", email)
                } else {
                    let team_name = node
                        .data
                        .get("teamName")
                        .and_then(Value::as_str)
                        .unwrap_or("default");
                    // Try to find team by name and actually assign
                    let team_id =
                        sqlx::query_scalar::<_, String>("SELECT id FROM teams WHERE name = $1")
                            .bind(team_name)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten();
                    if let Some(tid) = &team_id {
                        let _ = sqlx::query(
                            "UPDATE sessions SET team_id = $1, updated_at = $2 WHERE id = $3",
                        )
                        .bind(tid)
                        .bind(now_iso())
                        .bind(&session_id)
                        .execute(&state.db)
                        .await;
                        if let Some(s) = get_session_summary_db(&state.db, &session_id).await {
                            emit_session_update(&state, s).await;
                        }
                    }
                    format!("Conversation assigned to team: {}", team_name)
                };
                let _ = add_message(
                    state.clone(),
                    &session_id,
                    "system",
                    &assignment_note,
                    None,
                    None,
                )
                .await;
                if !msg.is_empty() {
                    send_flow_agent_message(state.clone(), &session_id, msg, 300, None, None).await;
                }
            }
            "close_conversation" => {
                let msg = node
                    .data
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                let send_csat = node
                    .data
                    .get("sendCsat")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if send_csat {
                    let csat_text = "How would you rate your experience?";
                    let widget = Some(serde_json::json!({
                        "type": "csat",
                        "question": csat_text
                    }));
                    send_flow_agent_message(
                        state.clone(),
                        &session_id,
                        csat_text,
                        420,
                        None,
                        widget,
                    )
                    .await;
                    // Pause for CSAT response
                    save_flow_cursor(
                        &state,
                        &session_id,
                        &flow.id,
                        &node.id,
                        "close_conversation",
                        &flow_vars,
                    )
                    .await;
                    return;
                }
                if !msg.is_empty() {
                    send_flow_agent_message(state.clone(), &session_id, msg, 300, None, None).await;
                }
                if let Some((summary, changed)) =
                    set_session_status(&state, &session_id, "closed").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation closed by bot",
                            None,
                            None,
                        )
                        .await;
                    }
                }
                clear_flow_cursor(&state, &session_id).await;
                break;
            }
            "csat" => {
                let text = flow_node_data_text(&node, "text")
                    .unwrap_or_else(|| "How would you rate your experience?".to_string());
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                let widget = Some(serde_json::json!({
                    "type": "csat",
                    "question": text
                }));
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms, None, widget)
                    .await;
                // Pause for rating response
                save_flow_cursor(&state, &session_id, &flow.id, &node.id, "csat", &flow_vars).await;
                return;
            }
            "tag" => {
                let action = node
                    .data
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("add");
                let tags: Vec<String> = node
                    .data
                    .get("tags")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(|s| s.to_string())
                            .filter(|s| !s.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();
                if !tags.is_empty() {
                    // Get tenant_id for this session
                    let sess_tenant = sqlx::query_scalar::<_, String>(
                        "SELECT tenant_id FROM sessions WHERE id = $1",
                    )
                    .bind(&session_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| state.default_tenant_id.clone());

                    for tag_name in &tags {
                        if action == "remove" {
                            // Remove tag from conversation
                            let _ = sqlx::query(
                                "DELETE FROM conversation_tags WHERE session_id = $1 AND tag_id IN (SELECT id FROM tags WHERE tenant_id = $2 AND name = $3)",
                            )
                            .bind(&session_id)
                            .bind(&sess_tenant)
                            .bind(tag_name)
                            .execute(&state.db)
                            .await;
                        } else {
                            // Ensure tag exists, then link it
                            let tag_id = Uuid::new_v4().to_string();
                            let _ = sqlx::query(
                                "INSERT INTO tags (id, tenant_id, name, color, created_at) VALUES ($1,$2,$3,'#6366f1',$4) ON CONFLICT (tenant_id, name) DO NOTHING",
                            )
                            .bind(&tag_id)
                            .bind(&sess_tenant)
                            .bind(tag_name)
                            .bind(now_iso())
                            .execute(&state.db)
                            .await;
                            // Get the real tag id (might be existing)
                            let real_tag_id = sqlx::query_scalar::<_, String>(
                                "SELECT id FROM tags WHERE tenant_id = $1 AND name = $2",
                            )
                            .bind(&sess_tenant)
                            .bind(tag_name)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten()
                            .unwrap_or(tag_id);
                            let _ = sqlx::query(
                                "INSERT INTO conversation_tags (session_id, tag_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                            )
                            .bind(&session_id)
                            .bind(&real_tag_id)
                            .bind(now_iso())
                            .execute(&state.db)
                            .await;
                        }
                    }
                    let note = format!(
                        "Tags {}: {}",
                        if action == "remove" {
                            "removed"
                        } else {
                            "added"
                        },
                        tags.join(", ")
                    );
                    let _ =
                        add_message(state.clone(), &session_id, "system", &note, None, None).await;
                }
            }
            "set_attribute" => {
                let target = node
                    .data
                    .get("target")
                    .and_then(Value::as_str)
                    .unwrap_or("contact");
                let attr_name = node
                    .data
                    .get("attributeName")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let attr_value_raw = node
                    .data
                    .get("attributeValue")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                // Interpolate flow variables in the value
                let attr_value = interpolate_flow_vars(attr_value_raw, &flow_vars);
                if !attr_name.is_empty() {
                    let now = now_iso();
                    if target == "conversation" {
                        let attr_id = Uuid::new_v4().to_string();
                        let _ = sqlx::query(
                            r#"INSERT INTO conversation_custom_attributes (id, session_id, attribute_key, attribute_value, created_at, updated_at)
                               VALUES ($1,$2,$3,$4,$5,$6)
                               ON CONFLICT (session_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value, updated_at = EXCLUDED.updated_at"#,
                        )
                        .bind(&attr_id)
                        .bind(&session_id)
                        .bind(attr_name)
                        .bind(&attr_value)
                        .bind(&now)
                        .bind(&now)
                        .execute(&state.db)
                        .await;
                    } else {
                        // ── Contact target ──
                        // If setting email, find-or-create contact and link to session
                        if attr_name == "email" && !attr_value.is_empty() {
                            resolve_contact_by_email(&state, &session_id, &attr_value).await;
                        }

                        // For core contact fields (name, phone), update directly
                        let is_core_field = matches!(
                            attr_name,
                            "name" | "email" | "phone" | "company" | "location"
                        );
                        if is_core_field {
                            let col = match attr_name {
                                "name" => "display_name",
                                "email" => "email",
                                "phone" => "phone",
                                "company" => "company",
                                "location" => "location",
                                _ => "",
                            };
                            if !col.is_empty() {
                                let contact_id = sqlx::query_scalar::<_, Option<String>>(
                                    "SELECT contact_id FROM sessions WHERE id = $1",
                                )
                                .bind(&session_id)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .flatten();
                                if let Some(cid) = contact_id {
                                    let q = format!("UPDATE contacts SET {} = $1, updated_at = $2 WHERE id = $3", col);
                                    let _ = sqlx::query(&q)
                                        .bind(&attr_value)
                                        .bind(&now)
                                        .bind(&cid)
                                        .execute(&state.db)
                                        .await;
                                }
                            }
                        } else {
                            // Custom attribute on the linked contact (if any)
                            let contact_id = sqlx::query_scalar::<_, Option<String>>(
                                "SELECT contact_id FROM sessions WHERE id = $1",
                            )
                            .bind(&session_id)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten()
                            .flatten();
                            if let Some(cid) = contact_id {
                                let attr_id = Uuid::new_v4().to_string();
                                let _ = sqlx::query(
                                    r#"INSERT INTO contact_custom_attributes (id, contact_id, attribute_key, attribute_value, created_at, updated_at)
                                       VALUES ($1,$2,$3,$4,$5,$6)
                                       ON CONFLICT (contact_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value, updated_at = EXCLUDED.updated_at"#,
                                )
                                .bind(&attr_id)
                                .bind(&cid)
                                .bind(attr_name)
                                .bind(&attr_value)
                                .bind(&now)
                                .bind(&now)
                                .execute(&state.db)
                                .await;
                            }
                        }
                    }
                    let note = format!("Set {} attribute: {} = {}", target, attr_name, attr_value);
                    let _ =
                        add_message(state.clone(), &session_id, "system", &note, None, None).await;
                }
            }
            "note" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                if !text.is_empty() {
                    // Persist as a real conversation note
                    let note_id = Uuid::new_v4().to_string();
                    let sess_tenant = sqlx::query_scalar::<_, String>(
                        "SELECT tenant_id FROM sessions WHERE id = $1",
                    )
                    .bind(&session_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| state.default_tenant_id.clone());
                    let _ = sqlx::query(
                        "INSERT INTO conversation_notes (id, tenant_id, session_id, agent_id, text, created_at) VALUES ($1,$2,$3,'bot',$4,$5)",
                    )
                    .bind(&note_id)
                    .bind(&sess_tenant)
                    .bind(&session_id)
                    .bind(&text)
                    .bind(now_iso())
                    .execute(&state.db)
                    .await;
                    // Also send as internal note message
                    let _ =
                        add_message(state.clone(), &session_id, "note", &text, None, None).await;
                }
            }
            "webhook" => {
                let url = node
                    .data
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let method = node
                    .data
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or("POST");
                let body_str = node
                    .data
                    .get("body")
                    .and_then(Value::as_str)
                    .unwrap_or("{}");
                let headers_str = node
                    .data
                    .get("headers")
                    .and_then(Value::as_str)
                    .unwrap_or("{}");
                if !url.is_empty() {
                    let client = reqwest::Client::new();
                    let mut req = match method {
                        "GET" => client.get(&url),
                        "PUT" => client.put(&url),
                        "PATCH" => client.patch(&url),
                        "DELETE" => client.delete(&url),
                        _ => client.post(&url),
                    };
                    // Parse and apply custom headers
                    if let Ok(hdrs) =
                        serde_json::from_str::<serde_json::Map<String, Value>>(headers_str)
                    {
                        for (k, v) in hdrs {
                            if let Some(val) = v.as_str() {
                                req = req.header(k.as_str(), val);
                            }
                        }
                    }
                    if method != "GET" && method != "DELETE" {
                        req = req
                            .header("Content-Type", "application/json")
                            .body(body_str.to_string());
                    }
                    // Fire-and-forget, ignore errors
                    let _ = req.send().await;
                }
            }
            "start_flow" => {
                let target_flow_id = node
                    .data
                    .get("flowId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let ai_collect = node
                    .data
                    .get("aiCollectInputs")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !target_flow_id.is_empty() {
                    if let Some(target_flow) = get_flow_by_id_db(&state.db, target_flow_id).await {
                        // Build initial variables for the sub-flow from bindings
                        let mut sub_vars = HashMap::new();
                        if let Some(bindings) =
                            node.data.get("variableBindings").and_then(Value::as_object)
                        {
                            for (key, val) in bindings {
                                let raw = val.as_str().unwrap_or("");
                                let interpolated = interpolate_flow_vars(raw, &flow_vars);
                                sub_vars.insert(key.clone(), interpolated);
                            }
                        }
                        // Also carry over any current flow vars not explicitly bound
                        for (k, v) in &flow_vars {
                            sub_vars.entry(k.clone()).or_insert_with(|| v.clone());
                        }

                        // Check for missing required vars
                        let missing = find_missing_required_vars(&target_flow, &sub_vars);
                        if !missing.is_empty() && ai_collect {
                            // Store the target flow id + collected sub_vars in flow_vars for resume
                            flow_vars.insert(
                                "__sf_target_flow_id".to_string(),
                                target_flow_id.to_string(),
                            );
                            flow_vars.insert(
                                "__sf_sub_vars".to_string(),
                                serde_json::to_string(&sub_vars).unwrap_or_default(),
                            );

                            // Ask the AI to collect the missing fields
                            let fields_desc: Vec<String> = target_flow
                                .input_variables
                                .iter()
                                .filter(|v| v.required)
                                .filter(|v| {
                                    sub_vars
                                        .get(&v.key)
                                        .map(|val| val.trim().is_empty())
                                        .unwrap_or(true)
                                })
                                .map(|v| {
                                    if v.label.is_empty() {
                                        v.key.clone()
                                    } else {
                                        v.label.clone()
                                    }
                                })
                                .collect();
                            let ask_prompt = format!(
                                "You need to collect the following information from the user before proceeding: [{}]. \
                                 Ask for these values in a friendly conversational way. Be concise.",
                                fields_desc.join(", ")
                            );
                            let ai_reply = generate_ai_reply(
                                state.clone(),
                                &session_id,
                                &ask_prompt,
                                &visitor_text,
                            )
                            .await;
                            send_flow_agent_message(
                                state.clone(),
                                &session_id,
                                &ai_reply.reply,
                                500,
                                None,
                                None,
                            )
                            .await;
                            // Pause: save cursor at this start_flow node
                            save_flow_cursor(
                                &state,
                                &session_id,
                                &flow.id,
                                &node.id,
                                "start_flow",
                                &flow_vars,
                            )
                            .await;
                            return;
                        }

                        // Execute the sub-flow on the same session (boxed to allow recursion)
                        Box::pin(execute_flow_from(
                            state.clone(),
                            session_id.clone(),
                            target_flow,
                            visitor_text.clone(),
                            None,
                            sub_vars,
                        ))
                        .await;
                        // After sub-flow, continue to next node in current flow
                    }
                }
            }
            _ => {
                if let Some(text) = flow_node_data_text(&node, "text") {
                    send_flow_agent_message(state.clone(), &session_id, &text, 320, None, None)
                        .await;
                }
            }
        }

        let Some(next_id) = edges.first().map(|edge| edge.target.clone()) else {
            break;
        };
        current_id = next_id;
    }

    // If we finished the loop without pausing, make sure cursor is cleared
    clear_flow_cursor(&state, &session_id).await;
}

async fn run_flow_for_visitor_message(
    state: Arc<AppState>,
    session_id: String,
    visitor_text: String,
    trigger_event: &str,
) {
    if trigger_event == "visitor_message" && has_handover_intent(&visitor_text) {
        if let Some((summary, changed)) = set_session_handover(&state, &session_id, true).await {
            emit_session_update(&state, summary).await;
            if changed {
                let _ = add_message(
                    state.clone(),
                    &session_id,
                    "system",
                    "Conversation transferred to a human agent",
                    None,
                    None,
                )
                .await;
            }
        }
        send_flow_agent_message(
            state,
            &session_id,
            "Understood. I am transferring you to a human agent now.",
            450,
            None,
            None,
        )
        .await;
        return;
    }

    let handover_active =
        sqlx::query_scalar::<_, bool>("SELECT handover_active FROM sessions WHERE id = $1")
            .bind(&session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(false);
    if handover_active {
        return;
    }

    // ── Check for existing flow cursor (resume interactive node) ──
    if trigger_event == "visitor_message" {
        if let Some((cursor_flow_id, cursor_node_id, _cursor_node_type, cursor_vars)) =
            get_flow_cursor(&state, &session_id).await
        {
            // We have a paused flow — resume it from the paused node
            if let Some(flow) = get_flow_by_id_db(&state.db, &cursor_flow_id).await {
                execute_flow_from(
                    state,
                    session_id,
                    flow,
                    visitor_text,
                    Some(cursor_node_id),
                    cursor_vars,
                )
                .await;
                return;
            } else {
                // Flow was deleted — clear stale cursor and continue normally
                clear_flow_cursor(&state, &session_id).await;
            }
        }
    }

    if trigger_event == "page_open" || trigger_event == "widget_open" {
        let first_fire = mark_trigger_fired_once(&state, &session_id, trigger_event).await;
        if !first_fire {
            return;
        }
    }

    let first_visitor_message = if trigger_event == "visitor_message" {
        is_first_visitor_message(&state, &session_id).await
    } else {
        false
    };

    let assigned_flow_id =
        sqlx::query_scalar::<_, Option<String>>("SELECT flow_id FROM sessions WHERE id = $1")
            .bind(&session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();

    let flow = if let Some(flow_id) = assigned_flow_id {
        get_flow_by_id_db(&state.db, &flow_id).await
    } else {
        let row = sqlx::query(
            "SELECT id FROM flows WHERE enabled = true ORDER BY created_at ASC LIMIT 1",
        )
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        if let Some(row) = row {
            let flow_id: String = row.get("id");
            get_flow_by_id_db(&state.db, &flow_id).await
        } else {
            None
        }
    };

    if let Some(flow) = flow {
        if flow_trigger_matches_event(&flow, &visitor_text, trigger_event, first_visitor_message) {
            execute_flow(state, session_id, flow, visitor_text).await;
            return;
        }

        if trigger_event == "visitor_message" {
            let flow_prompt = flow
                .nodes
                .iter()
                .find(|node| node.node_type == "ai")
                .and_then(|node| flow_node_data_text(node, "prompt"))
                .unwrap_or_else(|| {
                    "You are a helpful support agent. Use the full conversation context, including user-provided names."
                        .to_string()
                });

            let decision =
                generate_ai_reply(state.clone(), &session_id, &flow_prompt, &visitor_text).await;
            let suggestions_opt = if decision.suggestions.is_empty() {
                None
            } else {
                Some(decision.suggestions.clone())
            };
            send_flow_agent_message(
                state.clone(),
                &session_id,
                &decision.reply,
                700,
                suggestions_opt,
                None,
            )
            .await;
            if decision.handover {
                if let Some((summary, changed)) =
                    set_session_handover(&state, &session_id, true).await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation transferred to a human agent",
                            None,
                            None,
                        )
                        .await;
                    }
                }
            }
            if decision.close_chat {
                if let Some((summary, changed)) =
                    set_session_status(&state, &session_id, "closed").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation closed by bot",
                            None,
                            None,
                        )
                        .await;
                    }
                }
            }
            // Handle AI-triggered flow
            if let Some((trigger_flow_id, trigger_vars)) = decision.trigger_flow {
                if let Some(target_flow) = get_flow_by_id_db(&state.db, &trigger_flow_id).await {
                    let missing = find_missing_required_vars(&target_flow, &trigger_vars);
                    if missing.is_empty() {
                        execute_flow_from(
                            state,
                            session_id,
                            target_flow,
                            visitor_text,
                            None,
                            trigger_vars,
                        )
                        .await;
                        return;
                    } else {
                        // Missing required fields — ask the AI to collect them
                        let retry_prompt = format!(
                            "You tried to trigger the tool \"{}\" but the following REQUIRED parameters are missing: [{}]. \
                             Ask the user to provide these values. Do NOT trigger the tool until you have all required data.",
                            target_flow.name,
                            missing.join(", ")
                        );
                        let retry = generate_ai_reply(
                            state.clone(),
                            &session_id,
                            &retry_prompt,
                            &visitor_text,
                        )
                        .await;
                        send_flow_agent_message(
                            state.clone(),
                            &session_id,
                            &retry.reply,
                            600,
                            None,
                            None,
                        )
                        .await;
                    }
                }
            }
        }
        return;
    }

    if visitor_text.trim().eq_ignore_ascii_case("okay") {
        send_flow_agent_message(state, &session_id, "Glad I could help!", 900, None, None).await;
    }
}

async fn post_session(
    State(state): State<Arc<AppState>>,
    body: Option<Json<Value>>,
) -> impl IntoResponse {
    let session_id = Uuid::new_v4().to_string();
    let _ = ensure_session(state.clone(), &session_id).await;

    // If visitor sent a visitorId, resolve their contact from previous sessions
    let visitor_id = body
        .as_ref()
        .and_then(|b| b.get("visitorId"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !visitor_id.is_empty() {
        resolve_contact_from_visitor_id(&state, &session_id, visitor_id).await;
    }

    (
        StatusCode::CREATED,
        Json(json!({ "sessionId": session_id })),
    )
}

async fn get_sessions(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let tenant_filter = match bearer_token(&headers) {
        Some(token) => {
            sqlx::query_scalar::<_, String>("SELECT tenant_id FROM auth_tokens WHERE token = $1")
                .bind(token)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
        }
        None => None,
    };
    let rows = if let Some(tenant_id) = tenant_filter {
        sqlx::query("SELECT id FROM sessions WHERE tenant_id = $1 ORDER BY updated_at DESC")
            .bind(tenant_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
    } else {
        sqlx::query("SELECT id FROM sessions ORDER BY updated_at DESC")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
    };
    let mut list = Vec::with_capacity(rows.len());
    for row in rows {
        let session_id: String = row.get("id");
        if let Some(summary) = get_session_summary_db(&state.db, &session_id).await {
            list.push(summary);
        }
    }

    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Json(json!({ "sessions": list }))
}

async fn get_messages(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let _ = ensure_session(state.clone(), &session_id).await;
    let messages = get_session_messages_db(&state.db, &session_id).await;
    Json(json!({ "messages": visible_messages_for_widget(&messages) }))
}

async fn post_message(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SendMessageBody>,
) -> impl IntoResponse {
    if body.text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "text is required" })),
        )
            .into_response();
    }

    let sender = match body.sender.as_deref() {
        Some("team") => "team",
        Some("agent") => "agent",
        _ => "visitor",
    };

    let target_session_id = if sender == "visitor" {
        let (target, _switched) = resolve_visitor_target_session(state.clone(), &session_id).await;
        target
    } else {
        session_id.clone()
    };

    let _ = ensure_session(state.clone(), &target_session_id).await;

    let Some(message) = add_message(
        state.clone(),
        &target_session_id,
        sender,
        &body.text,
        None,
        None,
    )
    .await
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "unable to create message" })),
        )
            .into_response();
    };

    if sender == "visitor" {
        let state_clone = state.clone();
        let session_clone = target_session_id.clone();
        let text_clone = body.text.clone();
        tokio::spawn(async move {
            run_flow_for_visitor_message(state_clone, session_clone, text_clone, "visitor_message")
                .await;
        });
    }

    (
        StatusCode::CREATED,
        Json(json!({ "message": message, "sessionId": target_session_id })),
    )
        .into_response()
}

async fn close_session_by_visitor(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let _ = ensure_session(state.clone(), &session_id).await;

    let Some((summary, changed)) = set_session_status(&state, &session_id, "closed").await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };

    emit_session_update(&state, summary).await;

    if changed {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "User has ended the chat",
            None,
            None,
        )
        .await;
    }

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn register_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> impl IntoResponse {
    let email = body.email.trim().to_lowercase();
    let name = body.name.trim().to_string();
    if email.is_empty() || name.is_empty() || body.password.trim().len() < 6 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid registration payload" })),
        )
            .into_response();
    }

    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM agents WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
        > 0;
    if exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "email already registered" })),
        )
            .into_response();
    }

    let password_hash = match hash(body.password, DEFAULT_COST) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "unable to hash password" })),
            )
                .into_response()
        }
    };

    let profile = AgentProfile {
        id: Uuid::new_v4().to_string(),
        name,
        email,
        status: "online".to_string(),
        team_ids: vec![],
        inbox_ids: vec![],
    };

    let token = Uuid::new_v4().to_string();
    let tenant_id = state.default_tenant_id.clone();
    let team_ids = serde_json::to_string(&profile.team_ids).unwrap_or_else(|_| "[]".to_string());
    let inbox_ids = serde_json::to_string(&profile.inbox_ids).unwrap_or_else(|_| "[]".to_string());
    if sqlx::query(
        "INSERT INTO agents (id, tenant_id, name, email, status, password_hash, team_ids, inbox_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(&profile.id)
    .bind(&tenant_id)
    .bind(&profile.name)
    .bind(&profile.email)
    .bind(&profile.status)
    .bind(&password_hash)
    .bind(team_ids)
    .bind(inbox_ids)
    .execute(&state.db)
    .await
    .is_err()
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create agent" })),
        )
            .into_response();
    }

    let _ = sqlx::query(
        "INSERT INTO auth_tokens (token, agent_id, tenant_id, created_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(&token)
    .bind(&profile.id)
    .bind(&tenant_id)
    .bind(now_iso())
    .execute(&state.db)
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "token": token,
            "agent": profile,
            "tenantId": state.default_tenant_id
        })),
    )
        .into_response()
}

async fn login_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let email = body.email.trim().to_lowercase();
    let row = sqlx::query(
        "SELECT id, tenant_id, name, email, status, password_hash, team_ids, inbox_ids FROM agents WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some(row) = row else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid credentials" })),
        )
            .into_response();
    };
    let profile = AgentProfile {
        id: row.get("id"),
        name: row.get("name"),
        email: row.get("email"),
        status: row.get("status"),
        team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
            .unwrap_or_default(),
        inbox_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("inbox_ids"))
            .unwrap_or_default(),
    };
    let tenant_id: String = row.get("tenant_id");
    let password_hash: String = row.get("password_hash");

    let valid = verify(body.password, &password_hash).unwrap_or(false);
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid credentials" })),
        )
            .into_response();
    }

    let token = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO auth_tokens (token, agent_id, tenant_id, created_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(&token)
    .bind(&profile.id)
    .bind(&tenant_id)
    .bind(now_iso())
    .execute(&state.db)
    .await;

    (
        StatusCode::OK,
        Json(json!({
            "token": token,
            "agent": profile,
            "tenantId": tenant_id
        })),
    )
        .into_response()
}

async fn get_me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let tenant_id = auth_tenant_from_headers(&state, &headers)
        .await
        .unwrap_or_else(|_| state.default_tenant_id.clone());
    match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => (
            StatusCode::OK,
            Json(json!({ "agent": agent, "tenantId": tenant_id })),
        )
            .into_response(),
        Err(err) => err.into_response(),
    }
}

async fn patch_agent_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<StatusBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };

    let status = body.status.trim().to_string();
    let _ = sqlx::query("UPDATE agents SET status = $1 WHERE id = $2")
        .bind(&status)
        .bind(&agent.id)
        .execute(&state.db)
        .await;
    let mut updated = agent;
    updated.status = status;
    (StatusCode::OK, Json(json!({ "agent": updated }))).into_response()
}

async fn get_teams(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query("SELECT id, tenant_id, name, agent_ids FROM teams WHERE tenant_id = $1")
        .bind(&tenant_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let teams = rows
        .into_iter()
        .map(|row| Team {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            name: row.get("name"),
            agent_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("agent_ids"))
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "teams": teams }))).into_response()
}

async fn create_team(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateTeamBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }
    let team = Team {
        tenant_id,
        id: Uuid::new_v4().to_string(),
        name,
        agent_ids: vec![],
    };
    let _ = sqlx::query("INSERT INTO teams (id, tenant_id, name, agent_ids) VALUES ($1,$2,$3,$4)")
        .bind(&team.id)
        .bind(&team.tenant_id)
        .bind(&team.name)
        .bind("[]")
        .execute(&state.db)
        .await;
    (StatusCode::CREATED, Json(json!({ "team": team }))).into_response()
}

async fn add_member_to_team(
    Path(team_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AssignBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let agent_id = body.agent_id.trim().to_string();
    let team_row = sqlx::query("SELECT agent_ids FROM teams WHERE id = $1")
        .bind(&team_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(team_row) = team_row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "team not found" })),
        )
            .into_response();
    };
    let mut team_agent_ids =
        serde_json::from_str::<Vec<String>>(&team_row.get::<String, _>("agent_ids"))
            .unwrap_or_default();
    if !team_agent_ids.contains(&agent_id) {
        team_agent_ids.push(agent_id.clone());
    }
    let _ = sqlx::query("UPDATE teams SET agent_ids = $1 WHERE id = $2")
        .bind(serde_json::to_string(&team_agent_ids).unwrap_or_else(|_| "[]".to_string()))
        .bind(&team_id)
        .execute(&state.db)
        .await;

    let agent_row = sqlx::query("SELECT team_ids FROM agents WHERE id = $1")
        .bind(&agent_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    if let Some(agent_row) = agent_row {
        let mut team_ids =
            serde_json::from_str::<Vec<String>>(&agent_row.get::<String, _>("team_ids"))
                .unwrap_or_default();
        if !team_ids.contains(&team_id) {
            team_ids.push(team_id.clone());
            let _ = sqlx::query("UPDATE agents SET team_ids = $1 WHERE id = $2")
                .bind(serde_json::to_string(&team_ids).unwrap_or_else(|_| "[]".to_string()))
                .bind(&agent_id)
                .execute(&state.db)
                .await;
        }
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn get_inboxes(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, name, channels, agent_ids FROM inboxes WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let inboxes = rows
        .into_iter()
        .map(|row| Inbox {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            name: row.get("name"),
            channels: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("channels"))
                .unwrap_or_default(),
            agent_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("agent_ids"))
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "inboxes": inboxes }))).into_response()
}

async fn get_agents(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows = sqlx::query("SELECT id, name, email, status, team_ids, inbox_ids FROM agents")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let agents = rows
        .into_iter()
        .map(|row| AgentProfile {
            id: row.get("id"),
            name: row.get("name"),
            email: row.get("email"),
            status: row.get("status"),
            team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
                .unwrap_or_default(),
            inbox_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("inbox_ids"))
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "agents": agents }))).into_response()
}

async fn create_inbox(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateInboxBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }
    let inbox = Inbox {
        tenant_id,
        id: Uuid::new_v4().to_string(),
        name,
        channels: body.channels,
        agent_ids: vec![],
    };
    let _ = sqlx::query(
        "INSERT INTO inboxes (id, tenant_id, name, channels, agent_ids) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&inbox.id)
    .bind(&inbox.tenant_id)
    .bind(&inbox.name)
    .bind(serde_json::to_string(&inbox.channels).unwrap_or_else(|_| "[]".to_string()))
    .bind("[]")
    .execute(&state.db)
    .await;
    (StatusCode::CREATED, Json(json!({ "inbox": inbox }))).into_response()
}

async fn assign_agent_to_inbox(
    Path(inbox_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AssignBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let agent_id = body.agent_id.trim().to_string();
    let inbox_row = sqlx::query("SELECT agent_ids FROM inboxes WHERE id = $1")
        .bind(&inbox_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(inbox_row) = inbox_row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "inbox not found" })),
        )
            .into_response();
    };
    let mut inbox_agent_ids =
        serde_json::from_str::<Vec<String>>(&inbox_row.get::<String, _>("agent_ids"))
            .unwrap_or_default();
    if !inbox_agent_ids.contains(&agent_id) {
        inbox_agent_ids.push(agent_id.clone());
        let _ = sqlx::query("UPDATE inboxes SET agent_ids = $1 WHERE id = $2")
            .bind(serde_json::to_string(&inbox_agent_ids).unwrap_or_else(|_| "[]".to_string()))
            .bind(&inbox_id)
            .execute(&state.db)
            .await;
    }
    let agent_row = sqlx::query("SELECT inbox_ids FROM agents WHERE id = $1")
        .bind(&agent_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    if let Some(agent_row) = agent_row {
        let mut inbox_ids =
            serde_json::from_str::<Vec<String>>(&agent_row.get::<String, _>("inbox_ids"))
                .unwrap_or_default();
        if !inbox_ids.contains(&inbox_id) {
            inbox_ids.push(inbox_id.clone());
            let _ = sqlx::query("UPDATE agents SET inbox_ids = $1 WHERE id = $2")
                .bind(serde_json::to_string(&inbox_ids).unwrap_or_else(|_| "[]".to_string()))
                .bind(&agent_id)
                .execute(&state.db)
                .await;
        }
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn patch_session_assignee(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionAssigneeBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let affected =
        sqlx::query("UPDATE sessions SET assignee_agent_id = $1, updated_at = $2 WHERE id = $3")
            .bind(&body.agent_id)
            .bind(now_iso())
            .bind(&session_id)
            .execute(&state.db)
            .await
            .ok()
            .map(|r| r.rows_affected())
            .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    }
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_channel(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionChannelBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let channel = body.channel.trim().to_string();
    if channel.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channel required" })),
        )
            .into_response();
    }
    let affected = sqlx::query("UPDATE sessions SET channel = $1, updated_at = $2 WHERE id = $3")
        .bind(&channel)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    }
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_inbox(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionInboxBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let affected = sqlx::query("UPDATE sessions SET inbox_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&body.inbox_id)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    }
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_team(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionTeamBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let affected = sqlx::query("UPDATE sessions SET team_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&body.team_id)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    }
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_flow(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionFlowBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    if let Some(flow_id) = body.flow_id.as_deref() {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM flows WHERE id = $1")
            .bind(flow_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
            > 0;
        if !exists {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "flow not found" })),
            )
                .into_response();
        }
    }

    let affected = sqlx::query("UPDATE sessions SET flow_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&body.flow_id)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    }
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_handover(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionHandoverBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let Some((summary, changed)) = set_session_handover(&state, &session_id, body.active).await
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };

    if changed && body.active {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "Conversation transferred to a human agent",
            None,
            None,
        )
        .await;
    }

    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn patch_session_meta(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionMetaBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let row = sqlx::query("SELECT status, priority FROM sessions WHERE id = $1")
        .bind(&session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(row) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    let previous_status: String = row.get("status");
    let mut next_status = previous_status.clone();
    let mut next_priority: String = row.get("priority");

    if let Some(status) = body.status {
        let normalized = status.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "open" | "resolved" | "awaiting" | "snoozed" | "closed" => next_status = normalized,
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid status" })),
                )
                    .into_response()
            }
        }
    }

    if let Some(priority) = body.priority {
        let normalized = priority.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "low" | "normal" | "high" | "urgent" => next_priority = normalized,
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid priority" })),
                )
                    .into_response()
            }
        }
    }
    let _ = sqlx::query(
        "UPDATE sessions SET status = $1, priority = $2, updated_at = $3 WHERE id = $4",
    )
    .bind(&next_status)
    .bind(&next_priority)
    .bind(now_iso())
    .bind(&session_id)
    .execute(&state.db)
    .await;
    let changed_to_closed = previous_status != "closed" && next_status == "closed";
    let changed_from_closed_to_open = previous_status == "closed" && next_status == "open";
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };

    if changed_to_closed {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "Conversation closed by agent",
            None,
            None,
        )
        .await;
    } else if changed_from_closed_to_open {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "Conversation reopened",
            None,
            None,
        )
        .await;
    }

    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

async fn get_canned_replies(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let rows = sqlx::query(
        "SELECT id, tenant_id, title, shortcut, category, body, created_at, updated_at FROM canned_replies WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let mut canned = rows
        .into_iter()
        .map(|row| CannedReply {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            title: row.get("title"),
            shortcut: row.get("shortcut"),
            category: row.get("category"),
            body: row.get("body"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect::<Vec<_>>();
    canned.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    (StatusCode::OK, Json(json!({ "cannedReplies": canned }))).into_response()
}

async fn create_canned_reply(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateCannedReplyBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let title = body.title.trim().to_string();
    let content = body.body.trim().to_string();
    if title.is_empty() || content.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "title and body are required" })),
        )
            .into_response();
    }

    let now = now_iso();
    let canned = CannedReply {
        tenant_id,
        id: Uuid::new_v4().to_string(),
        title,
        shortcut: body.shortcut.trim().to_string(),
        category: body.category.trim().to_string(),
        body: content,
        created_at: now.clone(),
        updated_at: now,
    };

    let _ = sqlx::query(
        "INSERT INTO canned_replies (id, tenant_id, title, shortcut, category, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(&canned.id)
    .bind(&canned.tenant_id)
    .bind(&canned.title)
    .bind(&canned.shortcut)
    .bind(&canned.category)
    .bind(&canned.body)
    .bind(&canned.created_at)
    .bind(&canned.updated_at)
    .execute(&state.db)
    .await;

    (StatusCode::CREATED, Json(json!({ "cannedReply": canned }))).into_response()
}

async fn update_canned_reply(
    Path(canned_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateCannedReplyBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let row = sqlx::query(
        "SELECT id, tenant_id, title, shortcut, category, body, created_at, updated_at FROM canned_replies WHERE id = $1",
    )
    .bind(&canned_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "canned reply not found" })),
        )
            .into_response();
    };
    let mut reply = CannedReply {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        title: row.get("title"),
        shortcut: row.get("shortcut"),
        category: row.get("category"),
        body: row.get("body"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    };

    if let Some(title) = body.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "title cannot be empty" })),
            )
                .into_response();
        }
        reply.title = trimmed.to_string();
    }
    if let Some(content) = body.body {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "body cannot be empty" })),
            )
                .into_response();
        }
        reply.body = trimmed.to_string();
    }
    if let Some(shortcut) = body.shortcut {
        reply.shortcut = shortcut.trim().to_string();
    }
    if let Some(category) = body.category {
        reply.category = category.trim().to_string();
    }
    reply.updated_at = now_iso();
    let _ = sqlx::query(
        "UPDATE canned_replies SET title = $1, shortcut = $2, category = $3, body = $4, updated_at = $5 WHERE id = $6",
    )
    .bind(&reply.title)
    .bind(&reply.shortcut)
    .bind(&reply.category)
    .bind(&reply.body)
    .bind(&reply.updated_at)
    .bind(&reply.id)
    .execute(&state.db)
    .await;

    (StatusCode::OK, Json(json!({ "cannedReply": &reply }))).into_response()
}

async fn delete_canned_reply(
    Path(canned_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let affected = sqlx::query("DELETE FROM canned_replies WHERE id = $1")
        .bind(&canned_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "canned reply not found" })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn get_flows(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let rows = sqlx::query(
        "SELECT id, tenant_id, name, description, enabled, created_at, updated_at, nodes, edges, input_variables, ai_tool, ai_tool_description FROM flows WHERE tenant_id = $1 ORDER BY created_at ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let mut flows = rows
        .into_iter()
        .map(|row| ChatFlow {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            name: row.get("name"),
            description: row.get("description"),
            enabled: row.get("enabled"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            nodes: serde_json::from_str::<Vec<FlowNode>>(&row.get::<String, _>("nodes"))
                .unwrap_or_default(),
            edges: serde_json::from_str::<Vec<FlowEdge>>(&row.get::<String, _>("edges"))
                .unwrap_or_default(),
            input_variables: serde_json::from_str(&row.get::<String, _>("input_variables"))
                .unwrap_or_default(),
            ai_tool: row.get("ai_tool"),
            ai_tool_description: row.get("ai_tool_description"),
        })
        .collect::<Vec<_>>();
    flows.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    (StatusCode::OK, Json(json!({ "flows": flows }))).into_response()
}

async fn get_flow(
    Path(flow_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let flow = get_flow_by_id_db(&state.db, &flow_id).await;
    let flow = flow.filter(|f| f.tenant_id == tenant_id);
    let Some(flow) = flow else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "flow not found" })),
        )
            .into_response();
    };

    (StatusCode::OK, Json(json!({ "flow": flow }))).into_response()
}

async fn create_flow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateFlowBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }

    let now = now_iso();
    let flow = ChatFlow {
        tenant_id,
        id: Uuid::new_v4().to_string(),
        name,
        description: body.description.trim().to_string(),
        enabled: body.enabled,
        created_at: now.clone(),
        updated_at: now,
        nodes: body.nodes,
        edges: body.edges,
        input_variables: body.input_variables,
        ai_tool: body.ai_tool,
        ai_tool_description: body.ai_tool_description,
    };

    let _ = sqlx::query(
        "INSERT INTO flows (id, tenant_id, name, description, enabled, created_at, updated_at, nodes, edges, input_variables, ai_tool, ai_tool_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(&flow.id)
    .bind(&flow.tenant_id)
    .bind(&flow.name)
    .bind(&flow.description)
    .bind(flow.enabled)
    .bind(&flow.created_at)
    .bind(&flow.updated_at)
    .bind(serde_json::to_string(&flow.nodes).unwrap_or_else(|_| "[]".to_string()))
    .bind(serde_json::to_string(&flow.edges).unwrap_or_else(|_| "[]".to_string()))
    .bind(serde_json::to_string(&flow.input_variables).unwrap_or_else(|_| "[]".to_string()))
    .bind(flow.ai_tool)
    .bind(&flow.ai_tool_description)
    .execute(&state.db)
    .await;

    (StatusCode::CREATED, Json(json!({ "flow": flow }))).into_response()
}

async fn update_flow(
    Path(flow_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateFlowBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let mut flow = match get_flow_by_id_db(&state.db, &flow_id).await {
        Some(flow) => flow,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "flow not found" })),
            )
                .into_response()
        }
    };
    if let Ok(tenant_id) = auth_tenant_from_headers(&state, &headers).await {
        if flow.tenant_id != tenant_id {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "flow not found" })),
            )
                .into_response();
        }
    }

    if let Some(name) = body.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "name required" })),
            )
                .into_response();
        }
        flow.name = trimmed.to_string();
    }
    if let Some(description) = body.description {
        flow.description = description.trim().to_string();
    }
    if let Some(enabled) = body.enabled {
        flow.enabled = enabled;
    }
    if let Some(nodes) = body.nodes {
        flow.nodes = nodes;
    }
    if let Some(edges) = body.edges {
        flow.edges = edges;
    }
    if let Some(input_variables) = body.input_variables {
        flow.input_variables = input_variables;
    }
    if let Some(ai_tool) = body.ai_tool {
        flow.ai_tool = ai_tool;
    }
    if let Some(ai_tool_description) = body.ai_tool_description {
        flow.ai_tool_description = ai_tool_description.trim().to_string();
    }
    flow.updated_at = now_iso();
    let _ = sqlx::query(
        "UPDATE flows SET name = $1, description = $2, enabled = $3, updated_at = $4, nodes = $5, edges = $6, input_variables = $7, ai_tool = $8, ai_tool_description = $9 WHERE id = $10",
    )
    .bind(&flow.name)
    .bind(&flow.description)
    .bind(flow.enabled)
    .bind(&flow.updated_at)
    .bind(serde_json::to_string(&flow.nodes).unwrap_or_else(|_| "[]".to_string()))
    .bind(serde_json::to_string(&flow.edges).unwrap_or_else(|_| "[]".to_string()))
    .bind(serde_json::to_string(&flow.input_variables).unwrap_or_else(|_| "[]".to_string()))
    .bind(flow.ai_tool)
    .bind(&flow.ai_tool_description)
    .bind(&flow.id)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "flow": flow }))).into_response()
}

async fn delete_flow(
    Path(flow_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let affected = sqlx::query("DELETE FROM flows WHERE id = $1")
        .bind(&flow_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "flow not found" })),
        )
            .into_response();
    }
    let _ = sqlx::query("UPDATE sessions SET flow_id = NULL WHERE flow_id = $1")
        .bind(&flow_id)
        .execute(&state.db)
        .await;

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn add_note(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NoteBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "text required" })),
        )
            .into_response();
    }

    let note = ConversationNote {
        tenant_id,
        id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        agent_id: agent.id,
        text,
        created_at: now_iso(),
    };

    let _ = sqlx::query(
        "INSERT INTO conversation_notes (id, tenant_id, session_id, agent_id, text, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&note.id)
    .bind(&note.tenant_id)
    .bind(&note.session_id)
    .bind(&note.agent_id)
    .bind(&note.text)
    .bind(&note.created_at)
    .execute(&state.db)
    .await;

    (StatusCode::CREATED, Json(json!({ "note": note }))).into_response()
}

async fn get_notes(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows = sqlx::query(
        "SELECT id, tenant_id, session_id, agent_id, text, created_at FROM conversation_notes WHERE session_id = $1 ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let notes = rows
        .into_iter()
        .map(|row| ConversationNote {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            session_id: row.get("session_id"),
            agent_id: row.get("agent_id"),
            text: row.get("text"),
            created_at: row.get("created_at"),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "notes": notes }))).into_response()
}

async fn list_channels(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    (
        StatusCode::OK,
        Json(json!({
            "channels": ["web", "whatsapp", "sms", "instagram", "email"]
        })),
    )
        .into_response()
}

async fn get_tenants(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows =
        sqlx::query("SELECT id, name, slug, created_at, updated_at FROM tenants WHERE id = $1")
            .bind(&tenant_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
    let tenants = rows
        .into_iter()
        .map(|row| Tenant {
            id: row.get("id"),
            name: row.get("name"),
            slug: row.get("slug"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "tenants": tenants }))).into_response()
}

async fn create_tenant(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateTenantBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }

    let now = now_iso();
    let tenant = Tenant {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        slug: slugify(&name),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    if sqlx::query(
        "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&tenant.id)
    .bind(&tenant.name)
    .bind(&tenant.slug)
    .bind(&tenant.created_at)
    .bind(&tenant.updated_at)
    .execute(&state.db)
    .await
    .is_err()
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create tenant" })),
        )
            .into_response();
    }

    let settings = TenantSettings {
        tenant_id: tenant.id.clone(),
        brand_name: name,
        primary_color: "#e4b84f".to_string(),
        accent_color: "#1f2230".to_string(),
        logo_url: "".to_string(),
        privacy_url: "#".to_string(),
        launcher_position: "bottom-right".to_string(),
        welcome_text: "Hello! How can we help?".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let _ = sqlx::query(
        "INSERT INTO tenant_settings (tenant_id, brand_name, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&settings.tenant_id)
    .bind(&settings.brand_name)
    .bind(&settings.primary_color)
    .bind(&settings.accent_color)
    .bind(&settings.logo_url)
    .bind(&settings.privacy_url)
    .bind(&settings.launcher_position)
    .bind(&settings.welcome_text)
    .bind(&settings.created_at)
    .bind(&settings.updated_at)
    .execute(&state.db)
    .await;

    let token = Uuid::new_v4().to_string();
    let _ = sqlx::query("UPDATE agents SET tenant_id = $1 WHERE id = $2")
        .bind(&tenant.id)
        .bind(&agent.id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query(
        "INSERT INTO auth_tokens (token, agent_id, tenant_id, created_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(&token)
    .bind(&agent.id)
    .bind(&tenant.id)
    .bind(now_iso())
    .execute(&state.db)
    .await;

    (
        StatusCode::CREATED,
        Json(json!({ "tenant": tenant, "token": token })),
    )
        .into_response()
}

async fn switch_tenant(
    Path(tenant_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE id = $1")
        .bind(&tenant_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
        > 0;
    if !exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tenant not found" })),
        )
            .into_response();
    }
    let _ = sqlx::query("UPDATE agents SET tenant_id = $1 WHERE id = $2")
        .bind(&tenant_id)
        .bind(&agent.id)
        .execute(&state.db)
        .await;
    let token = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO auth_tokens (token, agent_id, tenant_id, created_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(&token)
    .bind(&agent.id)
    .bind(&tenant_id)
    .bind(now_iso())
    .execute(&state.db)
    .await;
    (
        StatusCode::OK,
        Json(json!({ "tenantId": tenant_id, "token": token })),
    )
        .into_response()
}

async fn get_tenant_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let settings = sqlx::query(
        "SELECT tenant_id, brand_name, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    });
    (StatusCode::OK, Json(json!({ "settings": settings }))).into_response()
}

async fn patch_tenant_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PatchTenantSettingsBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let mut settings = sqlx::query(
        "SELECT tenant_id, brand_name, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    });
    let Some(mut settings) = settings.take() else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tenant settings not found" })),
        )
            .into_response();
    };
    if let Some(v) = body.brand_name {
        settings.brand_name = v;
    }
    if let Some(v) = body.primary_color {
        settings.primary_color = v;
    }
    if let Some(v) = body.accent_color {
        settings.accent_color = v;
    }
    if let Some(v) = body.logo_url {
        settings.logo_url = v;
    }
    if let Some(v) = body.privacy_url {
        settings.privacy_url = v;
    }
    if let Some(v) = body.launcher_position {
        settings.launcher_position = v;
    }
    if let Some(v) = body.welcome_text {
        settings.welcome_text = v;
    }
    settings.updated_at = now_iso();
    let _ = sqlx::query(
        "UPDATE tenant_settings SET brand_name = $1, primary_color = $2, accent_color = $3, logo_url = $4, privacy_url = $5, launcher_position = $6, welcome_text = $7, updated_at = $8 WHERE tenant_id = $9",
    )
    .bind(&settings.brand_name)
    .bind(&settings.primary_color)
    .bind(&settings.accent_color)
    .bind(&settings.logo_url)
    .bind(&settings.privacy_url)
    .bind(&settings.launcher_position)
    .bind(&settings.welcome_text)
    .bind(&settings.updated_at)
    .bind(&tenant_id)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "settings": settings }))).into_response()
}

async fn get_contacts(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, display_name, email, phone, external_id, metadata, company, location, avatar_url, last_seen_at, browser, os, created_at, updated_at FROM contacts WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let contacts = rows
        .into_iter()
        .map(|row| Contact {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            display_name: row.get("display_name"),
            email: row.get("email"),
            phone: row.get("phone"),
            external_id: row.get("external_id"),
            metadata: parse_json_text(&row.get::<String, _>("metadata")),
            company: row.get("company"),
            location: row.get("location"),
            avatar_url: row.get("avatar_url"),
            last_seen_at: row.get("last_seen_at"),
            browser: row.get("browser"),
            os: row.get("os"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "contacts": contacts }))).into_response()
}

async fn create_contact(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateContactBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let now = now_iso();
    let contact = Contact {
        id: Uuid::new_v4().to_string(),
        tenant_id: tenant_id.clone(),
        display_name: body.display_name.unwrap_or_default(),
        email: body.email.unwrap_or_default(),
        phone: body.phone.unwrap_or_default(),
        external_id: body.external_id.unwrap_or_default(),
        metadata: body.metadata.unwrap_or_else(|| json!({})),
        company: body.company.unwrap_or_default(),
        location: body.location.unwrap_or_default(),
        avatar_url: String::new(),
        last_seen_at: String::new(),
        browser: String::new(),
        os: String::new(),
        created_at: now.clone(),
        updated_at: now,
    };
    let _ = sqlx::query(
        "INSERT INTO contacts (id, tenant_id, display_name, email, phone, external_id, metadata, company, location, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(&contact.id)
    .bind(&contact.tenant_id)
    .bind(&contact.display_name)
    .bind(&contact.email)
    .bind(&contact.phone)
    .bind(&contact.external_id)
    .bind(json_text(&contact.metadata))
    .bind(&contact.company)
    .bind(&contact.location)
    .bind(&contact.created_at)
    .bind(&contact.updated_at)
    .execute(&state.db)
    .await;
    (StatusCode::CREATED, Json(json!({ "contact": contact }))).into_response()
}

async fn patch_contact(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PatchContactBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let row = sqlx::query(
        "SELECT id, tenant_id, display_name, email, phone, external_id, metadata, company, location, avatar_url, last_seen_at, browser, os, created_at, updated_at FROM contacts WHERE id = $1 AND tenant_id = $2",
    )
    .bind(&contact_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "contact not found" })),
        )
            .into_response();
    };
    let mut contact = Contact {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        display_name: row.get("display_name"),
        email: row.get("email"),
        phone: row.get("phone"),
        external_id: row.get("external_id"),
        metadata: parse_json_text(&row.get::<String, _>("metadata")),
        company: row.get("company"),
        location: row.get("location"),
        avatar_url: row.get("avatar_url"),
        last_seen_at: row.get("last_seen_at"),
        browser: row.get("browser"),
        os: row.get("os"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    };
    if let Some(v) = body.display_name {
        contact.display_name = v;
    }
    if let Some(v) = body.email {
        contact.email = v;
    }
    if let Some(v) = body.phone {
        contact.phone = v;
    }
    if let Some(v) = body.external_id {
        contact.external_id = v;
    }
    if let Some(v) = body.metadata {
        contact.metadata = v;
    }
    if let Some(v) = body.company {
        contact.company = v;
    }
    if let Some(v) = body.location {
        contact.location = v;
    }
    if let Some(v) = body.avatar_url {
        contact.avatar_url = v;
    }
    contact.updated_at = now_iso();
    let _ = sqlx::query(
        "UPDATE contacts SET display_name = $1, email = $2, phone = $3, external_id = $4, metadata = $5, company = $6, location = $7, avatar_url = $8, updated_at = $9 WHERE id = $10 AND tenant_id = $11",
    )
    .bind(&contact.display_name)
    .bind(&contact.email)
    .bind(&contact.phone)
    .bind(&contact.external_id)
    .bind(json_text(&contact.metadata))
    .bind(&contact.company)
    .bind(&contact.location)
    .bind(&contact.avatar_url)
    .bind(&contact.updated_at)
    .bind(&contact.id)
    .bind(&tenant_id)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "contact": contact }))).into_response()
}

// ── Delete contact ───────────────────────────────────────────────────
async fn delete_contact(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let _ = sqlx::query("DELETE FROM contacts WHERE id = $1 AND tenant_id = $2")
        .bind(&contact_id)
        .bind(&tenant_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Get single contact ──────────────────────────────────────────────
async fn get_contact(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let row = sqlx::query(
        "SELECT id, tenant_id, display_name, email, phone, external_id, metadata, company, location, avatar_url, last_seen_at, browser, os, created_at, updated_at FROM contacts WHERE id = $1 AND tenant_id = $2",
    )
    .bind(&contact_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))).into_response();
    };
    let contact = Contact {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        display_name: row.get("display_name"),
        email: row.get("email"),
        phone: row.get("phone"),
        external_id: row.get("external_id"),
        metadata: parse_json_text(&row.get::<String, _>("metadata")),
        company: row.get("company"),
        location: row.get("location"),
        avatar_url: row.get("avatar_url"),
        last_seen_at: row.get("last_seen_at"),
        browser: row.get("browser"),
        os: row.get("os"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    };
    (StatusCode::OK, Json(json!({ "contact": contact }))).into_response()
}

// ── Contact conversations ───────────────────────────────────────────
async fn get_contact_conversations(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows =
        sqlx::query("SELECT id FROM sessions WHERE contact_id = $1 ORDER BY updated_at DESC")
            .bind(&contact_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
    let mut summaries = Vec::new();
    for row in rows {
        let sid: String = row.get("id");
        if let Some(s) = get_session_summary_db(&state.db, &sid).await {
            summaries.push(s);
        }
    }
    (StatusCode::OK, Json(json!({ "conversations": summaries }))).into_response()
}

// ── Contact attributes ──────────────────────────────────────────────
async fn get_contact_attributes(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows = sqlx::query(
        "SELECT id, contact_id, attribute_key, attribute_value, created_at, updated_at FROM contact_custom_attributes WHERE contact_id = $1 ORDER BY attribute_key ASC",
    )
    .bind(&contact_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let attrs: Vec<ContactAttribute> = rows
        .into_iter()
        .map(|r| ContactAttribute {
            id: r.get("id"),
            contact_id: r.get("contact_id"),
            attribute_key: r.get("attribute_key"),
            attribute_value: r.get("attribute_value"),
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "attributes": attrs }))).into_response()
}

async fn set_contact_attribute(
    Path(contact_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetAttributeBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let now = now_iso();
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        r#"INSERT INTO contact_custom_attributes (id, contact_id, attribute_key, attribute_value, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (contact_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value, updated_at = EXCLUDED.updated_at"#,
    )
    .bind(&id)
    .bind(&contact_id)
    .bind(&body.attribute_key)
    .bind(&body.attribute_value)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn delete_contact_attribute(
    Path((contact_id, attr_key)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query(
        "DELETE FROM contact_custom_attributes WHERE contact_id = $1 AND attribute_key = $2",
    )
    .bind(&contact_id)
    .bind(&attr_key)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Tags CRUD ───────────────────────────────────────────────────────
async fn get_tags(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query("SELECT id, tenant_id, name, color, created_at FROM tags WHERE tenant_id = $1 ORDER BY name ASC")
        .bind(&tenant_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let tags: Vec<Tag> = rows
        .into_iter()
        .map(|r| Tag {
            id: r.get("id"),
            tenant_id: r.get("tenant_id"),
            name: r.get("name"),
            color: r.get("color"),
            created_at: r.get("created_at"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "tags": tags }))).into_response()
}

async fn create_tag(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateTagBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let tag = Tag {
        id: Uuid::new_v4().to_string(),
        tenant_id,
        name: body.name.trim().to_string(),
        color: body.color,
        created_at: now_iso(),
    };
    let _ = sqlx::query("INSERT INTO tags (id, tenant_id, name, color, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, name) DO NOTHING")
        .bind(&tag.id)
        .bind(&tag.tenant_id)
        .bind(&tag.name)
        .bind(&tag.color)
        .bind(&tag.created_at)
        .execute(&state.db)
        .await;
    (StatusCode::CREATED, Json(json!({ "tag": tag }))).into_response()
}

async fn delete_tag(
    Path(tag_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(&tag_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Custom Attribute Definitions CRUD ───────────────────────────────
async fn get_attribute_definitions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, display_name, key, description, attribute_model, created_at, updated_at FROM custom_attribute_definitions WHERE tenant_id = $1 ORDER BY display_name ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let defs: Vec<CustomAttributeDefinition> = rows
        .into_iter()
        .map(|r| CustomAttributeDefinition {
            id: r.get("id"),
            tenant_id: r.get("tenant_id"),
            display_name: r.get("display_name"),
            key: r.get("key"),
            description: r.get("description"),
            attribute_model: r.get("attribute_model"),
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        })
        .collect();
    (
        StatusCode::OK,
        Json(json!({ "attributeDefinitions": defs })),
    )
        .into_response()
}

async fn create_attribute_definition(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateAttributeDefBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let now = now_iso();
    let def = CustomAttributeDefinition {
        id: Uuid::new_v4().to_string(),
        tenant_id,
        display_name: body.display_name.trim().to_string(),
        key: body.key.trim().to_string(),
        description: body.description.trim().to_string(),
        attribute_model: body.attribute_model,
        created_at: now.clone(),
        updated_at: now,
    };
    let _ = sqlx::query(
        "INSERT INTO custom_attribute_definitions (id, tenant_id, display_name, key, description, attribute_model, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, key) DO NOTHING",
    )
    .bind(&def.id)
    .bind(&def.tenant_id)
    .bind(&def.display_name)
    .bind(&def.key)
    .bind(&def.description)
    .bind(&def.attribute_model)
    .bind(&def.created_at)
    .bind(&def.updated_at)
    .execute(&state.db)
    .await;
    (
        StatusCode::CREATED,
        Json(json!({ "attributeDefinition": def })),
    )
        .into_response()
}

async fn update_attribute_definition(
    Path(def_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateAttributeDefBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let now = now_iso();
    if let Some(display_name) = &body.display_name {
        let _ = sqlx::query(
            "UPDATE custom_attribute_definitions SET display_name = $1, updated_at = $2 WHERE id = $3",
        )
        .bind(display_name.trim())
        .bind(&now)
        .bind(&def_id)
        .execute(&state.db)
        .await;
    }
    if let Some(desc) = &body.description {
        let _ = sqlx::query(
            "UPDATE custom_attribute_definitions SET description = $1, updated_at = $2 WHERE id = $3",
        )
        .bind(desc.trim())
        .bind(&now)
        .bind(&def_id)
        .execute(&state.db)
        .await;
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn delete_attribute_definition(
    Path(def_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("DELETE FROM custom_attribute_definitions WHERE id = $1")
        .bind(&def_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Session tags ────────────────────────────────────────────────────
async fn get_session_tags(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows = sqlx::query(
        "SELECT t.id, t.tenant_id, t.name, t.color, t.created_at FROM tags t INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.session_id = $1 ORDER BY t.name ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let tags: Vec<Tag> = rows
        .into_iter()
        .map(|r| Tag {
            id: r.get("id"),
            tenant_id: r.get("tenant_id"),
            name: r.get("name"),
            color: r.get("color"),
            created_at: r.get("created_at"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "tags": tags }))).into_response()
}

async fn add_session_tag(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionTagBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("INSERT INTO conversation_tags (session_id, tag_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
        .bind(&session_id)
        .bind(&body.tag_id)
        .bind(now_iso())
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn remove_session_tag(
    Path((session_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("DELETE FROM conversation_tags WHERE session_id = $1 AND tag_id = $2")
        .bind(&session_id)
        .bind(&tag_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Session ↔ Contact linking ───────────────────────────────────────
async fn patch_session_contact(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionContactBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("UPDATE sessions SET contact_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&body.contact_id)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await;
    let summary = get_session_summary_db(&state.db, &session_id).await;
    if let Some(s) = &summary {
        emit_session_update(&state, s.clone()).await;
    }
    (StatusCode::OK, Json(json!({ "session": summary }))).into_response()
}

// ── Conversation custom attributes ──────────────────────────────────
async fn get_conversation_attributes(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let rows = sqlx::query(
        "SELECT id, session_id, attribute_key, attribute_value, created_at, updated_at FROM conversation_custom_attributes WHERE session_id = $1 ORDER BY attribute_key ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let attrs: Vec<ConversationAttribute> = rows
        .into_iter()
        .map(|r| ConversationAttribute {
            id: r.get("id"),
            session_id: r.get("session_id"),
            attribute_key: r.get("attribute_key"),
            attribute_value: r.get("attribute_value"),
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "attributes": attrs }))).into_response()
}

async fn set_conversation_attribute(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetAttributeBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let now = now_iso();
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        r#"INSERT INTO conversation_custom_attributes (id, session_id, attribute_key, attribute_value, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (session_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value, updated_at = EXCLUDED.updated_at"#,
    )
    .bind(&id)
    .bind(&session_id)
    .bind(&body.attribute_key)
    .bind(&body.attribute_value)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn delete_conversation_attribute(
    Path((session_id, attr_key)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query(
        "DELETE FROM conversation_custom_attributes WHERE session_id = $1 AND attribute_key = $2",
    )
    .bind(&session_id)
    .bind(&attr_key)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn submit_csat(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateCsatBody>,
) -> impl IntoResponse {
    if body.score < 1 || body.score > 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "score must be between 1 and 5" })),
        )
            .into_response();
    }
    let tenant_id = sqlx::query_scalar::<_, String>("SELECT tenant_id FROM sessions WHERE id = $1")
        .bind(&session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| state.default_tenant_id.clone());
    let survey = CsatSurvey {
        id: Uuid::new_v4().to_string(),
        tenant_id: tenant_id.clone(),
        session_id,
        score: body.score,
        comment: body.comment.unwrap_or_default(),
        submitted_at: now_iso(),
    };
    let _ = sqlx::query(
        "INSERT INTO csat_surveys (id, tenant_id, session_id, score, comment, submitted_at) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&survey.id)
    .bind(&survey.tenant_id)
    .bind(&survey.session_id)
    .bind(survey.score)
    .bind(&survey.comment)
    .bind(&survey.submitted_at)
    .execute(&state.db)
    .await;
    (StatusCode::CREATED, Json(json!({ "csat": survey }))).into_response()
}

async fn get_csat_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, session_id, score, comment, submitted_at FROM csat_surveys WHERE tenant_id = $1 ORDER BY submitted_at DESC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let surveys = rows
        .into_iter()
        .map(|row| CsatSurvey {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            session_id: row.get("session_id"),
            score: row.get("score"),
            comment: row.get("comment"),
            submitted_at: row.get("submitted_at"),
        })
        .collect::<Vec<_>>();
    let count = surveys.len();
    let avg = if count == 0 {
        0.0
    } else {
        surveys.iter().map(|s| s.score as f64).sum::<f64>() / count as f64
    };
    (
        StatusCode::OK,
        Json(json!({ "count": count, "average": avg, "surveys": surveys })),
    )
        .into_response()
}

async fn widget_bootstrap(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = sqlx::query(
        "SELECT tenant_id, brand_name, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&state.default_tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    });
    (StatusCode::OK, Json(json!({ "settings": settings }))).into_response()
}

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "now": now_iso() }))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let client_id = state.next_client_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    {
        let mut rt = state.realtime.lock().await;
        rt.clients.insert(client_id, tx);
    }

    let (mut ws_sender, mut ws_receiver) = socket.split();

    let send_task = tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            if ws_sender.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = ws_receiver.next().await {
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };

        let Ok(envelope) = serde_json::from_str::<EventEnvelopeIn>(&text) else {
            continue;
        };

        match envelope.event.as_str() {
            "widget:join" => {
                if let Some(session_id) = envelope.data.get("sessionId").and_then(Value::as_str) {
                    let session = ensure_session(state.clone(), session_id).await;

                    // Resolve contact from persistent visitor identity
                    let visitor_id = envelope
                        .data
                        .get("visitorId")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if !visitor_id.is_empty() {
                        resolve_contact_from_visitor_id(&state, session_id, visitor_id).await;
                    }

                    let visible_history = visible_messages_for_widget(&session.messages);

                    {
                        let mut rt = state.realtime.lock().await;
                        rt.session_watchers
                            .entry(session_id.to_string())
                            .or_default()
                            .insert(client_id);
                    }

                    emit_to_client(&state, client_id, "session:history", visible_history).await;
                    if is_agent_typing(&state, session_id).await {
                        emit_to_client(
                            &state,
                            client_id,
                            "typing",
                            json!({
                                "sessionId": session_id,
                                "sender": "agent",
                                "active": true
                            }),
                        )
                        .await;
                    }
                }
            }
            "agent:join" => {
                let token = envelope
                    .data
                    .get("token")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();

                let is_valid = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(1) FROM auth_tokens WHERE token = $1",
                )
                .bind(&token)
                .fetch_one(&state.db)
                .await
                .unwrap_or(0)
                    > 0;

                if is_valid {
                    let mut rt = state.realtime.lock().await;
                    rt.agents.insert(client_id);
                    drop(rt);
                    emit_session_snapshot(state.clone()).await;
                } else {
                    emit_to_client(
                        &state,
                        client_id,
                        "auth:error",
                        json!({ "message": "invalid agent token" }),
                    )
                    .await;
                }
            }
            "widget:message" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let text = envelope.data.get("text").and_then(Value::as_str);
                if let (Some(session_id), Some(text)) = (session_id, text) {
                    let (target_session_id, switched) =
                        resolve_visitor_target_session(state.clone(), session_id).await;
                    if switched {
                        emit_to_client(
                            &state,
                            client_id,
                            "session:switched",
                            json!({
                                "fromSessionId": session_id,
                                "sessionId": target_session_id,
                            }),
                        )
                        .await;
                    }

                    let _ = ensure_session(state.clone(), &target_session_id).await;
                    let _ = add_message(
                        state.clone(),
                        &target_session_id,
                        "visitor",
                        text,
                        None,
                        None,
                    )
                    .await;

                    let state_clone = state.clone();
                    let session_clone = target_session_id;
                    let text_clone = text.to_string();
                    tokio::spawn(async move {
                        run_flow_for_visitor_message(
                            state_clone,
                            session_clone,
                            text_clone,
                            "visitor_message",
                        )
                        .await;
                    });
                }
            }
            "widget:opened" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                if let Some(session_id) = session_id {
                    let _ = ensure_session(state.clone(), session_id).await;
                    let state_clone = state.clone();
                    let session_clone = session_id.to_string();
                    tokio::spawn(async move {
                        run_flow_for_visitor_message(
                            state_clone,
                            session_clone,
                            String::new(),
                            "widget_open",
                        )
                        .await;
                    });
                }
            }
            "visitor:typing" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let text = envelope
                    .data
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let active = envelope
                    .data
                    .get("active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                if let Some(session_id) = session_id {
                    let mut previous_session = None::<String>;
                    {
                        let mut rt = state.realtime.lock().await;
                        if let Some(previous) = rt.visitor_typing_session.get(&client_id).cloned() {
                            if previous != session_id {
                                previous_session = Some(previous.clone());
                                rt.visitor_typing_session.remove(&client_id);
                            }
                        }

                        if active {
                            rt.visitor_typing_session
                                .insert(client_id, session_id.to_string());
                        } else {
                            rt.visitor_typing_session.remove(&client_id);
                        }
                    }

                    if let Some(previous) = previous_session {
                        emit_visitor_typing(&state, &previous, "", false).await;
                    }

                    emit_visitor_typing(&state, session_id, text, active).await;
                }
            }
            "agent:watch-session" => {
                if let Some(session_id) = envelope.data.get("sessionId").and_then(Value::as_str) {
                    let mut rt = state.realtime.lock().await;
                    if let Some(previous) =
                        rt.watched_session.insert(client_id, session_id.to_string())
                    {
                        if let Some(set) = rt.session_watchers.get_mut(&previous) {
                            set.remove(&client_id);
                        }
                    }
                    rt.session_watchers
                        .entry(session_id.to_string())
                        .or_default()
                        .insert(client_id);
                }
            }
            "agent:request-history" => {
                if let Some(session_id) = envelope.data.get("sessionId").and_then(Value::as_str) {
                    let session = ensure_session(state.clone(), session_id).await;

                    {
                        let mut rt = state.realtime.lock().await;
                        if let Some(previous) =
                            rt.watched_session.insert(client_id, session_id.to_string())
                        {
                            if let Some(set) = rt.session_watchers.get_mut(&previous) {
                                set.remove(&client_id);
                            }
                        }
                        rt.session_watchers
                            .entry(session_id.to_string())
                            .or_default()
                            .insert(client_id);
                    }

                    emit_to_client(&state, client_id, "session:history", session.messages).await;
                    if is_agent_typing(&state, session_id).await {
                        emit_to_client(
                            &state,
                            client_id,
                            "typing",
                            json!({
                                "sessionId": session_id,
                                "sender": "agent",
                                "active": true
                            }),
                        )
                        .await;
                    }
                }
            }
            "agent:typing" => {
                let session_id = envelope
                    .data
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let active = envelope
                    .data
                    .get("active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                set_agent_human_typing(state.clone(), client_id, session_id, active).await;
            }
            "agent:message" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let text = envelope.data.get("text").and_then(Value::as_str);
                let internal = envelope
                    .data
                    .get("internal")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if let (Some(session_id), Some(text)) = (session_id, text) {
                    set_agent_human_typing(state.clone(), client_id, session_id, false).await;
                    let _ = ensure_session(state.clone(), session_id).await;
                    let sender = if internal { "team" } else { "agent" };
                    let _ = add_message(state.clone(), session_id, sender, text, None, None).await;
                }
            }
            _ => {}
        }
    }

    {
        let mut rt = state.realtime.lock().await;
        let mut emit_off = None::<String>;
        let visitor_typing_session = rt.visitor_typing_session.remove(&client_id);
        if let Some(session_id) = rt.agent_human_typing_session.remove(&client_id) {
            let was_active = session_agent_typing_active(&rt, &session_id);
            if let Some(set) = rt.agent_human_typers.get_mut(&session_id) {
                set.remove(&client_id);
            }
            let now_active = session_agent_typing_active(&rt, &session_id);
            if was_active && !now_active {
                emit_off = Some(session_id);
            }
        }
        rt.clients.remove(&client_id);
        rt.agents.remove(&client_id);
        if let Some(previous) = rt.watched_session.remove(&client_id) {
            if let Some(set) = rt.session_watchers.get_mut(&previous) {
                set.remove(&client_id);
            }
        }
        for watchers in rt.session_watchers.values_mut() {
            watchers.remove(&client_id);
        }
        if let Some(session_id) = emit_off {
            drop(rt);
            emit_typing_state(&state, &session_id, false).await;
            if let Some(visitor_session_id) = visitor_typing_session {
                emit_visitor_typing(&state, &visitor_session_id, "", false).await;
            }
        } else if let Some(visitor_session_id) = visitor_typing_session {
            drop(rt);
            emit_visitor_typing(&state, &visitor_session_id, "", false).await;
        }
    }

    send_task.abort();
}

pub async fn run() {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(4000);
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/chat_exp".to_string());
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("failed to connect to postgres (set DATABASE_URL)");

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("failed to run sqlx migrations");

    let default_tenant_id = "default-workspace".to_string();
    let default_tenant_now = now_iso();
    let _ = sqlx::query(
        "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
    )
    .bind(&default_tenant_id)
    .bind("Default Workspace")
    .bind("default-workspace")
    .bind(&default_tenant_now)
    .bind(&default_tenant_now)
    .execute(&db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO tenant_settings (tenant_id, brand_name, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(&default_tenant_id)
    .bind("Support")
    .bind("#e4b84f")
    .bind("#1f2230")
    .bind("")
    .bind("#")
    .bind("bottom-right")
    .bind("Hello! How can we help?")
    .bind(now_iso())
    .bind(now_iso())
    .execute(&db)
    .await;

    let default_flow_id = "default-flow".to_string();
    let now = now_iso();
    let default_flow = ChatFlow {
        tenant_id: default_tenant_id.clone(),
        id: default_flow_id.clone(),
        name: "Welcome Demo Flow".to_string(),
        description: "Default onboarding flow with delayed demo messages.".to_string(),
        enabled: true,
        created_at: now.clone(),
        updated_at: now,
        nodes: vec![
            FlowNode {
                id: "trigger-welcome".to_string(),
                node_type: "trigger".to_string(),
                position: FlowPosition { x: 120.0, y: 200.0 },
                data: json!({ "label": "Trigger", "on": "widget_open", "keywords": [] }),
            },
            FlowNode {
                id: "msg-hello".to_string(),
                node_type: "message".to_string(),
                position: FlowPosition { x: 420.0, y: 100.0 },
                data: json!({ "label": "Hello", "text": "Hello!", "delayMs": 500 }),
            },
            FlowNode {
                id: "msg-demo".to_string(),
                node_type: "message".to_string(),
                position: FlowPosition { x: 420.0, y: 210.0 },
                data: json!({ "label": "Demo", "text": "This is a demo.", "delayMs": 900 }),
            },
            FlowNode {
                id: "msg-nice".to_string(),
                node_type: "message".to_string(),
                position: FlowPosition { x: 420.0, y: 320.0 },
                data: json!({ "label": "Nice Day", "text": "Have a wonderful day 😊", "delayMs": 1200 }),
            },
            FlowNode {
                id: "end-flow".to_string(),
                node_type: "end".to_string(),
                position: FlowPosition { x: 760.0, y: 210.0 },
                data: json!({ "label": "End" }),
            },
        ],
        edges: vec![
            FlowEdge {
                id: "e-trigger-hello".to_string(),
                source: "trigger-welcome".to_string(),
                target: "msg-hello".to_string(),
                source_handle: None,
                target_handle: None,
                data: json!({}),
            },
            FlowEdge {
                id: "e-hello-demo".to_string(),
                source: "msg-hello".to_string(),
                target: "msg-demo".to_string(),
                source_handle: None,
                target_handle: None,
                data: json!({}),
            },
            FlowEdge {
                id: "e-demo-nice".to_string(),
                source: "msg-demo".to_string(),
                target: "msg-nice".to_string(),
                source_handle: None,
                target_handle: None,
                data: json!({}),
            },
            FlowEdge {
                id: "e-nice-end".to_string(),
                source: "msg-nice".to_string(),
                target: "end-flow".to_string(),
                source_handle: None,
                target_handle: None,
                data: json!({}),
            },
        ],
        input_variables: vec![],
        ai_tool: false,
        ai_tool_description: String::new(),
    };

    let _ = sqlx::query(
        "INSERT INTO flows (id, tenant_id, name, description, enabled, created_at, updated_at, nodes, edges, input_variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",    )
    .bind(&default_flow.id)
    .bind(&default_flow.tenant_id)
    .bind(&default_flow.name)
    .bind(&default_flow.description)
    .bind(default_flow.enabled)
    .bind(&default_flow.created_at)
    .bind(&default_flow.updated_at)
    .bind(serde_json::to_string(&default_flow.nodes).unwrap_or_else(|_| "[]".to_string()))
    .bind(serde_json::to_string(&default_flow.edges).unwrap_or_else(|_| "[]".to_string()))
    .bind("[]")
    .execute(&db)
    .await;
    let seed_now = now_iso();
    let _ = sqlx::query(
        "INSERT INTO teams (id, tenant_id, name, agent_ids) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
    )
    .bind("default-team")
    .bind(&default_tenant_id)
    .bind("Support")
    .bind("[]")
    .execute(&db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO inboxes (id, tenant_id, name, channels, agent_ids) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
    )
    .bind("default-inbox")
    .bind(&default_tenant_id)
    .bind("General")
    .bind("[\"web\",\"whatsapp\"]")
    .bind("[]")
    .execute(&db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO canned_replies (id, tenant_id, title, shortcut, category, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
    )
    .bind("seed-greet")
    .bind(&default_tenant_id)
    .bind("Greeting")
    .bind("/greet")
    .bind("General")
    .bind("Hi {{visitor_id}}, thanks for reaching out. I am {{agent_name}} and I can help you with this.")
    .bind(&seed_now)
    .bind(&seed_now)
    .execute(&db)
    .await;

    let state = Arc::new(AppState {
        db,
        default_flow_id,
        default_tenant_id,
        realtime: Mutex::new(RealtimeState::default()),
        next_client_id: AtomicUsize::new(0),
        ai_client: reqwest::Client::new(),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/widget/bootstrap", get(widget_bootstrap))
        .route("/api/auth/register", post(register_agent))
        .route("/api/auth/login", post(login_agent))
        .route("/api/auth/me", get(get_me))
        .route("/api/tenants", get(get_tenants).post(create_tenant))
        .route("/api/tenants/{tenant_id}/switch", post(switch_tenant))
        .route(
            "/api/tenant/settings",
            get(get_tenant_settings).patch(patch_tenant_settings),
        )
        .route("/api/agent/status", patch(patch_agent_status))
        .route("/api/contacts", get(get_contacts).post(create_contact))
        .route(
            "/api/contacts/{contact_id}",
            get(get_contact).patch(patch_contact).delete(delete_contact),
        )
        .route(
            "/api/contacts/{contact_id}/conversations",
            get(get_contact_conversations),
        )
        .route(
            "/api/contacts/{contact_id}/attributes",
            get(get_contact_attributes).post(set_contact_attribute),
        )
        .route(
            "/api/contacts/{contact_id}/attributes/{attr_key}",
            axum::routing::delete(delete_contact_attribute),
        )
        .route("/api/tags", get(get_tags).post(create_tag))
        .route("/api/tags/{tag_id}", axum::routing::delete(delete_tag))
        .route(
            "/api/attribute-definitions",
            get(get_attribute_definitions).post(create_attribute_definition),
        )
        .route(
            "/api/attribute-definitions/{def_id}",
            patch(update_attribute_definition).delete(delete_attribute_definition),
        )
        .route("/api/teams", get(get_teams).post(create_team))
        .route("/api/teams/{team_id}/members", post(add_member_to_team))
        .route("/api/inboxes", get(get_inboxes).post(create_inbox))
        .route(
            "/api/inboxes/{inbox_id}/assign",
            post(assign_agent_to_inbox),
        )
        .route("/api/channels", get(list_channels))
        .route("/api/agents", get(get_agents))
        .route(
            "/api/canned-replies",
            get(get_canned_replies).post(create_canned_reply),
        )
        .route(
            "/api/canned-replies/{canned_id}",
            patch(update_canned_reply).delete(delete_canned_reply),
        )
        .route("/api/session", post(post_session))
        .route("/api/sessions", get(get_sessions))
        .route("/api/session/{session_id}/messages", get(get_messages))
        .route("/api/session/{session_id}/message", post(post_message))
        .route("/api/session/{session_id}/csat", post(submit_csat))
        .route(
            "/api/session/{session_id}/close",
            post(close_session_by_visitor),
        )
        .route(
            "/api/session/{session_id}/assignee",
            patch(patch_session_assignee),
        )
        .route(
            "/api/session/{session_id}/channel",
            patch(patch_session_channel),
        )
        .route(
            "/api/session/{session_id}/inbox",
            patch(patch_session_inbox),
        )
        .route("/api/session/{session_id}/team", patch(patch_session_team))
        .route("/api/session/{session_id}/flow", patch(patch_session_flow))
        .route(
            "/api/session/{session_id}/handover",
            patch(patch_session_handover),
        )
        .route("/api/session/{session_id}/meta", patch(patch_session_meta))
        .route(
            "/api/session/{session_id}/contact",
            patch(patch_session_contact),
        )
        .route(
            "/api/session/{session_id}/tags",
            get(get_session_tags).post(add_session_tag),
        )
        .route(
            "/api/session/{session_id}/tags/{tag_id}",
            axum::routing::delete(remove_session_tag),
        )
        .route(
            "/api/session/{session_id}/attributes",
            get(get_conversation_attributes).post(set_conversation_attribute),
        )
        .route(
            "/api/session/{session_id}/attributes/{attr_key}",
            axum::routing::delete(delete_conversation_attribute),
        )
        .route(
            "/api/session/{session_id}/notes",
            get(get_notes).post(add_note),
        )
        .route("/api/reports/csat", get(get_csat_report))
        .route("/api/flows", get(get_flows).post(create_flow))
        .route(
            "/api/flows/{flow_id}",
            get(get_flow).patch(update_flow).delete(delete_flow),
        )
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind TCP listener");

    println!("chat rust server running at http://localhost:{port}");
    axum::serve(listener, app)
        .await
        .expect("server runtime failure");
}
