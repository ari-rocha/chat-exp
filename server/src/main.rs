use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex, RwLock};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    session_id: String,
    sender: String,
    text: String,
    created_at: String,
}

#[derive(Debug, Clone)]
struct Session {
    id: String,
    created_at: String,
    updated_at: String,
    messages: Vec<ChatMessage>,
    channel: String,
    assignee_agent_id: Option<String>,
    inbox_id: Option<String>,
    team_id: Option<String>,
    flow_id: Option<String>,
    handover_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    created_at: String,
    updated_at: String,
    last_message: Option<ChatMessage>,
    message_count: usize,
    channel: String,
    assignee_agent_id: Option<String>,
    inbox_id: Option<String>,
    team_id: Option<String>,
    flow_id: Option<String>,
    handover_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProfile {
    id: String,
    name: String,
    email: String,
    status: String,
    team_ids: Vec<String>,
    inbox_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct AgentRecord {
    profile: AgentProfile,
    password_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Team {
    id: String,
    name: String,
    agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Inbox {
    id: String,
    name: String,
    channels: Vec<String>,
    agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationNote {
    id: String,
    session_id: String,
    agent_id: String,
    text: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFlow {
    id: String,
    name: String,
    description: String,
    enabled: bool,
    created_at: String,
    updated_at: String,
    nodes: Vec<FlowNode>,
    edges: Vec<FlowEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    position: FlowPosition,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowPosition {
    x: f64,
    y: f64,
}

impl Default for FlowPosition {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowEdge {
    id: String,
    source: String,
    target: String,
    #[serde(default)]
    source_handle: Option<String>,
    #[serde(default)]
    target_handle: Option<String>,
    #[serde(default)]
    data: Value,
}

#[derive(Default)]
struct RealtimeState {
    clients: HashMap<usize, mpsc::UnboundedSender<String>>,
    agents: HashSet<usize>,
    session_watchers: HashMap<String, HashSet<usize>>,
    watched_session: HashMap<usize, String>,
    agent_auto_typing_counts: HashMap<String, usize>,
    agent_human_typers: HashMap<String, HashSet<usize>>,
    agent_human_typing_session: HashMap<usize, String>,
    visitor_typing_session: HashMap<usize, String>,
}

struct AppState {
    sessions: RwLock<HashMap<String, Session>>,
    notes_by_session: RwLock<HashMap<String, Vec<ConversationNote>>>,
    agents: RwLock<HashMap<String, AgentRecord>>,
    tokens: RwLock<HashMap<String, String>>,
    teams: RwLock<HashMap<String, Team>>,
    inboxes: RwLock<HashMap<String, Inbox>>,
    flows: RwLock<HashMap<String, ChatFlow>>,
    default_flow_id: String,
    realtime: Mutex<RealtimeState>,
    next_client_id: AtomicUsize,
    ai_client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageBody {
    sender: Option<String>,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody {
    name: String,
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusBody {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTeamBody {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInboxBody {
    name: String,
    channels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignBody {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionAssigneeBody {
    agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionChannelBody {
    channel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInboxBody {
    inbox_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTeamBody {
    team_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteBody {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFlowBody {
    flow_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionHandoverBody {
    active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFlowBody {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    nodes: Vec<FlowNode>,
    #[serde(default)]
    edges: Vec<FlowEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFlowBody {
    name: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
    nodes: Option<Vec<FlowNode>>,
    edges: Option<Vec<FlowEdge>>,
}

#[derive(Debug, Deserialize)]
struct EventEnvelopeIn {
    event: String,
    #[serde(default)]
    data: Value,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn session_summary(session: &Session) -> SessionSummary {
    SessionSummary {
        id: session.id.clone(),
        created_at: session.created_at.clone(),
        updated_at: session.updated_at.clone(),
        last_message: session.messages.last().cloned(),
        message_count: session.messages.len(),
        channel: session.channel.clone(),
        assignee_agent_id: session.assignee_agent_id.clone(),
        inbox_id: session.inbox_id.clone(),
        team_id: session.team_id.clone(),
        flow_id: session.flow_id.clone(),
        handover_active: session.handover_active,
    }
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

    let agent_id = {
        let tokens = state.tokens.read().await;
        tokens.get(&token).cloned()
    }
    .ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "invalid token" })),
    ))?;

    let profile = {
        let agents = state.agents.read().await;
        agents.get(&agent_id).map(|a| a.profile.clone())
    }
    .ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "agent not found" })),
    ))?;

    Ok(profile)
}

async fn emit_to_client<T: Serialize>(state: &Arc<AppState>, client_id: usize, event: &str, data: T) {
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
        let sessions = state.sessions.read().await;
        sessions.values().map(session_summary).collect::<Vec<_>>()
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

async fn ensure_session(state: Arc<AppState>, session_id: &str) -> Session {
    let mut created = false;

    let session = {
        let mut sessions = state.sessions.write().await;
        if let Some(existing) = sessions.get(session_id) {
            existing.clone()
        } else {
            created = true;
            let now = now_iso();
            let session = Session {
                id: session_id.to_string(),
                created_at: now.clone(),
                updated_at: now,
                messages: vec![],
                channel: "web".to_string(),
                assignee_agent_id: None,
                inbox_id: None,
                team_id: None,
                flow_id: Some(state.default_flow_id.clone()),
                handover_active: false,
            };
            sessions.insert(session_id.to_string(), session.clone());
            session
        }
    };

    if created {
        emit_session_snapshot(state.clone()).await;
        let state_clone = state.clone();
        let session_clone = session_id.to_string();
        tokio::spawn(async move {
            run_flow_for_visitor_message(
                state_clone,
                session_clone,
                "__session_start__".to_string(),
            )
            .await;
        });
    }

    session
}

async fn add_message(
    state: Arc<AppState>,
    session_id: &str,
    sender: &str,
    text: &str,
) -> Option<ChatMessage> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (message, summary) = {
        let mut sessions = state.sessions.write().await;
        let session = sessions.get_mut(session_id)?;

        let message = ChatMessage {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            sender: sender.to_string(),
            text: trimmed.to_string(),
            created_at: now_iso(),
        };

        session.messages.push(message.clone());
        session.updated_at = message.created_at.clone();

        (message, session_summary(session))
    };

    let watchers = {
        let rt = state.realtime.lock().await;
        rt.session_watchers
            .get(session_id)
            .map(|ids| ids.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default()
    };

    emit_to_clients(&state, &watchers, "message:new", message.clone()).await;

    let agents = {
        let rt = state.realtime.lock().await;
        rt.agents.iter().copied().collect::<Vec<_>>()
    };

    emit_to_clients(&state, &agents, "session:updated", summary).await;

    Some(message)
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

fn flow_edge_condition(edge: &FlowEdge) -> String {
    edge.data
        .get("condition")
        .and_then(Value::as_str)
        .or(edge.source_handle.as_deref())
        .unwrap_or("default")
        .to_ascii_lowercase()
}

fn flow_trigger_matches(flow: &ChatFlow, visitor_text: &str) -> bool {
    let Some(trigger) = flow
        .nodes
        .iter()
        .find(|node| node.node_type == "trigger" || node.node_type == "start")
    else {
        return true;
    };

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
}

async fn set_session_handover(
    state: &Arc<AppState>,
    session_id: &str,
    active: bool,
) -> Option<SessionSummary> {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(session_id)?;
    session.handover_active = active;
    Some(session_summary(session))
}

async fn recent_session_context(state: &Arc<AppState>, session_id: &str, limit: usize) -> String {
    let messages = {
        let sessions = state.sessions.read().await;
        sessions
            .get(session_id)
            .map(|session| session.messages.clone())
            .unwrap_or_default()
    };

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

    let system_instruction = if prompt.trim().is_empty() {
        "You are a support agent in a chat flow. Use prior conversation context and respond briefly and helpfully. \
If user asks for a human, transfer, escalation, or representative, set handover=true."
            .to_string()
    } else {
        prompt.trim().to_string()
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
        };
    }

    let response = state
        .ai_client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": "gpt-4o-mini",
            "instructions": system_instruction,
            "input": format!(
                "Conversation transcript (oldest to newest):\n{}\n\nLatest visitor message:\n{}\n\nReturn ONLY JSON: {{\"reply\":\"string\",\"handover\":boolean}}",
                transcript,
                visitor_text.trim()
            ),
        }))
        .send()
        .await;

    let Ok(response) = response else {
        return AiDecision {
            reply: "I had a temporary issue generating an AI reply. Could you rephrase?".to_string(),
            handover: has_handover_intent(visitor_text),
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
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw_text) {
            let reply = parsed
                .get("reply")
                .and_then(Value::as_str)
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| "I can help with that. Tell me a bit more.".to_string());
            let handover = parsed
                .get("handover")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            return AiDecision { reply, handover };
        }

        return AiDecision {
            reply: raw_text,
            handover: has_handover_intent(visitor_text),
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
    }
}

async fn send_flow_agent_message(state: Arc<AppState>, session_id: &str, text: &str, delay_ms: u64) {
    if text.trim().is_empty() {
        return;
    }
    start_agent_typing(state.clone(), session_id).await;
    tokio::time::sleep(Duration::from_millis(delay_ms.clamp(120, 6000))).await;
    let _ = add_message(state.clone(), session_id, "agent", text).await;
    stop_agent_typing(state, session_id).await;
}

async fn execute_flow(state: Arc<AppState>, session_id: String, flow: ChatFlow, visitor_text: String) {
    if !flow.enabled || !flow_trigger_matches(&flow, &visitor_text) {
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

    let start_id = flow
        .nodes
        .iter()
        .find(|node| node.node_type == "trigger" || node.node_type == "start")
        .map(|node| node.id.clone())
        .or_else(|| flow.nodes.first().map(|node| node.id.clone()));

    let Some(mut current_id) = start_id else {
        return;
    };

    for _ in 0..24 {
        let Some(node) = node_by_id.get(&current_id).cloned() else {
            break;
        };
        let edges = outgoing.get(&node.id).cloned().unwrap_or_default();

        match node.node_type.as_str() {
            "trigger" | "start" => {}
            "message" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(420);
                send_flow_agent_message(state.clone(), &session_id, &text, delay_ms).await;
            }
            "ai" => {
                let prompt = flow_node_data_text(&node, "prompt").unwrap_or_default();
                let delay_ms = flow_node_data_u64(&node, "delayMs").unwrap_or(700);
                let decision = generate_ai_reply(state.clone(), &session_id, &prompt, &visitor_text).await;
                send_flow_agent_message(state.clone(), &session_id, &decision.reply, delay_ms).await;
                if decision.handover {
                    if let Some(summary) = set_session_handover(&state, &session_id, true).await {
                        emit_session_update(&state, summary).await;
                    }
                    break;
                }
            }
            "condition" => {
                let contains = flow_node_data_text(&node, "contains")
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let matches = !contains.is_empty()
                    && visitor_text.to_ascii_lowercase().contains(contains.trim());
                let desired = if matches { "true" } else { "false" };
                let next = edges
                    .iter()
                    .find(|edge| flow_edge_condition(edge) == desired)
                    .or_else(|| edges.iter().find(|edge| flow_edge_condition(edge) == "default"))
                    .or_else(|| edges.first())
                    .map(|edge| edge.target.clone());
                if let Some(next_id) = next {
                    current_id = next_id;
                    continue;
                }
                break;
            }
            "end" => break,
            _ => {
                if let Some(text) = flow_node_data_text(&node, "text") {
                    send_flow_agent_message(state.clone(), &session_id, &text, 320).await;
                }
            }
        }

        let Some(next_id) = edges.first().map(|edge| edge.target.clone()) else {
            break;
        };
        current_id = next_id;
    }
}

async fn run_flow_for_visitor_message(state: Arc<AppState>, session_id: String, visitor_text: String) {
    if has_handover_intent(&visitor_text) {
        if let Some(summary) = set_session_handover(&state, &session_id, true).await {
            emit_session_update(&state, summary).await;
        }
        send_flow_agent_message(
            state,
            &session_id,
            "Understood. I am transferring you to a human agent now.",
            450,
        )
        .await;
        return;
    }

    let handover_active = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .map(|session| session.handover_active)
            .unwrap_or(false)
    };
    if handover_active {
        return;
    }

    let assigned_flow_id = {
        let sessions = state.sessions.read().await;
        sessions.get(&session_id).and_then(|session| session.flow_id.clone())
    };

    let flow = {
        let flows = state.flows.read().await;
        if let Some(flow_id) = assigned_flow_id {
            flows.get(&flow_id).cloned()
        } else {
            let mut enabled = flows
                .values()
                .filter(|flow| flow.enabled)
                .cloned()
                .collect::<Vec<_>>();
            enabled.sort_by(|a, b| a.created_at.cmp(&b.created_at));
            enabled.into_iter().next()
        }
    };

    if let Some(flow) = flow {
        if flow_trigger_matches(&flow, &visitor_text) {
            execute_flow(state, session_id, flow, visitor_text).await;
            return;
        }

        if visitor_text.trim() != "__session_start__" {
            let flow_prompt = flow
                .nodes
                .iter()
                .find(|node| node.node_type == "ai")
                .and_then(|node| flow_node_data_text(node, "prompt"))
                .unwrap_or_else(|| {
                    "You are a helpful support agent. Use the full conversation context, including user-provided names."
                        .to_string()
                });

            let decision = generate_ai_reply(state.clone(), &session_id, &flow_prompt, &visitor_text).await;
            send_flow_agent_message(state.clone(), &session_id, &decision.reply, 700).await;
            if decision.handover {
                if let Some(summary) = set_session_handover(&state, &session_id, true).await {
                    emit_session_update(&state, summary).await;
                }
            }
        }
        return;
    }

    if visitor_text.trim().eq_ignore_ascii_case("okay") {
        send_flow_agent_message(state, &session_id, "Glad I could help!", 900).await;
    }
}

async fn post_session(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let session_id = Uuid::new_v4().to_string();
    let _ = ensure_session(state, &session_id).await;
    (StatusCode::CREATED, Json(json!({ "sessionId": session_id })))
}

async fn get_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut list = {
        let sessions = state.sessions.read().await;
        sessions.values().map(session_summary).collect::<Vec<_>>()
    };

    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Json(json!({ "sessions": list }))
}

async fn get_messages(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session = ensure_session(state, &session_id).await;
    Json(json!({ "messages": session.messages }))
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
        Some("agent") => "agent",
        _ => "visitor",
    };

    let _ = ensure_session(state.clone(), &session_id).await;

    let Some(message) = add_message(state.clone(), &session_id, sender, &body.text).await else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "unable to create message" })),
        )
            .into_response();
    };

    if sender == "visitor" {
        let state_clone = state.clone();
        let session_clone = session_id.clone();
        let text_clone = body.text.clone();
        tokio::spawn(async move {
            run_flow_for_visitor_message(state_clone, session_clone, text_clone).await;
        });
    }

    (StatusCode::CREATED, Json(json!({ "message": message }))).into_response()
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

    {
        let agents = state.agents.read().await;
        if agents.values().any(|agent| agent.profile.email == email) {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "email already registered" })),
            )
                .into_response();
        }
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
    {
        let mut agents = state.agents.write().await;
        agents.insert(
            profile.id.clone(),
            AgentRecord {
                profile: profile.clone(),
                password_hash,
            },
        );
    }
    {
        let mut tokens = state.tokens.write().await;
        tokens.insert(token.clone(), profile.id.clone());
    }

    (
        StatusCode::CREATED,
        Json(json!({
            "token": token,
            "agent": profile
        })),
    )
        .into_response()
}

async fn login_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let email = body.email.trim().to_lowercase();
    let found = {
        let agents = state.agents.read().await;
        agents
            .values()
            .find(|agent| agent.profile.email == email)
            .cloned()
    };

    let Some(agent) = found else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid credentials" })),
        )
            .into_response();
    };

    let valid = verify(body.password, &agent.password_hash).unwrap_or(false);
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid credentials" })),
        )
            .into_response();
    }

    let token = Uuid::new_v4().to_string();
    {
        let mut tokens = state.tokens.write().await;
        tokens.insert(token.clone(), agent.profile.id.clone());
    }

    (
        StatusCode::OK,
        Json(json!({
            "token": token,
            "agent": agent.profile
        })),
    )
        .into_response()
}

async fn get_me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => (StatusCode::OK, Json(json!({ "agent": agent }))).into_response(),
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

    {
        let mut agents = state.agents.write().await;
        if let Some(record) = agents.get_mut(&agent.id) {
            record.profile.status = body.status.trim().to_string();
        }
    }

    let updated = {
        let agents = state.agents.read().await;
        agents.get(&agent.id).map(|a| a.profile.clone())
    };

    (StatusCode::OK, Json(json!({ "agent": updated }))).into_response()
}

async fn get_teams(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let teams = {
        let teams = state.teams.read().await;
        teams.values().cloned().collect::<Vec<_>>()
    };
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
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name required" }))).into_response();
    }
    let team = Team {
        id: Uuid::new_v4().to_string(),
        name,
        agent_ids: vec![],
    };
    {
        let mut teams = state.teams.write().await;
        teams.insert(team.id.clone(), team.clone());
    }
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
    {
        let mut teams = state.teams.write().await;
        let Some(team) = teams.get_mut(&team_id) else {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "team not found" }))).into_response();
        };
        if !team.agent_ids.contains(&agent_id) {
            team.agent_ids.push(agent_id.clone());
        }
    }
    {
        let mut agents = state.agents.write().await;
        if let Some(agent) = agents.get_mut(&agent_id) {
            if !agent.profile.team_ids.contains(&team_id) {
                agent.profile.team_ids.push(team_id.clone());
            }
        }
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn get_inboxes(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let inboxes = {
        let inboxes = state.inboxes.read().await;
        inboxes.values().cloned().collect::<Vec<_>>()
    };
    (StatusCode::OK, Json(json!({ "inboxes": inboxes }))).into_response()
}

async fn get_agents(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let agents = {
        let agents = state.agents.read().await;
        agents
            .values()
            .map(|record| record.profile.clone())
            .collect::<Vec<_>>()
    };
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
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name required" }))).into_response();
    }
    let inbox = Inbox {
        id: Uuid::new_v4().to_string(),
        name,
        channels: body.channels,
        agent_ids: vec![],
    };
    {
        let mut inboxes = state.inboxes.write().await;
        inboxes.insert(inbox.id.clone(), inbox.clone());
    }
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
    {
        let mut inboxes = state.inboxes.write().await;
        let Some(inbox) = inboxes.get_mut(&inbox_id) else {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "inbox not found" }))).into_response();
        };
        if !inbox.agent_ids.contains(&agent_id) {
            inbox.agent_ids.push(agent_id.clone());
        }
    }
    {
        let mut agents = state.agents.write().await;
        if let Some(agent) = agents.get_mut(&agent_id) {
            if !agent.profile.inbox_ids.contains(&inbox_id) {
                agent.profile.inbox_ids.push(inbox_id.clone());
            }
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
    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.assignee_agent_id = body.agent_id;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
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
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "channel required" }))).into_response();
    }
    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.channel = channel;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
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
    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.inbox_id = body.inbox_id;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
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
    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.team_id = body.team_id;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
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
        let exists = {
            let flows = state.flows.read().await;
            flows.contains_key(flow_id)
        };
        if !exists {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "flow not found" }))).into_response();
        }
    }

    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.flow_id = body.flow_id;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
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

    let mut sessions = state.sessions.write().await;
    let Some(session) = sessions.get_mut(&session_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "session not found" }))).into_response();
    };
    session.handover_active = body.active;
    (StatusCode::OK, Json(json!({ "session": session_summary(session) }))).into_response()
}

async fn get_flows(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let mut flows = {
        let flows = state.flows.read().await;
        flows.values().cloned().collect::<Vec<_>>()
    };
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

    let flow = {
        let flows = state.flows.read().await;
        flows.get(&flow_id).cloned()
    };
    let Some(flow) = flow else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "flow not found" }))).into_response();
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

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name required" }))).into_response();
    }

    let now = now_iso();
    let flow = ChatFlow {
        id: Uuid::new_v4().to_string(),
        name,
        description: body.description.trim().to_string(),
        enabled: body.enabled,
        created_at: now.clone(),
        updated_at: now,
        nodes: body.nodes,
        edges: body.edges,
    };

    {
        let mut flows = state.flows.write().await;
        flows.insert(flow.id.clone(), flow.clone());
    }

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

    let mut flows = state.flows.write().await;
    let Some(flow) = flows.get_mut(&flow_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "flow not found" }))).into_response();
    };

    if let Some(name) = body.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name required" }))).into_response();
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
    flow.updated_at = now_iso();

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

    {
        let mut flows = state.flows.write().await;
        if flows.remove(&flow_id).is_none() {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "flow not found" }))).into_response();
        }
    }

    {
        let mut sessions = state.sessions.write().await;
        for session in sessions.values_mut() {
            if session.flow_id.as_deref() == Some(flow_id.as_str()) {
                session.flow_id = None;
            }
        }
    }

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
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "text required" }))).into_response();
    }

    let note = ConversationNote {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        agent_id: agent.id,
        text,
        created_at: now_iso(),
    };

    {
        let mut notes = state.notes_by_session.write().await;
        notes.entry(session_id).or_default().push(note.clone());
    }

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
    let notes = {
        let notes_map = state.notes_by_session.read().await;
        notes_map.get(&session_id).cloned().unwrap_or_default()
    };
    (StatusCode::OK, Json(json!({ "notes": notes }))).into_response()
}

async fn list_channels(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
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

                    {
                        let mut rt = state.realtime.lock().await;
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
            "agent:join" => {
                let token = envelope
                    .data
                    .get("token")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();

                let is_valid = {
                    let tokens = state.tokens.read().await;
                    tokens.contains_key(&token)
                };

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
                    let _ = ensure_session(state.clone(), session_id).await;
                    let _ = add_message(state.clone(), session_id, "visitor", text).await;
                    let state_clone = state.clone();
                    let session_clone = session_id.to_string();
                    let text_clone = text.to_string();
                    tokio::spawn(async move {
                        run_flow_for_visitor_message(state_clone, session_clone, text_clone).await;
                    });
                }
            }
            "visitor:typing" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let text = envelope.data.get("text").and_then(Value::as_str).unwrap_or("");
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
                    if let Some(previous) = rt.watched_session.insert(client_id, session_id.to_string())
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
                if let (Some(session_id), Some(text)) = (session_id, text) {
                    set_agent_human_typing(state.clone(), client_id, session_id, false).await;
                    let _ = ensure_session(state.clone(), session_id).await;
                    let _ = add_message(state.clone(), session_id, "agent", text).await;
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

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(4000);

    let default_flow_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let default_flow = ChatFlow {
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
                data: json!({ "label": "Trigger", "keywords": ["__session_start__"] }),
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
    };

    let state = Arc::new(AppState {
        sessions: RwLock::new(HashMap::new()),
        notes_by_session: RwLock::new(HashMap::new()),
        agents: RwLock::new(HashMap::new()),
        tokens: RwLock::new(HashMap::new()),
        teams: RwLock::new({
            let mut teams = HashMap::new();
            let id = Uuid::new_v4().to_string();
            teams.insert(
                id.clone(),
                Team {
                    id,
                    name: "Support".to_string(),
                    agent_ids: vec![],
                },
            );
            teams
        }),
        inboxes: RwLock::new({
            let mut inboxes = HashMap::new();
            let id = Uuid::new_v4().to_string();
            inboxes.insert(
                id.clone(),
                Inbox {
                    id,
                    name: "General".to_string(),
                    channels: vec!["web".to_string(), "whatsapp".to_string()],
                    agent_ids: vec![],
                },
            );
            inboxes
        }),
        flows: RwLock::new({
            let mut flows = HashMap::new();
            flows.insert(default_flow.id.clone(), default_flow);
            flows
        }),
        default_flow_id,
        realtime: Mutex::new(RealtimeState::default()),
        next_client_id: AtomicUsize::new(0),
        ai_client: reqwest::Client::new(),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/auth/register", post(register_agent))
        .route("/api/auth/login", post(login_agent))
        .route("/api/auth/me", get(get_me))
        .route("/api/agent/status", patch(patch_agent_status))
        .route("/api/teams", get(get_teams).post(create_team))
        .route("/api/teams/{team_id}/members", post(add_member_to_team))
        .route("/api/inboxes", get(get_inboxes).post(create_inbox))
        .route("/api/inboxes/{inbox_id}/assign", post(assign_agent_to_inbox))
        .route("/api/channels", get(list_channels))
        .route("/api/agents", get(get_agents))
        .route("/api/session", post(post_session))
        .route("/api/sessions", get(get_sessions))
        .route("/api/session/{session_id}/messages", get(get_messages))
        .route("/api/session/{session_id}/message", post(post_message))
        .route("/api/session/{session_id}/assignee", patch(patch_session_assignee))
        .route("/api/session/{session_id}/channel", patch(patch_session_channel))
        .route("/api/session/{session_id}/inbox", patch(patch_session_inbox))
        .route("/api/session/{session_id}/team", patch(patch_session_team))
        .route("/api/session/{session_id}/flow", patch(patch_session_flow))
        .route("/api/session/{session_id}/handover", patch(patch_session_handover))
        .route(
            "/api/session/{session_id}/notes",
            get(get_notes).post(add_note),
        )
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
