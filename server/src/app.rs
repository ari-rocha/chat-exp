use std::{
    collections::{HashMap, HashSet},
    env,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use crate::prompting::{
    render_ai_grounding_policy, render_ai_json_format_hint, render_ai_user_content,
    render_extract_vars_system_prompt, render_extract_vars_user_prompt,
    render_flow_ai_fallback_prompt, render_kb_block, render_rerank_system_prompt,
    render_rerank_user_prompt, render_system_prompt, render_tools_block, AiUserContentContext,
    ExtractVarsUserContext, KbBlockContext, RerankUserContext, SystemPromptContext,
    ToolsBlockContext,
};
use crate::types::*;
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket},
        Multipart, Path, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use futures_util::{sink::SinkExt, stream::StreamExt};
use hmac::{Hmac, Mac};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
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

fn normalize_workspace_username(value: &str) -> String {
    let mut username = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    while username.contains("--") {
        username = username.replace("--", "-");
    }
    username.trim_matches('-').to_string()
}

fn validate_workspace_username(value: &str) -> Result<String, &'static str> {
    let username = normalize_workspace_username(value);
    if username.len() < 3 || username.len() > 32 {
        return Err("workspace_username_invalid");
    }
    let reserved = ["admin", "api", "www", "root", "support", "help"];
    if reserved.iter().any(|item| *item == username) {
        return Err("workspace_username_reserved");
    }
    let valid = Regex::new(r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$")
        .map(|re| re.is_match(&username))
        .unwrap_or(false);
    if !valid {
        return Err("workspace_username_invalid");
    }
    Ok(username)
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_canned_shortcut(value: &str) -> String {
    value.trim().replace('/', "")
}

fn resolve_database_url() -> String {
    if let Ok(url) = env::var("DATABASE_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    let host = env::var("POSTGRES_HOST")
        .or_else(|_| env::var("PGHOST"))
        .unwrap_or_else(|_| "localhost".to_string());
    let port = env::var("POSTGRES_PORT")
        .or_else(|_| env::var("PGPORT"))
        .unwrap_or_else(|_| "5432".to_string());
    let user = env::var("POSTGRES_USER")
        .or_else(|_| env::var("PGUSER"))
        .unwrap_or_else(|_| "postgres".to_string());
    let password = env::var("POSTGRES_PASSWORD")
        .or_else(|_| env::var("PGPASSWORD"))
        .unwrap_or_else(|_| "S8hibBES24uF7e6NJCUnxxA3vJ0E".to_string());
    let db = env::var("POSTGRES_DB")
        .or_else(|_| env::var("PGDATABASE"))
        .unwrap_or_else(|_| "chat_exp".to_string());
    format!("postgres://{user}:{password}@{host}:{port}/{db}")
}

fn markdown_to_plain_text(markdown: &str) -> String {
    let code_fence_re = Regex::new(r"(?s)```.*?```").ok();
    let inline_code_re = Regex::new(r"`([^`]+)`").ok();
    let links_re = Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").ok();
    let md_tokens_re = Regex::new(r"(?m)^#{1,6}\s*|[*_>#-]").ok();

    let mut text = markdown.to_string();
    if let Some(re) = code_fence_re.as_ref() {
        text = re.replace_all(&text, " ").to_string();
    }
    if let Some(re) = inline_code_re.as_ref() {
        text = re.replace_all(&text, "$1").to_string();
    }
    if let Some(re) = links_re.as_ref() {
        text = re.replace_all(&text, "$1").to_string();
    }
    if let Some(re) = md_tokens_re.as_ref() {
        text = re.replace_all(&text, "").to_string();
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(digest)
}

fn approximate_token_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn chunk_text(text: &str, target_tokens: usize, overlap_tokens: usize) -> Vec<String> {
    let words = text
        .split_whitespace()
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return vec![];
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < words.len() {
        let end = (start + target_tokens).min(words.len());
        chunks.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        let step = target_tokens.saturating_sub(overlap_tokens).max(1);
        start = start.saturating_add(step);
    }
    chunks
}

fn embedding_to_pgvector(embedding: &[f64]) -> String {
    let items = embedding
        .iter()
        .map(|v| format!("{:.8}", v))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

async fn issue_login_ticket(state: &Arc<AppState>, user_id: &str) -> Option<String> {
    let ticket = Uuid::new_v4().to_string();
    let now = Utc::now();
    let expires_at = (now + ChronoDuration::minutes(20)).to_rfc3339();
    let created_at = now.to_rfc3339();
    let ok = sqlx::query(
        "INSERT INTO auth_login_tickets (ticket, user_id, created_at, expires_at, used) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&ticket)
    .bind(user_id)
    .bind(created_at)
    .bind(expires_at)
    .bind(false)
    .execute(&state.db)
    .await
    .is_ok();
    if ok {
        Some(ticket)
    } else {
        None
    }
}

async fn consume_login_ticket(state: &Arc<AppState>, ticket: &str) -> Option<String> {
    let now = Utc::now().to_rfc3339();
    let row = sqlx::query(
        "UPDATE auth_login_tickets SET used = true WHERE ticket = $1 AND used = false AND expires_at > $2 RETURNING user_id",
    )
    .bind(ticket)
    .bind(now)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    Some(row.get("user_id"))
}

async fn list_user_workspaces(state: &Arc<AppState>, user_id: &str) -> Vec<WorkspaceSummary> {
    let rows = sqlx::query(
        "SELECT t.id, t.name, t.slug, t.workspace_username, a.role \
         FROM agents a \
         JOIN tenants t ON t.id = a.tenant_id \
         WHERE a.user_id = $1 \
         ORDER BY t.created_at ASC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|row| WorkspaceSummary {
            id: row.get("id"),
            name: row.get("name"),
            slug: row.get("slug"),
            workspace_username: row.get("workspace_username"),
            role: row.get("role"),
        })
        .collect()
}

async fn issue_workspace_token(
    state: &Arc<AppState>,
    user_id: &str,
    tenant_id: &str,
) -> Option<(String, AgentProfile)> {
    let row = sqlx::query(
        "SELECT id, name, email, status, role, avatar_url, team_ids \
         FROM agents WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;

    let profile = AgentProfile {
        id: row.get("id"),
        name: row.get("name"),
        email: row.get("email"),
        status: row.get("status"),
        role: row.get("role"),
        avatar_url: row.get("avatar_url"),
        team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
            .unwrap_or_default(),
    };

    let token = Uuid::new_v4().to_string();
    let inserted = sqlx::query(
        "INSERT INTO auth_tokens (token, agent_id, tenant_id, created_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(&token)
    .bind(&profile.id)
    .bind(tenant_id)
    .bind(now_iso())
    .execute(&state.db)
    .await
    .is_ok();

    if inserted {
        Some((token, profile))
    } else {
        None
    }
}

fn json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn parse_json_text(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or(Value::Null)
}

fn config_text(config: &Value, key: &str) -> String {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn parse_channel_row(row: sqlx::postgres::PgRow) -> Channel {
    Channel {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        channel_type: row.get("channel_type"),
        name: row.get("name"),
        config: parse_json_text(&row.get::<String, _>("config")),
        enabled: row.get("enabled"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn validate_channel_config(channel_type: &str, config: &Value) -> Result<(), String> {
    if channel_type != "whatsapp" {
        return Ok(());
    }
    let required = ["phoneNumberId", "accessToken", "verifyToken", "appSecret"];
    let missing = required
        .iter()
        .filter_map(|key| {
            if config_text(config, key).is_empty() {
                Some(*key)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "missing whatsapp config fields: {}",
            missing.join(", ")
        ))
    }
}

fn normalize_whatsapp_phone(raw: &str) -> Option<String> {
    let digits = raw
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

fn whatsapp_visitor_id(raw: &str) -> Option<String> {
    let phone = normalize_whatsapp_phone(raw)?;
    Some(format!("whatsapp:{phone}"))
}

fn whatsapp_phone_from_visitor_id(visitor_id: &str) -> Option<String> {
    if !visitor_id.starts_with("whatsapp:") {
        return None;
    }
    normalize_whatsapp_phone(visitor_id.trim_start_matches("whatsapp:"))
}

fn whatsapp_contact_profile_names(value: &Value) -> HashMap<String, String> {
    let contacts = value
        .get("contacts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut map = HashMap::new();
    for contact in contacts {
        let wa_id = contact
            .get("wa_id")
            .and_then(Value::as_str)
            .or_else(|| contact.get("input").and_then(Value::as_str))
            .unwrap_or("");
        let Some(digits) = normalize_whatsapp_phone(wa_id) else {
            continue;
        };
        let name = contact
            .get("profile")
            .and_then(|p| p.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        map.insert(digits, name);
    }
    map
}

fn verify_whatsapp_signature(
    app_secret: &str,
    signature_header: Option<&str>,
    body: &[u8],
) -> bool {
    if app_secret.is_empty() {
        return true;
    }
    let signature = signature_header.unwrap_or("").trim();
    let signature = signature
        .strip_prefix("sha256=")
        .unwrap_or(signature)
        .trim();
    if signature.is_empty() {
        return false;
    }
    let Ok(signature_bytes) = hex::decode(signature) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(app_secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&signature_bytes).is_ok()
}

fn sign_whatsapp_media_token(
    app_secret: &str,
    channel_id: &str,
    media_id: &str,
    exp: i64,
) -> Option<String> {
    if app_secret.is_empty() {
        return None;
    }
    let payload = format!("{channel_id}:{media_id}:{exp}");
    let mut mac = Hmac::<Sha256>::new_from_slice(app_secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    Some(hex::encode(mac.finalize().into_bytes()))
}

fn verify_whatsapp_media_token(
    app_secret: &str,
    channel_id: &str,
    media_id: &str,
    exp: i64,
    sig: &str,
) -> bool {
    if app_secret.is_empty() {
        return true;
    }
    if exp < Utc::now().timestamp() {
        return false;
    }
    let Ok(signature_bytes) = hex::decode(sig.trim()) else {
        return false;
    };
    let payload = format!("{channel_id}:{media_id}:{exp}");
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(app_secret.as_bytes()) else {
        return false;
    };
    mac.update(payload.as_bytes());
    mac.verify_slice(&signature_bytes).is_ok()
}

fn signed_whatsapp_media_url(
    channel_id: &str,
    media_id: &str,
    app_secret: &str,
    ttl_seconds: i64,
) -> String {
    if app_secret.is_empty() {
        return format!("/api/channels/{channel_id}/whatsapp/media/{media_id}");
    }
    let exp = Utc::now().timestamp() + ttl_seconds.max(120);
    let sig = sign_whatsapp_media_token(app_secret, channel_id, media_id, exp).unwrap_or_default();
    format!("/api/channels/{channel_id}/whatsapp/media/{media_id}?exp={exp}&sig={sig}")
}

fn media_extension_from_filename(name: &str) -> Option<String> {
    let ext = name.rsplit('.').next()?.trim().to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 10 {
        return None;
    }
    if ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(ext)
    } else {
        None
    }
}

fn media_extension_from_mime(mime: &str, fallback_kind: &str) -> String {
    let mt = mime.to_ascii_lowercase();
    if mt.contains("jpeg") || mt.contains("jpg") {
        "jpg".to_string()
    } else if mt.contains("png") {
        "png".to_string()
    } else if mt.contains("webp") {
        "webp".to_string()
    } else if mt.contains("gif") {
        "gif".to_string()
    } else if mt.contains("mpeg") || mt.contains("mp3") {
        "mp3".to_string()
    } else if mt.contains("ogg") {
        "ogg".to_string()
    } else if mt.contains("wav") {
        "wav".to_string()
    } else if mt.contains("mp4") {
        "mp4".to_string()
    } else if mt.contains("quicktime") {
        "mov".to_string()
    } else if mt.contains("pdf") {
        "pdf".to_string()
    } else if mt.contains("json") {
        "json".to_string()
    } else if mt.contains("plain") {
        "txt".to_string()
    } else {
        match fallback_kind {
            "image" | "sticker" => "jpg".to_string(),
            "audio" | "voice" => "ogg".to_string(),
            "video" => "mp4".to_string(),
            "document" => "bin".to_string(),
            _ => "bin".to_string(),
        }
    }
}

fn media_content_type_from_extension(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "pdf" => "application/pdf",
        "txt" => "text/plain; charset=utf-8",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn attachment_type_from_mime(mime: &str) -> String {
    let mt = mime.to_ascii_lowercase();
    if mt.starts_with("image/") {
        "image".to_string()
    } else if mt.starts_with("audio/") {
        "audio".to_string()
    } else if mt.starts_with("video/") {
        "video".to_string()
    } else {
        "document".to_string()
    }
}

fn is_safe_media_file_name(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains("..")
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn resolve_public_url(base: &str, url: &str) -> String {
    let value = url.trim();
    if value.is_empty() {
        return String::new();
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        return value.to_string();
    }
    let base = base.trim_end_matches('/');
    if value.starts_with('/') {
        format!("{base}{value}")
    } else {
        format!("{base}/{value}")
    }
}

fn whatsapp_template_param_count(components: &[Value]) -> usize {
    let mut total = 0usize;
    let Ok(re) = Regex::new(r"\{\{(\d+)\}\}") else {
        return 0;
    };
    for component in components {
        let ctype = component
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        if ctype != "BODY" && ctype != "HEADER" && ctype != "FOOTER" {
            continue;
        }
        if let Some(text) = component.get("text").and_then(Value::as_str) {
            let mut max_param_idx = 0usize;
            for cap in re.captures_iter(text) {
                let idx = cap
                    .get(1)
                    .and_then(|m| m.as_str().parse::<usize>().ok())
                    .unwrap_or(0);
                if idx > max_param_idx {
                    max_param_idx = idx;
                }
            }
            total += max_param_idx;
        }
    }
    total
}

fn whatsapp_template_body_preview(components: &[Value]) -> String {
    components
        .iter()
        .find_map(|c| {
            let ctype = c
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_uppercase();
            if ctype == "BODY" {
                c.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .unwrap_or("")
        .to_string()
}

fn render_whatsapp_template_body(body: &str, params: &[String]) -> String {
    let Ok(re) = Regex::new(r"\{\{(\d+)\}\}") else {
        return body.to_string();
    };
    re.replace_all(body, |caps: &regex::Captures| {
        let idx = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0);
        if idx == 0 {
            return caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string();
        }
        params
            .get(idx - 1)
            .cloned()
            .unwrap_or_else(|| caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string())
    })
    .to_string()
}

fn whatsapp_template_components_payload(components: &[Value], params: &[String]) -> Vec<Value> {
    let Ok(re) = Regex::new(r"\{\{(\d+)\}\}") else {
        return vec![];
    };
    let mut cursor = 0usize;
    let mut out = vec![];
    for component in components {
        let ctype_upper = component
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        if ctype_upper != "BODY" && ctype_upper != "HEADER" {
            continue;
        }
        let Some(text) = component.get("text").and_then(Value::as_str) else {
            continue;
        };
        let mut needed = 0usize;
        for cap in re.captures_iter(text) {
            let idx = cap
                .get(1)
                .and_then(|m| m.as_str().parse::<usize>().ok())
                .unwrap_or(0);
            if idx > needed {
                needed = idx;
            }
        }
        if needed == 0 {
            continue;
        }
        let kind = ctype_upper.to_ascii_lowercase();
        let mut p = vec![];
        for i in 0..needed {
            let value = params.get(cursor + i).cloned().unwrap_or_default();
            p.push(json!({ "type": "text", "text": value }));
        }
        cursor += needed;
        out.push(json!({
            "type": kind,
            "parameters": p
        }));
    }
    out
}

fn render_whatsapp_template_text(
    components: &[Value],
    params: &[String],
    fallback: &str,
) -> String {
    let Ok(re) = Regex::new(r"\{\{(\d+)\}\}") else {
        return fallback.to_string();
    };
    let mut cursor = 0usize;
    let mut parts = vec![];
    for component in components {
        let ctype_upper = component
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        if ctype_upper != "BODY" && ctype_upper != "HEADER" {
            continue;
        }
        let Some(text) = component.get("text").and_then(Value::as_str) else {
            continue;
        };
        let mut needed = 0usize;
        for cap in re.captures_iter(text) {
            let idx = cap
                .get(1)
                .and_then(|m| m.as_str().parse::<usize>().ok())
                .unwrap_or(0);
            if idx > needed {
                needed = idx;
            }
        }
        let slice = if needed == 0 {
            &[][..]
        } else {
            let end = (cursor + needed).min(params.len());
            let start = cursor.min(end);
            cursor = end;
            &params[start..end]
        };
        let rendered = render_whatsapp_template_body(text, slice);
        if !rendered.trim().is_empty() {
            parts.push(rendered);
        }
    }
    if parts.is_empty() {
        fallback.to_string()
    } else {
        parts.join("\n")
    }
}

async fn fetch_whatsapp_templates_from_meta(
    state: &Arc<AppState>,
    access_token: &str,
    business_account_id: &str,
) -> Result<Vec<Value>, String> {
    let response = state
        .ai_client
        .get(format!(
            "https://graph.facebook.com/v21.0/{}/message_templates?fields=name,status,category,language,components&limit=200",
            business_account_id
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("failed to fetch whatsapp templates: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("whatsapp templates api error {status}: {body}"));
    }
    let payload = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    Ok(payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn fetch_whatsapp_media_from_meta(
    state: &Arc<AppState>,
    access_token: &str,
    media_id: &str,
) -> Result<(Bytes, String), String> {
    let metadata_response = state
        .ai_client
        .get(format!("https://graph.facebook.com/v21.0/{media_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !metadata_response.status().is_success() {
        let status = metadata_response.status();
        let body = metadata_response.text().await.unwrap_or_default();
        return Err(format!(
            "whatsapp media metadata error {}: {}",
            status.as_u16(),
            body
        ));
    }

    let metadata = metadata_response
        .json::<Value>()
        .await
        .unwrap_or_else(|_| json!({}));
    let media_url = metadata
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if media_url.is_empty() {
        return Err("missing media url from whatsapp".to_string());
    }
    let fallback_mime = metadata
        .get("mime_type")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();

    let media_response = state
        .ai_client
        .get(media_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !media_response.status().is_success() {
        let status = media_response.status();
        let body = media_response.text().await.unwrap_or_default();
        return Err(format!(
            "whatsapp media download error {}: {}",
            status.as_u16(),
            body
        ));
    }

    let content_type = media_response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(&fallback_mime)
        .to_string();
    let bytes = media_response.bytes().await.map_err(|e| e.to_string())?;
    Ok((bytes, content_type))
}

async fn archive_whatsapp_media_widget(
    state: &Arc<AppState>,
    channel: &Channel,
    widget: Value,
) -> Value {
    if widget.get("type").and_then(Value::as_str).unwrap_or("") != "attachment" {
        return widget;
    }
    let media_id = widget
        .get("mediaId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if media_id.is_empty() {
        return widget;
    }

    let access_token = config_text(&channel.config, "accessToken");
    if access_token.is_empty() {
        return widget;
    }

    let Ok((bytes, mime_type)) =
        fetch_whatsapp_media_from_meta(state, &access_token, &media_id).await
    else {
        return widget;
    };

    let attachment_type = widget
        .get("attachmentType")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let original_name = widget
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let ext = media_extension_from_filename(&original_name)
        .unwrap_or_else(|| media_extension_from_mime(&mime_type, &attachment_type));
    let file_name = format!("{}.{}", Uuid::new_v4(), ext);
    let path = state.media_storage_dir.join(&file_name);

    if tokio::fs::write(&path, &bytes).await.is_err() {
        return widget;
    }

    let mut next = widget;
    if let Some(obj) = next.as_object_mut() {
        obj.insert(
            "url".to_string(),
            Value::String(format!("/api/media/{file_name}")),
        );
        obj.insert("mimeType".to_string(), Value::String(mime_type));
        obj.insert("stored".to_string(), Value::Bool(true));
        obj.insert("storage".to_string(), Value::String("local".to_string()));
        obj.insert("storedFileName".to_string(), Value::String(file_name));
        obj.insert(
            "sizeBytes".to_string(),
            Value::Number(serde_json::Number::from(bytes.len() as u64)),
        );
    }
    next
}

fn whatsapp_inbound_content(
    message: &Value,
    channel_id: &str,
    app_secret: &str,
) -> Option<(String, Option<Value>)> {
    let msg_type = message
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();

    if msg_type == "text" {
        let text = message
            .get("text")
            .and_then(|v| v.get("body"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        return if text.is_empty() {
            None
        } else {
            Some((text, None))
        };
    }

    if msg_type == "button" {
        let text = message
            .get("button")
            .and_then(|v| v.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        return if text.is_empty() {
            None
        } else {
            Some((text, None))
        };
    }

    if msg_type == "interactive" {
        let text = message
            .get("interactive")
            .and_then(|v| {
                v.get("button_reply")
                    .and_then(|r| r.get("title"))
                    .and_then(Value::as_str)
                    .or_else(|| {
                        v.get("list_reply")
                            .and_then(|r| r.get("title"))
                            .and_then(Value::as_str)
                    })
            })
            .unwrap_or("")
            .trim()
            .to_string();
        return if text.is_empty() {
            None
        } else {
            Some((text, None))
        };
    }

    if msg_type == "location" {
        let location = message
            .get("location")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let lat = location
            .get("latitude")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let lng = location
            .get("longitude")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let name = location
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let address = location
            .get("address")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let map_url = if lat.abs() > 0.0 || lng.abs() > 0.0 {
            format!("https://maps.google.com/?q={lat},{lng}")
        } else {
            String::new()
        };
        let text = if !name.is_empty() {
            format!("Shared location: {name}")
        } else if !address.is_empty() {
            format!("Shared location: {address}")
        } else {
            "Shared a location".to_string()
        };
        let widget = json!({
            "type": "attachment",
            "attachmentType": "location",
            "title": name,
            "description": address,
            "latitude": lat,
            "longitude": lng,
            "mapUrl": map_url
        });
        return Some((text, Some(widget)));
    }

    if matches!(
        msg_type.as_str(),
        "image" | "audio" | "video" | "document" | "sticker"
    ) {
        let body = message.get(&msg_type).cloned().unwrap_or_else(|| json!({}));
        let media_id = body
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if media_id.is_empty() {
            return Some((format!("Sent a {msg_type} message"), None));
        }
        let caption = body
            .get("caption")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let mime_type = body
            .get("mime_type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let filename = body
            .get("filename")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let attachment_type =
            if msg_type == "audio" && body.get("voice").and_then(Value::as_bool).unwrap_or(false) {
                "voice".to_string()
            } else {
                msg_type.clone()
            };
        let fallback = match attachment_type.as_str() {
            "image" => "Sent an image",
            "voice" => "Sent a voice message",
            "audio" => "Sent an audio file",
            "video" => "Sent a video",
            "document" => "Sent a document",
            "sticker" => "Sent a sticker",
            _ => "Sent an attachment",
        };
        let text = if caption.is_empty() {
            fallback.to_string()
        } else {
            caption.clone()
        };
        let widget = json!({
            "type": "attachment",
            "attachmentType": attachment_type,
            "mediaId": media_id,
            "url": signed_whatsapp_media_url(channel_id, &media_id, app_secret, 60 * 60 * 24),
            "mimeType": mime_type,
            "filename": filename,
            "caption": caption
        });
        return Some((text, Some(widget)));
    }

    if msg_type.is_empty() {
        None
    } else {
        Some((format!("Sent a {msg_type} message"), None))
    }
}

async fn find_channel_by_id(state: &Arc<AppState>, channel_id: &str) -> Option<Channel> {
    let row = sqlx::query(
        "SELECT id, tenant_id, channel_type, name, config, enabled, created_at, updated_at \
         FROM channels WHERE id = $1",
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    Some(parse_channel_row(row))
}

async fn find_or_create_whatsapp_session(
    state: &Arc<AppState>,
    tenant_id: &str,
    visitor_id: &str,
) -> Option<String> {
    let existing_rows = sqlx::query(
        "SELECT id FROM sessions \
         WHERE tenant_id = $1 \
           AND channel = 'whatsapp' \
           AND visitor_id = $2 \
           AND status <> 'resolved' \
           AND status <> 'closed' \
         ORDER BY updated_at DESC",
    )
    .bind(tenant_id)
    .bind(visitor_id)
    .fetch_all(&state.db)
    .await
    .ok()
    .unwrap_or_default();
    if let Some(primary) = existing_rows.first() {
        let primary_id: String = primary.get("id");
        if existing_rows.len() > 1 {
            let duplicate_ids = existing_rows
                .iter()
                .skip(1)
                .map(|r| r.get::<String, _>("id"))
                .collect::<Vec<_>>();
            if !duplicate_ids.is_empty() {
                let _ = sqlx::query(
                    "UPDATE sessions SET status = 'resolved', updated_at = $1 \
                     WHERE id = ANY($2::text[])",
                )
                .bind(now_iso())
                .bind(&duplicate_ids)
                .execute(&state.db)
                .await;
            }
        }
        return Some(primary_id);
    }

    let flow_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM flows WHERE tenant_id = $1 AND enabled = true ORDER BY created_at ASC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let now = now_iso();
    let session_id = Uuid::new_v4().to_string();
    let inserted = sqlx::query(
        "INSERT INTO sessions \
         (id, tenant_id, created_at, updated_at, channel, assignee_agent_id, team_id, flow_id, handover_active, status, priority, contact_id, visitor_id) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(&session_id)
    .bind(tenant_id)
    .bind(&now)
    .bind(&now)
    .bind("whatsapp")
    .bind(Option::<String>::None)
    .bind(Option::<String>::None)
    .bind(flow_id)
    .bind(false)
    .bind("open")
    .bind("normal")
    .bind(Option::<String>::None)
    .bind(visitor_id)
    .execute(&state.db)
    .await
    .is_ok();
    if inserted {
        Some(session_id)
    } else {
        None
    }
}

async fn send_whatsapp_message_for_session(
    state: Arc<AppState>,
    session_id: String,
    text: String,
    widget: Option<Value>,
) -> Result<Value, Value> {
    let (channel, to_phone) =
        whatsapp_channel_and_recipient_for_session(&state, &session_id).await?;
    let access_token = config_text(&channel.config, "accessToken");
    let phone_number_id = config_text(&channel.config, "phoneNumberId");
    if access_token.is_empty() || phone_number_id.is_empty() {
        return Err(json!({
            "statusCode": 0,
            "statusText": "CONFIG_ERROR",
            "rawBody": "missing whatsapp accessToken or phoneNumberId",
            "body": { "error": "missing whatsapp accessToken or phoneNumberId" }
        }));
    }

    let mut payload = json!({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
    });

    let attachment = widget
        .as_ref()
        .filter(|w| w.get("type").and_then(Value::as_str) == Some("attachment"));
    if let Some(att) = attachment {
        let attachment_type = att
            .get("attachmentType")
            .and_then(Value::as_str)
            .unwrap_or("document")
            .to_ascii_lowercase();
        let media_link = resolve_public_url(
            &state.public_base_url,
            att.get("url").and_then(Value::as_str).unwrap_or(""),
        );
        if media_link.is_empty() {
            return Err(json!({
                "statusCode": 0,
                "statusText": "PAYLOAD_ERROR",
                "rawBody": "missing attachment url for whatsapp media send",
                "body": { "error": "missing attachment url for whatsapp media send" }
            }));
        }
        match attachment_type.as_str() {
            "image" | "sticker" => {
                payload["type"] = json!("image");
                payload["image"] = json!({
                    "link": media_link,
                    "caption": text,
                });
            }
            "audio" | "voice" => {
                payload["type"] = json!("audio");
                payload["audio"] = json!({ "link": media_link });
            }
            "video" => {
                payload["type"] = json!("video");
                payload["video"] = json!({
                    "link": media_link,
                    "caption": text,
                });
            }
            _ => {
                payload["type"] = json!("document");
                payload["document"] = json!({
                    "link": media_link,
                    "filename": att.get("filename").and_then(Value::as_str).unwrap_or("attachment"),
                    "caption": text,
                });
            }
        }
    } else {
        payload["type"] = json!("text");
        payload["text"] = json!({
            "preview_url": false,
            "body": text
        });
    }

    let response = state
        .ai_client
        .post(format!(
            "https://graph.facebook.com/v21.0/{}/messages",
            phone_number_id
        ))
        .bearer_auth(&access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            json!({
                "statusCode": 0,
                "statusText": "REQUEST_ERROR",
                "rawBody": e.to_string(),
                "body": { "error": e.to_string() }
            })
        })?;

    let status = response.status();
    let raw_body = response.text().await.unwrap_or_default();
    let body =
        serde_json::from_str::<Value>(&raw_body).unwrap_or_else(|_| json!({ "raw": raw_body }));
    let result = json!({
        "statusCode": status.as_u16(),
        "statusText": status.to_string(),
        "rawBody": raw_body,
        "body": body
    });

    if status.is_success() {
        return Ok(result);
    }
    Err(result)
}

async fn whatsapp_channel_and_recipient_for_session(
    state: &Arc<AppState>,
    session_id: &str,
) -> Result<(Channel, String), String> {
    let session_row = sqlx::query(
        "SELECT tenant_id, channel, visitor_id FROM sessions WHERE id = $1 LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    let Some(session_row) = session_row else {
        return Err("session not found".to_string());
    };
    let channel_name: String = session_row.get("channel");
    if channel_name != "whatsapp" {
        return Err("session channel is not whatsapp".to_string());
    }
    let visitor_id: String = session_row.get("visitor_id");
    let Some(to_phone) = whatsapp_phone_from_visitor_id(&visitor_id) else {
        return Err("missing whatsapp visitor phone".to_string());
    };
    let tenant_id: String = session_row.get("tenant_id");
    let channel_row = sqlx::query(
        "SELECT id, tenant_id, channel_type, name, config, enabled, created_at, updated_at \
         FROM channels \
         WHERE tenant_id = $1 AND channel_type = 'whatsapp' AND enabled = true \
         ORDER BY created_at ASC LIMIT 1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let Some(channel_row) = channel_row else {
        return Err("no whatsapp channel configured".to_string());
    };
    Ok((parse_channel_row(channel_row), to_phone))
}

fn whatsapp_blocklist_contains(response: &Value, phone_or_wa_id: &str) -> bool {
    let Some(target) = normalize_whatsapp_phone(phone_or_wa_id) else {
        return false;
    };
    let mut candidates: Vec<Value> = Vec::new();

    if let Some(data_rows) = response.get("data").and_then(Value::as_array) {
        for row in data_rows {
            if row.get("wa_id").is_some() || row.get("input").is_some() {
                candidates.push(row.clone());
            }
            if let Some(items) = row.get("block_users").and_then(Value::as_array) {
                candidates.extend(items.iter().cloned());
            }
        }
    }

    if let Some(items) = response.get("block_users").and_then(Value::as_array) {
        candidates.extend(items.iter().cloned());
    }
    if let Some(items) = response
        .get("block_users")
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("added_users"))
        .and_then(Value::as_array)
    {
        candidates.extend(items.iter().cloned());
    }

    candidates.iter().any(|entry| {
        let input = entry
            .get("input")
            .and_then(Value::as_str)
            .and_then(normalize_whatsapp_phone)
            .unwrap_or_default();
        let wa_id = entry
            .get("wa_id")
            .and_then(Value::as_str)
            .and_then(normalize_whatsapp_phone)
            .unwrap_or_default();
        input == target || wa_id == target
    })
}

async fn whatsapp_fetch_block_status_for_phone(
    state: &Arc<AppState>,
    session_id: &str,
    to_phone: &str,
) -> Result<bool, String> {
    let raw = whatsapp_block_users_request_for_session(
        state,
        session_id,
        reqwest::Method::GET,
        Vec::new(),
    )
    .await?;
    Ok(whatsapp_blocklist_contains(&raw, to_phone))
}

async fn whatsapp_block_users_request_for_session(
    state: &Arc<AppState>,
    session_id: &str,
    method: reqwest::Method,
    users: Vec<String>,
) -> Result<Value, String> {
    let (channel, _) = whatsapp_channel_and_recipient_for_session(state, session_id).await?;
    let access_token = config_text(&channel.config, "accessToken");
    let phone_number_id = config_text(&channel.config, "phoneNumberId");
    if access_token.is_empty() || phone_number_id.is_empty() {
        return Err("missing whatsapp accessToken or phoneNumberId".to_string());
    }
    let url = format!("https://graph.facebook.com/v21.0/{phone_number_id}/block_users");
    let request = state.ai_client.request(method, url).bearer_auth(&access_token);
    let response = if users.is_empty() {
        request.send().await.map_err(|e| e.to_string())?
    } else {
        let payload = json!({
            "messaging_product": "whatsapp",
            "block_users": users.into_iter().map(|user| json!({ "user": user })).collect::<Vec<_>>()
        });
        request.json(&payload).send().await.map_err(|e| e.to_string())?
    };
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<Value>(&body).unwrap_or_else(|_| json!({ "raw": body }));
    if status.is_success() {
        return Ok(parsed);
    }
    Err(format!("{} {}: {}", status.as_u16(), status, body))
}

async fn whatsapp_block_status(
    Path(session_id): Path<String>,
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
    let session_tenant = tenant_for_session(&state, &session_id).await.unwrap_or_default();
    if session_tenant != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }
    let (_, to_phone) = match whatsapp_channel_and_recipient_for_session(&state, &session_id).await
    {
        Ok(v) => v,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    };
    let raw = match whatsapp_block_users_request_for_session(
        &state,
        &session_id,
        reqwest::Method::GET,
        Vec::new(),
    )
    .await
    {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("whatsapp block status error {err}") })),
            )
                .into_response()
        }
    };
    let blocked = whatsapp_blocklist_contains(&raw, &to_phone);
    (StatusCode::OK, Json(json!({ "blocked": blocked, "raw": raw }))).into_response()
}

async fn whatsapp_block_user(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let session_tenant = tenant_for_session(&state, &session_id).await.unwrap_or_default();
    if session_tenant != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }
    let (_, to_phone) = match whatsapp_channel_and_recipient_for_session(&state, &session_id).await
    {
        Ok(v) => v,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    };
    let raw = match whatsapp_block_users_request_for_session(
        &state,
        &session_id,
        reqwest::Method::POST,
        vec![to_phone.clone()],
    )
    .await
    {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("whatsapp block error {err}") })),
            )
                .into_response()
        }
    };
    let blocked = whatsapp_fetch_block_status_for_phone(&state, &session_id, &to_phone)
        .await
        .unwrap_or(true);
    let _ = add_message(
        state.clone(),
        &session_id,
        "system",
        &format!("{} blocked this WhatsApp contact", agent.name),
        None,
        None,
        None,
    )
    .await;
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "blocked": blocked, "raw": raw })),
    )
        .into_response()
}

async fn whatsapp_unblock_user(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let session_tenant = tenant_for_session(&state, &session_id).await.unwrap_or_default();
    if session_tenant != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }
    let (_, to_phone) = match whatsapp_channel_and_recipient_for_session(&state, &session_id).await
    {
        Ok(v) => v,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    };
    let raw = match whatsapp_block_users_request_for_session(
        &state,
        &session_id,
        reqwest::Method::DELETE,
        vec![to_phone.clone()],
    )
    .await
    {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("whatsapp unblock error {err}") })),
            )
                .into_response()
        }
    };
    let blocked = whatsapp_fetch_block_status_for_phone(&state, &session_id, &to_phone)
        .await
        .unwrap_or(false);
    let _ = add_message(
        state.clone(),
        &session_id,
        "system",
        &format!("{} unblocked this WhatsApp contact", agent.name),
        None,
        None,
        None,
    )
    .await;
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "blocked": blocked, "raw": raw })),
    )
        .into_response()
}

async fn persist_session(pool: &PgPool, session: &Session) {
    let _ = sqlx::query(
        r#"
        INSERT INTO sessions (
            id, tenant_id, created_at, updated_at, channel, assignee_agent_id, team_id, flow_id,
            handover_active, status, priority, contact_id, visitor_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            updated_at = EXCLUDED.updated_at,
            channel = EXCLUDED.channel,
            assignee_agent_id = EXCLUDED.assignee_agent_id,
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
        INSERT INTO chat_messages (id, session_id, sender, text, suggestions, widget, created_at, agent_id, agent_name, agent_avatar_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
    .bind(&message.agent_id)
    .bind(&message.agent_name)
    .bind(&message.agent_avatar_url)
    .execute(pool)
    .await;
}

async fn get_session_summary_db(pool: &PgPool, session_id: &str) -> Option<SessionSummary> {
    let session_row = sqlx::query(
        "SELECT s.id, s.tenant_id, s.created_at, s.updated_at, s.channel, s.assignee_agent_id, s.team_id, s.flow_id, s.handover_active, s.status, s.priority, s.contact_id, s.visitor_id, \
                c.display_name AS contact_name, c.email AS contact_email, c.phone AS contact_phone \
         FROM sessions s \
         LEFT JOIN contacts c ON c.id = s.contact_id \
         WHERE s.id = $1",
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
        "SELECT id, session_id, sender, text, suggestions, widget, created_at, agent_id, agent_name, agent_avatar_url FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
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
        agent_id: row.get("agent_id"),
        agent_name: row
            .get::<Option<String>, _>("agent_name")
            .unwrap_or_default(),
        agent_avatar_url: row
            .get::<Option<String>, _>("agent_avatar_url")
            .unwrap_or_default(),
    });

    let tag_rows = sqlx::query(
        "SELECT t.id, t.name, t.color \
         FROM tags t \
         INNER JOIN conversation_tags ct ON ct.tag_id = t.id \
         WHERE ct.session_id = $1 \
         ORDER BY t.name ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let tags = tag_rows
        .into_iter()
        .map(|row| SessionTagSummary {
            id: row.get("id"),
            name: row.get("name"),
            color: row.get("color"),
        })
        .collect::<Vec<_>>();

    Some(SessionSummary {
        tenant_id: session_row.get("tenant_id"),
        id: session_row.get("id"),
        created_at: session_row.get("created_at"),
        updated_at: session_row.get("updated_at"),
        last_message,
        message_count: count,
        channel: session_row.get("channel"),
        assignee_agent_id: session_row.get("assignee_agent_id"),
        team_id: session_row.get("team_id"),
        flow_id: session_row.get("flow_id"),
        contact_id: session_row.get("contact_id"),
        contact_name: session_row.get("contact_name"),
        contact_email: session_row.get("contact_email"),
        contact_phone: session_row.get("contact_phone"),
        tags,
        visitor_id: session_row
            .get::<Option<String>, _>("visitor_id")
            .unwrap_or_default(),
        handover_active: session_row.get("handover_active"),
        status: session_row.get("status"),
        priority: session_row.get("priority"),
    })
}

async fn get_session_messages_db(pool: &PgPool, session_id: &str) -> Vec<ChatMessage> {
    let rows = sqlx::query(
        "SELECT id, session_id, sender, text, suggestions, widget, created_at, agent_id, agent_name, agent_avatar_url FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC",
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
            agent_id: row.get("agent_id"),
            agent_name: row
                .get::<Option<String>, _>("agent_name")
                .unwrap_or_default(),
            agent_avatar_url: row
                .get::<Option<String>, _>("agent_avatar_url")
                .unwrap_or_default(),
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
        || lower.contains("conversation resolved")
        || lower.contains("resolved by agent")
        || lower.contains("reopened")
}

fn humanize_system_value(raw: &str) -> String {
    let cleaned = raw.trim().replace(['_', '-'], " ");
    if cleaned.is_empty() {
        return String::new();
    }
    cleaned
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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
        "SELECT a.id, a.name, a.email, a.status, a.role, a.avatar_url, a.team_ids FROM auth_tokens t JOIN agents a ON a.id = t.agent_id WHERE t.token = $1",
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
        role: row.get("role"),
        avatar_url: row.get("avatar_url"),
        team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
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
            .ok_or((
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "no tenant associated with token" })),
            ))?;

    Ok(tenant_id)
}

/// Resolve the tenant_id for a given session from the database.
async fn tenant_for_session(state: &Arc<AppState>, session_id: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT tenant_id FROM sessions WHERE id = $1")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
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

async fn agent_client_ids_for_agent(state: &Arc<AppState>, agent_id: &str) -> Vec<usize> {
    let rt = state.realtime.lock().await;
    rt.agent_profiles
        .iter()
        .filter_map(|(client_id, profile)| {
            if profile.id == agent_id {
                Some(*client_id)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

fn mention_handles_from_text(text: &str) -> Vec<String> {
    let Ok(regex) = Regex::new(r"@([a-zA-Z0-9._-]{1,64})") else {
        return Vec::new();
    };
    let mut handles = Vec::new();
    let mut seen = HashSet::new();
    for caps in regex.captures_iter(text) {
        let Some(matched) = caps.get(1) else {
            continue;
        };
        let handle = matched.as_str().trim().to_ascii_lowercase();
        if handle.is_empty() || seen.contains(&handle) {
            continue;
        }
        seen.insert(handle.clone());
        handles.push(handle);
    }
    handles
}

fn mention_keys_for_agent(name: &str, email: &str) -> Vec<String> {
    let mut keys = HashSet::new();
    let normalized_email = normalize_email(email);
    if !normalized_email.is_empty() {
        keys.insert(normalized_email.clone());
        if let Some(local) = normalized_email.split('@').next() {
            if !local.is_empty() {
                keys.insert(local.to_string());
            }
        }
    }

    let lower_name = name.trim().to_ascii_lowercase();
    if !lower_name.is_empty() {
        keys.insert(lower_name.clone());
        keys.insert(lower_name.replace(' ', ""));
        for part in lower_name.split_whitespace() {
            if !part.is_empty() {
                keys.insert(part.to_string());
            }
        }
    }
    keys.into_iter().collect::<Vec<_>>()
}

async fn resolve_mentioned_agent_ids(
    state: &Arc<AppState>,
    tenant_id: &str,
    text: &str,
) -> Vec<String> {
    let handles = mention_handles_from_text(text);
    if handles.is_empty() {
        return Vec::new();
    }
    let handle_set = handles.into_iter().collect::<HashSet<_>>();
    let rows = sqlx::query("SELECT id, name, email FROM agents WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let mut agent_ids = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let agent_id: String = row.get("id");
        let name: String = row.get("name");
        let email: String = row.get("email");
        let keys = mention_keys_for_agent(&name, &email);
        if keys.iter().any(|key| handle_set.contains(key)) && !seen.contains(&agent_id) {
            seen.insert(agent_id.clone());
            agent_ids.push(agent_id);
        }
    }
    agent_ids
}

async fn create_agent_notification(
    state: Arc<AppState>,
    tenant_id: &str,
    agent_id: &str,
    session_id: &str,
    message_id: Option<&str>,
    kind: &str,
    title: &str,
    body: &str,
) -> Option<AgentNotification> {
    let notification = AgentNotification {
        id: Uuid::new_v4().to_string(),
        tenant_id: tenant_id.to_string(),
        agent_id: agent_id.to_string(),
        session_id: session_id.to_string(),
        message_id: message_id.map(|value| value.to_string()),
        kind: kind.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        read_at: None,
        created_at: now_iso(),
    };
    let inserted = sqlx::query(
        "INSERT INTO agent_notifications (id, tenant_id, agent_id, session_id, message_id, kind, title, body, read_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&notification.id)
    .bind(&notification.tenant_id)
    .bind(&notification.agent_id)
    .bind(&notification.session_id)
    .bind(&notification.message_id)
    .bind(&notification.kind)
    .bind(&notification.title)
    .bind(&notification.body)
    .bind(&notification.read_at)
    .bind(&notification.created_at)
    .execute(&state.db)
    .await
    .is_ok();
    if !inserted {
        return None;
    }

    let unread_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agent_notifications WHERE agent_id = $1 AND read_at IS NULL",
    )
    .bind(agent_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    let payload = json!({
        "notification": notification,
        "unreadCount": unread_count
    });
    let targets = agent_client_ids_for_agent(&state, agent_id).await;
    emit_to_clients(&state, &targets, "notification:new", payload).await;
    Some(notification)
}

async fn dispatch_internal_note_mentions(
    state: Arc<AppState>,
    tenant_id: &str,
    session_id: &str,
    message: &ChatMessage,
    author: &AgentProfile,
) {
    if message.sender != "team" || message.text.trim().is_empty() {
        return;
    }
    let mentioned_ids = resolve_mentioned_agent_ids(&state, tenant_id, &message.text).await;
    if mentioned_ids.is_empty() {
        return;
    }
    let body = message.text.trim().to_string();
    for target_agent_id in mentioned_ids {
        if target_agent_id == author.id {
            continue;
        }
        let _ = create_agent_notification(
            state.clone(),
            tenant_id,
            &target_agent_id,
            session_id,
            Some(&message.id),
            "mention",
            &format!("{} mentioned you", author.name),
            &body,
        )
        .await;
    }
}

async fn agent_clients_for_tenant(state: &Arc<AppState>, tenant_id: &str) -> Vec<usize> {
    let rt = state.realtime.lock().await;
    rt.agent_tenant_by_client
        .iter()
        .filter_map(|(client_id, client_tenant_id)| {
            if client_tenant_id == tenant_id {
                Some(*client_id)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

async fn emit_session_snapshot(state: Arc<AppState>) {
    let tenant_to_clients = {
        let rt = state.realtime.lock().await;
        let mut map = HashMap::<String, Vec<usize>>::new();
        for (client_id, tenant_id) in &rt.agent_tenant_by_client {
            map.entry(tenant_id.clone()).or_default().push(*client_id);
        }
        map
    };

    for (tenant_id, clients) in tenant_to_clients {
        unsnooze_due_sessions_for_tenant(&state, &tenant_id).await;
        let mut list = {
            let rows = sqlx::query(
                "SELECT id FROM sessions WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 500",
            )
            .bind(&tenant_id)
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
        emit_to_clients(&state, &clients, "sessions:list", list).await;
    }
}

async fn emit_session_update(state: &Arc<AppState>, summary: SessionSummary) {
    let agents = agent_clients_for_tenant(state, &summary.tenant_id).await;
    emit_to_clients(state, &agents, "session:updated", summary).await;
}

async fn session_realtime_recipients(state: &Arc<AppState>, session_id: &str) -> Vec<usize> {
    let session_tenant_id = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    let tenant_agents = agent_clients_for_tenant(state, &session_tenant_id).await;
    let rt = state.realtime.lock().await;
    let mut recipients = HashSet::new();
    if let Some(watchers) = rt.session_watchers.get(session_id) {
        recipients.extend(watchers.iter().copied());
    }
    recipients.extend(tenant_agents);
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

    // Try to find who is typing (for human agent typing, show their name)
    let (agent_name, agent_avatar) = {
        let rt = state.realtime.lock().await;
        if let Some(typers) = rt.agent_human_typers.get(session_id) {
            if let Some(&cid) = typers.iter().next() {
                if let Some(profile) = rt.agent_profiles.get(&cid) {
                    (profile.name.clone(), profile.avatar_url.clone())
                } else {
                    (String::new(), String::new())
                }
            } else {
                (String::new(), String::new())
            }
        } else {
            (String::new(), String::new())
        }
    };

    emit_to_clients(
        state,
        &recipients,
        "typing",
        json!({
            "sessionId": session_id,
            "sender": "agent",
            "active": active,
            "agentName": agent_name,
            "agentAvatarUrl": agent_avatar
        }),
    )
    .await;
}

async fn emit_visitor_typing(state: &Arc<AppState>, session_id: &str, text: &str, active: bool) {
    let tenant_id = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    let recipients = agent_clients_for_tenant(state, &tenant_id).await;

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

    let tenant_id = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    if tenant_id.is_empty() {
        return;
    }

    // Store the visitor_id on the session
    let _ = sqlx::query("UPDATE sessions SET visitor_id = $1 WHERE id = $2")
        .bind(visitor_id)
        .bind(session_id)
        .execute(&state.db)
        .await;

    // Skip if session already has a valid same-tenant contact.
    // Self-heal old cross-tenant mislinks by clearing invalid contact_id.
    let existing: Option<Option<String>> =
        sqlx::query_scalar("SELECT contact_id FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    if let Some(Some(ref cid)) = existing {
        if !cid.is_empty() {
            let valid_for_tenant = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(1) FROM contacts WHERE id = $1 AND tenant_id = $2",
            )
            .bind(cid)
            .bind(&tenant_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
                > 0;
            if valid_for_tenant {
                return;
            }
            let _ = sqlx::query("UPDATE sessions SET contact_id = NULL WHERE id = $1")
                .bind(session_id)
                .execute(&state.db)
                .await;
        }
    }

    // Find the most recent other same-tenant session with this visitor_id that has a valid contact
    let mut resolved_contact_id: Option<String> = sqlx::query_scalar(
        "SELECT s.contact_id FROM sessions s \
         INNER JOIN contacts c ON c.id = s.contact_id AND c.tenant_id = $3 \
         WHERE s.tenant_id = $3 AND s.visitor_id = $1 AND s.id != $2 \
           AND s.contact_id IS NOT NULL AND s.contact_id != '' \
         ORDER BY s.updated_at DESC LIMIT 1",
    )
    .bind(visitor_id)
    .bind(session_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    // For WhatsApp visitors, also try to resolve by CRM phone/external_id.
    if resolved_contact_id.is_none() {
        if let Some(phone_digits) = whatsapp_phone_from_visitor_id(visitor_id) {
            resolved_contact_id = sqlx::query_scalar(
                "SELECT id FROM contacts \
                 WHERE tenant_id = $1 \
                   AND (external_id = $2 OR external_id = $3 OR regexp_replace(phone, '[^0-9]', '', 'g') = $3) \
                 ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(&tenant_id)
            .bind(visitor_id)
            .bind(&phone_digits)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            if resolved_contact_id.is_none() {
                let new_id = Uuid::new_v4().to_string();
                let now = now_iso();
                let _ = sqlx::query(
                    "INSERT INTO contacts \
                     (id, tenant_id, display_name, email, phone, external_id, metadata, created_at, updated_at, company, location, avatar_url, last_seen_at, browser, os) \
                     VALUES ($1,$2,'','',$3,$4,'{}',$5,$6,'','','',$7,'','')",
                )
                .bind(&new_id)
                .bind(&tenant_id)
                .bind(&phone_digits)
                .bind(visitor_id)
                .bind(&now)
                .bind(&now)
                .bind(&now)
                .execute(&state.db)
                .await;
                resolved_contact_id = Some(new_id);
            }
        }
    }

    if let Some(cid) = resolved_contact_id {
        let _ = sqlx::query("UPDATE sessions SET contact_id = $1 WHERE id = $2")
            .bind(&cid)
            .bind(session_id)
            .execute(&state.db)
            .await;

        let _ = sqlx::query(
            "UPDATE sessions SET contact_id = $1 \
             WHERE tenant_id = $3 AND visitor_id = $2 AND visitor_id != '' AND (contact_id IS NULL OR contact_id = '')",
        )
        .bind(&cid)
        .bind(visitor_id)
        .bind(&tenant_id)
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

async fn ensure_whatsapp_contact_for_visitor(
    state: &Arc<AppState>,
    tenant_id: &str,
    visitor_id: &str,
    from_phone_raw: &str,
    profile_name: &str,
    channel_id: &str,
) -> Option<String> {
    if tenant_id.trim().is_empty() || visitor_id.trim().is_empty() {
        return None;
    }
    let phone_digits = normalize_whatsapp_phone(from_phone_raw)
        .or_else(|| whatsapp_phone_from_visitor_id(visitor_id))
        .unwrap_or_default();
    if phone_digits.is_empty() {
        return None;
    }

    let existing = sqlx::query(
        "SELECT id, display_name, phone, external_id, metadata FROM contacts \
         WHERE tenant_id = $1 \
           AND (external_id = $2 OR external_id = $3 OR regexp_replace(phone, '[^0-9]', '', 'g') = $3) \
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(visitor_id)
    .bind(&phone_digits)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let now = now_iso();
    if let Some(row) = existing {
        let contact_id: String = row.get("id");
        let display_name: String = row.get("display_name");
        let phone: String = row.get("phone");
        let external_id: String = row.get("external_id");
        let metadata_raw: String = row.get("metadata");

        let merged_display_name = if display_name.trim().is_empty() && !profile_name.trim().is_empty()
        {
            profile_name.trim().to_string()
        } else {
            display_name
        };
        let merged_phone = if phone.trim().is_empty() {
            phone_digits.clone()
        } else {
            phone
        };
        let merged_external_id = if external_id.trim().is_empty() {
            visitor_id.to_string()
        } else {
            external_id
        };

        let mut metadata_value = parse_json_text(&metadata_raw);
        if !metadata_value.is_object() {
            metadata_value = json!({});
        }
        let mut wa_meta = metadata_value
            .get("whatsapp")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if !wa_meta.is_object() {
            wa_meta = json!({});
        }
        wa_meta["visitorId"] = Value::String(visitor_id.to_string());
        wa_meta["waId"] = Value::String(phone_digits.clone());
        wa_meta["channelId"] = Value::String(channel_id.to_string());
        if !profile_name.trim().is_empty() {
            wa_meta["profileName"] = Value::String(profile_name.trim().to_string());
        }
        metadata_value["whatsapp"] = wa_meta;

        let _ = sqlx::query(
            "UPDATE contacts SET display_name = $1, phone = $2, external_id = $3, metadata = $4, last_seen_at = $5, updated_at = $6 WHERE id = $7",
        )
        .bind(&merged_display_name)
        .bind(&merged_phone)
        .bind(&merged_external_id)
        .bind(metadata_value.to_string())
        .bind(&now)
        .bind(&now)
        .bind(&contact_id)
        .execute(&state.db)
        .await;
        return Some(contact_id);
    }

    let contact_id = Uuid::new_v4().to_string();
    let mut metadata = json!({
        "whatsapp": {
            "visitorId": visitor_id,
            "waId": phone_digits,
            "channelId": channel_id,
        }
    });
    if !profile_name.trim().is_empty() {
        metadata["whatsapp"]["profileName"] = Value::String(profile_name.trim().to_string());
    }
    let _ = sqlx::query(
        "INSERT INTO contacts \
         (id, tenant_id, display_name, email, phone, external_id, metadata, created_at, updated_at, company, location, avatar_url, last_seen_at, browser, os) \
         VALUES ($1,$2,$3,'',$4,$5,$6,$7,$8,'','','',$9,'','')",
    )
    .bind(&contact_id)
    .bind(tenant_id)
    .bind(profile_name.trim())
    .bind(metadata["whatsapp"]["waId"].as_str().unwrap_or_default())
    .bind(visitor_id)
    .bind(metadata.to_string())
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    Some(contact_id)
}

async fn ensure_session(state: Arc<AppState>, session_id: &str, tenant_id: &str) -> Session {
    let existing = sqlx::query(
        "SELECT id, tenant_id, created_at, updated_at, channel, assignee_agent_id, team_id, flow_id, handover_active, status, priority, contact_id, visitor_id FROM sessions WHERE id = $1",
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

        let default_flow_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM flows WHERE tenant_id = $1 AND enabled = true ORDER BY created_at ASC LIMIT 1",
        )
        .bind(tenant_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let session = Session {
            tenant_id: tenant_id.to_string(),
            id: session_id.to_string(),
            created_at: now.clone(),
            updated_at: now,
            messages: vec![],
            channel: "web".to_string(),
            assignee_agent_id: None,
            team_id: None,
            flow_id: default_flow_id,
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
    let old_row = sqlx::query(
        "SELECT tenant_id, status, visitor_id, contact_id FROM sessions WHERE id = $1 LIMIT 1",
    )
    .bind(requested_session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(old_row) = old_row else {
        return (requested_session_id.to_string(), false);
    };
    let old_tenant: String = old_row.get("tenant_id");
    let old_status: String = old_row.get("status");
    let old_visitor_id: String = old_row
        .get::<Option<String>, _>("visitor_id")
        .unwrap_or_default();
    let old_contact_id: Option<String> = old_row.get("contact_id");

    if old_status != "resolved" && old_status != "closed" {
        return (requested_session_id.to_string(), false);
    }

    let new_session_id = Uuid::new_v4().to_string();
    let _ = ensure_session(state.clone(), &new_session_id, &old_tenant).await;

    let valid_contact_id = if let Some(cid) = old_contact_id {
        let same_tenant = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM contacts WHERE id = $1 AND tenant_id = $2",
        )
        .bind(&cid)
        .bind(&old_tenant)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
            > 0;
        if same_tenant { Some(cid) } else { None }
    } else {
        None
    };

    let _ = sqlx::query(
        "UPDATE sessions SET visitor_id = $1, contact_id = $2, updated_at = $3 WHERE id = $4",
    )
    .bind(&old_visitor_id)
    .bind(&valid_contact_id)
    .bind(now_iso())
    .bind(&new_session_id)
    .execute(&state.db)
    .await;

    if valid_contact_id.is_none() && !old_visitor_id.is_empty() {
        resolve_contact_from_visitor_id(&state, &new_session_id, &old_visitor_id).await;
    }

    (new_session_id, true)
}

async fn add_message(
    state: Arc<AppState>,
    session_id: &str,
    sender: &str,
    text: &str,
    suggestions: Option<Vec<String>>,
    widget: Option<Value>,
    agent_profile: Option<&AgentProfile>,
) -> Option<ChatMessage> {
    let trimmed = text.trim();
    if trimmed.is_empty() && widget.is_none() {
        return None;
    }

    if sender == "visitor" {
        let snooze_row = sqlx::query(
            "SELECT status, COALESCE(snooze_mode, '') AS snooze_mode, COALESCE(snoozed_until, '') AS snoozed_until \
             FROM sessions WHERE id = $1 LIMIT 1",
        )
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        if let Some(row) = snooze_row {
            let status: String = row.get("status");
            let mode: String = row.get("snooze_mode");
            let snoozed_until_raw: String = row.get("snoozed_until");
            let now = Utc::now();
            let should_unsnooze = status == "snoozed"
                && (mode == "until_reply"
                    || (mode == "until_time"
                        && parse_snoozed_until_utc(&snoozed_until_raw)
                            .map(|ts| ts <= now)
                            .unwrap_or(false)));
            if should_unsnooze {
                let _ = unsnooze_session(&state, session_id).await;
            }
        }
    }

    let mut final_widget = widget;
    if sender == "agent" && final_widget.is_none() && !trimmed.is_empty() {
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
        agent_id: agent_profile.map(|p| p.id.clone()),
        agent_name: agent_profile.map(|p| p.name.clone()).unwrap_or_default(),
        agent_avatar_url: agent_profile
            .map(|p| p.avatar_url.clone())
            .unwrap_or_default(),
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

    let agents = agent_clients_for_tenant(&state, &summary.tenant_id).await;

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

    let is_whatsapp_session = summary.channel == "whatsapp";
    emit_to_clients(&state, &agents, "session:updated", summary).await;

    let already_delivered = message
        .widget
        .as_ref()
        .and_then(|w| w.get("alreadyDelivered"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if sender == "agent" && is_whatsapp_session && !already_delivered {
        let state_clone = state.clone();
        let session_id = session_id.to_string();
        let text = message.text.clone();
        let widget = message.widget.clone();
        let message_id = message.id.clone();
        tokio::spawn(async move {
            let tenant_id = tenant_for_session(&state_clone, &session_id)
                .await
                .unwrap_or_default();
            let agents = agent_clients_for_tenant(&state_clone, &tenant_id).await;
            match send_whatsapp_message_for_session(
                state_clone.clone(),
                session_id.clone(),
                text,
                widget,
            )
            .await
            {
                Ok(result) => {
                    emit_to_clients(
                        &state_clone,
                        &agents,
                        "whatsapp:send-result",
                        json!({
                            "ok": true,
                            "sessionId": session_id,
                            "messageId": message_id,
                            "result": result
                        }),
                    )
                    .await;
                }
                Err(result) => {
                    eprintln!("[whatsapp] outbound delivery failed: {result}");
                    let detail = result
                        .get("rawBody")
                        .and_then(Value::as_str)
                        .map(|text| {
                            let normalized = text
                                .replace('\n', " ")
                                .split_whitespace()
                                .collect::<Vec<_>>()
                                .join(" ");
                            if normalized.len() > 220 {
                                format!("{}...", &normalized[..220])
                            } else {
                                normalized
                            }
                        })
                        .unwrap_or_else(|| "Failed to deliver WhatsApp message".to_string());

                    emit_to_clients(
                        &state_clone,
                        &agents,
                        "whatsapp:send-result",
                        json!({
                            "ok": false,
                            "sessionId": session_id,
                            "messageId": message_id,
                            "result": result
                        }),
                    )
                    .await;
                    emit_to_clients(
                        &state_clone,
                        &agents,
                        "whatsapp:send-error",
                        json!({
                            "sessionId": session_id,
                            "messageId": message_id,
                            "error": detail
                        }),
                    )
                    .await;
                }
            };
        });
    }

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
        "conversation_closed" => trigger_event == "conversation_closed",
        "conversation_reopened" => trigger_event == "conversation_reopened",
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

async fn bot_enabled_for_session(state: &Arc<AppState>, session_id: &str) -> bool {
    let tenant_id = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    if tenant_id.is_empty() {
        return true;
    }

    let row = sqlx::query(
        "SELECT bot_enabled_by_default FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(row) = row {
        let enabled = row.get::<bool, _>("bot_enabled_by_default");
        return enabled;
    }

    true
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
    let _ = sqlx::query(
        "UPDATE sessions \
         SET status = $1, \
             snooze_mode = CASE WHEN $1 = 'snoozed' THEN snooze_mode ELSE NULL END, \
             snoozed_until = CASE WHEN $1 = 'snoozed' THEN snoozed_until ELSE NULL END, \
             updated_at = $2 \
         WHERE id = $3",
    )
        .bind(&normalized)
        .bind(now_iso())
        .bind(session_id)
        .execute(&state.db)
        .await;
    let summary = get_session_summary_db(&state.db, session_id).await?;
    Some((summary, changed))
}

fn normalize_snooze_mode(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "until_reply" | "until_time" => Some(normalized),
        _ => None,
    }
}

fn parse_snoozed_until_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

async fn unsnooze_session(
    state: &Arc<AppState>,
    session_id: &str,
) -> Option<SessionSummary> {
    let now = now_iso();
    let _ = sqlx::query(
        "UPDATE sessions \
         SET status = 'open', snooze_mode = NULL, snoozed_until = NULL, updated_at = $1 \
         WHERE id = $2 AND status = 'snoozed'",
    )
    .bind(&now)
    .bind(session_id)
    .execute(&state.db)
    .await;

    let summary = get_session_summary_db(&state.db, session_id).await?;
    emit_session_update(state, summary.clone()).await;
    Some(summary)
}

async fn unsnooze_due_sessions_for_tenant(state: &Arc<AppState>, tenant_id: &str) {
    let rows = sqlx::query(
        "SELECT id FROM sessions \
         WHERE tenant_id = $1 \
           AND status = 'snoozed' \
           AND snooze_mode = 'until_time' \
           AND COALESCE(snoozed_until, '') <> ''",
    )
    .bind(tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let now = Utc::now();
    for row in rows {
        let session_id: String = row.get("id");
        let snoozed_until_raw = sqlx::query_scalar::<_, Option<String>>(
            "SELECT snoozed_until FROM sessions WHERE id = $1",
        )
        .bind(&session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or_default();
        let due = parse_snoozed_until_utc(&snoozed_until_raw)
            .map(|ts| ts <= now)
            .unwrap_or(false);
        if due {
            if unsnooze_session(state, &session_id).await.is_some() {
                let _ = add_message(
                    state.clone(),
                    &session_id,
                    "system",
                    "Snooze expired",
                    None,
                    None,
                    None,
                )
                .await;
            }
        }
    }
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

async fn openai_chat_completion_text(
    state: &Arc<AppState>,
    model: &str,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err("OPENAI_API_KEY not configured".to_string());
    }
    let response = state
        .ai_client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
            "temperature": 0.1
        }))
        .send()
        .await
        .map_err(|err| format!("openai request failed: {err}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("openai returned {status}: {body}"));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|err| format!("openai parse failed: {err}"))?;
    let text = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return Err("openai response had empty content".to_string());
    }
    Ok(text)
}

async fn generate_ai_reply(
    state: Arc<AppState>,
    session_id: &str,
    prompt: &str,
    visitor_text: &str,
) -> AiDecision {
    let transcript = recent_session_context(&state, session_id, 14).await;

    // Fetch tenant_id for this session
    let tenant_id: String = tenant_for_session(&state, session_id)
        .await
        .unwrap_or_default();
    let workspace_meta = sqlx::query(
        "SELECT t.name AS workspace_name, \
                COALESCE(ts.bot_name, '') AS bot_name, \
                COALESCE(ts.bot_personality, '') AS bot_personality \
         FROM tenants t \
         LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id \
         WHERE t.id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let workspace_name = workspace_meta
        .as_ref()
        .map(|row| row.get::<String, _>("workspace_name"))
        .unwrap_or_default();
    let bot_name = workspace_meta
        .as_ref()
        .map(|row| row.get::<String, _>("bot_name"))
        .unwrap_or_default();
    let workspace_personality = workspace_meta
        .as_ref()
        .map(|row| row.get::<String, _>("bot_personality"))
        .unwrap_or_default();

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
            "SELECT display_name, email, phone, company, location FROM contacts WHERE id = $1 AND tenant_id = $2",
        )
        .bind(cid)
        .bind(&tenant_id)
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

            // Include custom attributes only when contact is tenant-valid.
            let custom_attrs = sqlx::query(
                "SELECT attribute_key, attribute_value FROM contact_custom_attributes \
                 WHERE contact_id = $1 \
                   AND EXISTS (SELECT 1 FROM contacts WHERE id = $1 AND tenant_id = $2)",
            )
            .bind(cid)
            .bind(&tenant_id)
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
        let mut tools_list = String::new();
        for row in &tool_flows {
            let flow_id: String = row.get("id");
            let flow_name: String = row.get("name");
            let description: String = row.get("ai_tool_description");
            let input_vars_raw: String = row.get("input_variables");
            let input_vars: Vec<FlowInputVariable> =
                serde_json::from_str(&input_vars_raw).unwrap_or_default();

            tools_list.push_str(&format!(
                "- Tool \"{}\" (flowId: \"{}\")",
                flow_name, flow_id
            ));
            if !description.is_empty() {
                tools_list.push_str(&format!(": {}", description));
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
                tools_list.push_str(&format!(" | parameters: [{}]", params.join(", ")));
            }
            tools_list.push('\n');
        }
        tools_block = render_tools_block(&ToolsBlockContext {
            tools_list: &tools_list,
        });
    }

    let system_instruction = render_system_prompt(&SystemPromptContext {
        workspace_name: &workspace_name,
        bot_name: &bot_name,
        workspace_personality: &workspace_personality,
        flow_prompt: prompt.trim(),
        tools_block: &tools_block,
    });
    let kb_context = kb_context_for_ai(&state, &tenant_id, visitor_text.trim()).await;
    let grounding_policy = render_ai_grounding_policy();

    if std::env::var("OPENAI_API_KEY")
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
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

    let json_format_hint = render_ai_json_format_hint(!tool_flows.is_empty());

    let kb_block = render_kb_block(&KbBlockContext {
        kb_context: &kb_context,
    });
    let system_instruction = format!("{system_instruction}\n\n{grounding_policy}");

    let user_content = render_ai_user_content(&AiUserContentContext {
        contact_block: &contact_block,
        kb_block: &kb_block,
        transcript: &transcript,
        visitor_text: visitor_text.trim(),
        json_format_hint: &json_format_hint,
    });

    let chat_model = std::env::var("OPENAI_CHAT_MODEL").unwrap_or_else(|_| "gpt-4.1".to_string());
    let raw_text = openai_chat_completion_text(
        &state,
        &chat_model,
        &system_instruction,
        &user_content,
    )
    .await;

    let Ok(raw_text) = raw_text else {
        return AiDecision {
            reply: "I had a temporary issue generating an AI reply. Could you rephrase?"
                .to_string(),
            handover: has_handover_intent(visitor_text),
            close_chat: false,
            suggestions: vec![],
            trigger_flow: None,
        };
    };

    if let Some(parsed) = parse_ai_decision_from_text(&raw_text) {
        return parsed;
    }
    // If model didn't follow JSON format, use plain text and keep heuristic handover.
    AiDecision {
        reply: raw_text,
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
    if std::env::var("OPENAI_API_KEY")
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        eprintln!("[extract_vars] OPENAI_API_KEY missing");
        return HashMap::new();
    }

    // Include a large conversation window so the AI can see the full collection dialogue
    let transcript = recent_session_context(state, session_id, 20).await;
    let tenant_id = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();

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
            "SELECT display_name, email, phone, company, location FROM contacts WHERE id = $1 AND tenant_id = $2",
        )
        .bind(cid)
        .bind(&tenant_id)
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

    let var_list_text = var_list.join(", ");
    let prompt = render_extract_vars_user_prompt(&ExtractVarsUserContext {
        contact_block: &contact_block,
        transcript: &transcript,
        visitor_text,
        var_list: &var_list_text,
    });

    eprintln!("[extract_vars] Extracting vars: {:?}", var_descriptions);
    eprintln!("[extract_vars] Contact: {}", contact_block);
    eprintln!("[extract_vars] Visitor text: {}", visitor_text);

    let extraction_model =
        std::env::var("OPENAI_EXTRACTION_MODEL").unwrap_or_else(|_| "gpt-4.1".to_string());
    let raw_text = openai_chat_completion_text(
        state,
        &extraction_model,
        &render_extract_vars_system_prompt(),
        &prompt,
    )
    .await;

    let Ok(raw_text) = raw_text else {
        eprintln!("[extract_vars] OpenAI request failed");
        return HashMap::new();
    };

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

    // Look up bot profile from tenant settings so flow/AI messages carry bot identity
    let sess_tenant = tenant_for_session(&state, session_id)
        .await
        .unwrap_or_default();
    let bot_profile = sqlx::query_as::<_, (String, String)>(
        "SELECT bot_name, bot_avatar_url FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&sess_tenant)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .and_then(|(name, avatar)| {
        if name.is_empty() && avatar.is_empty() {
            None
        } else {
            Some(AgentProfile {
                id: "__bot__".to_string(),
                name,
                email: String::new(),
                status: String::new(),
                role: String::new(),
                avatar_url: avatar,
                team_ids: vec![],
            })
        }
    });

    let _ = add_message(
        state.clone(),
        session_id,
        "agent",
        text,
        suggestions,
        widget,
        bot_profile.as_ref(),
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
    let sess_tenant = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    let _ = sqlx::query(
        "INSERT INTO flow_cursors (tenant_id, session_id, flow_id, node_id, node_type, variables, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET flow_id = $3, node_id = $4, node_type = $5, variables = $6, created_at = $7",
    )
    .bind(&sess_tenant)
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
    let sess_tenant = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    let _ = sqlx::query("DELETE FROM flow_cursors WHERE tenant_id = $1 AND session_id = $2")
        .bind(&sess_tenant)
        .bind(session_id)
        .execute(&state.db)
        .await;
}

/// Check if a cursor exists. Returns (flow_id, node_id, node_type, variables).
async fn get_flow_cursor(
    state: &Arc<AppState>,
    session_id: &str,
) -> Option<(String, String, String, HashMap<String, String>)> {
    let sess_tenant = tenant_for_session(state, session_id)
        .await
        .unwrap_or_default();
    let row = sqlx::query(
        "SELECT flow_id, node_id, node_type, variables FROM flow_cursors WHERE tenant_id = $1 AND session_id = $2",
    )
    .bind(&sess_tenant)
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
        "UPDATE sessions SET contact_id = $1 \
         WHERE tenant_id = $3 \
           AND visitor_id = (SELECT visitor_id FROM sessions WHERE id = $2) \
           AND visitor_id != '' \
           AND contact_id IS NULL",
    )
    .bind(&contact_id)
    .bind(session_id)
    .bind(&tenant_id)
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
                // If the matched button has no outgoing edge, stop the flow (don't fall through)
                return edge.map(|e| e.target.clone());
            }
            // No button matched the visitor text — don't proceed along any edge
            None
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
                // If the matched option has no outgoing edge, stop the flow (don't fall through)
                return edge.map(|e| e.target.clone());
            }
            // No option matched — don't proceed along any edge
            None
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
                    set_session_status(&state, &session_id, "resolved").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation resolved by bot",
                            None,
                            None,
                            None,
                        )
                        .await;
                        // Fire lifecycle trigger (e.g. CSAT on close)
                        Box::pin(run_lifecycle_trigger(
                            state.clone(),
                            session_id.clone(),
                            "conversation_closed".into(),
                        ))
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
        // If resuming and no match (e.g. visitor typed text instead of clicking button),
        // keep cursor alive so the interactive node stays active
        if resume_from_node.is_none() {
            clear_flow_cursor(&state, &session_id).await;
        }
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
                        set_session_status(&state, &session_id, "resolved").await
                    {
                        emit_session_update(&state, summary).await;
                        if changed {
                            let _ = add_message(
                                state.clone(),
                                &session_id,
                                "system",
                                "Conversation resolved by bot",
                                None,
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
                            set_session_status(&state, &session_id, "resolved").await
                        {
                            emit_session_update(&state, summary).await;
                            if changed {
                                let _ = add_message(
                                    state.clone(),
                                    &session_id,
                                    "system",
                                    "Conversation resolved by bot",
                                    None,
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
                    let rating_type = node
                        .data
                        .get("csatRatingType")
                        .and_then(Value::as_str)
                        .unwrap_or("emoji");
                    let widget = Some(serde_json::json!({
                        "type": "csat",
                        "question": csat_text,
                        "ratingType": rating_type,
                        "disableComposer": true
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
                    set_session_status(&state, &session_id, "resolved").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation resolved by bot",
                            None,
                            None,
                            None,
                        )
                        .await;
                        // Fire lifecycle trigger (e.g. CSAT on close)
                        Box::pin(run_lifecycle_trigger(
                            state.clone(),
                            session_id.clone(),
                            "conversation_closed".into(),
                        ))
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
                let rating_type = node
                    .data
                    .get("ratingType")
                    .and_then(Value::as_str)
                    .unwrap_or("emoji");
                let widget = Some(serde_json::json!({
                    "type": "csat",
                    "question": text,
                    "ratingType": rating_type,
                    "disableComposer": true
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
                    let sess_tenant = tenant_for_session(&state, &session_id)
                        .await
                        .unwrap_or_default();

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
                    let _ = add_message(
                        state.clone(),
                        &session_id,
                        "system",
                        &note,
                        None,
                        None,
                        None,
                    )
                    .await;
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
                    let _ = add_message(
                        state.clone(),
                        &session_id,
                        "system",
                        &note,
                        None,
                        None,
                        None,
                    )
                    .await;
                }
            }
            "note" => {
                let text = flow_node_data_text(&node, "text").unwrap_or_default();
                if !text.is_empty() {
                    // Persist as a real conversation note
                    let note_id = Uuid::new_v4().to_string();
                    let sess_tenant = tenant_for_session(&state, &session_id)
                        .await
                        .unwrap_or_default();
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
                        add_message(state.clone(), &session_id, "note", &text, None, None, None)
                            .await;
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

    if !bot_enabled_for_session(&state, &session_id).await {
        return;
    }

    // ── Check for existing flow cursor (resume interactive node) ──
    if trigger_event == "visitor_message" {
        if let Some((cursor_flow_id, cursor_node_id, _cursor_node_type, cursor_vars)) =
            get_flow_cursor(&state, &session_id).await
        {
            // We have a paused flow — resume it from the paused node
            if let Some(flow) = get_flow_by_id_db(&state.db, &cursor_flow_id).await {
                let cursor_node_type = _cursor_node_type.clone();
                let cursor_node_id_copy = cursor_node_id.clone();
                execute_flow_from(
                    state.clone(),
                    session_id.clone(),
                    flow,
                    visitor_text.clone(),
                    Some(cursor_node_id),
                    cursor_vars,
                )
                .await;
                // Only fall through to AI if cursor is still on the SAME buttons/select node
                // (meaning the visitor's text didn't match any option). If cursor moved to a
                // different node (e.g. start_flow saving a new pause), the click was handled.
                let still_on_same_node = if let Some((_, post_node_id, _, _)) =
                    get_flow_cursor(&state, &session_id).await
                {
                    post_node_id == cursor_node_id_copy
                } else {
                    false
                };
                if (cursor_node_type == "buttons" || cursor_node_type == "select")
                    && still_on_same_node
                {
                    // Don't consume the message — let AI handle it below
                } else {
                    return;
                }
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
        // Scope flow lookup to the session's tenant
        let sess_tenant = tenant_for_session(&state, &session_id)
            .await
            .unwrap_or_default();
        let row = sqlx::query(
            "SELECT id FROM flows WHERE tenant_id = $1 AND enabled = true ORDER BY created_at ASC LIMIT 1",
        )
        .bind(&sess_tenant)
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
                .unwrap_or_else(render_flow_ai_fallback_prompt);

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
                            None,
                        )
                        .await;
                    }
                }
            }
            if decision.close_chat {
                if let Some((summary, changed)) =
                    set_session_status(&state, &session_id, "resolved").await
                {
                    emit_session_update(&state, summary).await;
                    if changed {
                        let _ = add_message(
                            state.clone(),
                            &session_id,
                            "system",
                            "Conversation resolved by bot",
                            None,
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

    if trigger_event == "visitor_message" {
        let decision = generate_ai_reply(state.clone(), &session_id, "", &visitor_text).await;
        let suggestions_opt = if decision.suggestions.is_empty() {
            None
        } else {
            Some(decision.suggestions.clone())
        };
        send_flow_agent_message(
            state.clone(),
            &session_id,
            &decision.reply,
            650,
            suggestions_opt,
            None,
        )
        .await;
        if decision.handover {
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
                        None,
                    )
                    .await;
                }
            }
        }
        if decision.close_chat {
            if let Some((summary, changed)) = set_session_status(&state, &session_id, "resolved").await {
                emit_session_update(&state, summary).await;
                if changed {
                    let _ = add_message(
                        state.clone(),
                        &session_id,
                        "system",
                        "Conversation resolved by bot",
                        None,
                        None,
                        None,
                    )
                    .await;
                }
            }
        }
    }
}

/// Fire lifecycle flow triggers (conversation_closed, conversation_reopened, etc.)
/// Unlike visitor-message triggers, these skip handover checks and cursor resume.
async fn run_lifecycle_trigger(state: Arc<AppState>, session_id: String, trigger_event: String) {
    // Find all enabled flows
    let rows = sqlx::query("SELECT id FROM flows WHERE enabled = true")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    for row in rows {
        let flow_id: String = row.get("id");
        if let Some(flow) = get_flow_by_id_db(&state.db, &flow_id).await {
            if flow_trigger_matches_event(&flow, "", &trigger_event, false) {
                execute_flow(state.clone(), session_id.clone(), flow, String::new()).await;
                return;
            }
        }
    }
}

async fn post_session(
    State(state): State<Arc<AppState>>,
    body: Option<Json<Value>>,
) -> impl IntoResponse {
    let tenant_id = body
        .as_ref()
        .and_then(|b| b.get("tenantId"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if tenant_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tenantId is required" })),
        )
            .into_response();
    }

    // Validate tenant exists
    let tenant_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
        > 0;
    if !tenant_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tenant not found" })),
        )
            .into_response();
    }

    let session_id = Uuid::new_v4().to_string();
    let _ = ensure_session(state.clone(), &session_id, tenant_id).await;

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
        .into_response()
}

async fn get_sessions(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(tid) => tid,
        Err(err) => return err.into_response(),
    };

    unsnooze_due_sessions_for_tenant(&state, &tenant_id).await;

    let rows = if agent.role == "owner" || agent.role == "admin" {
        sqlx::query("SELECT id FROM sessions WHERE tenant_id = $1 ORDER BY updated_at DESC")
            .bind(&tenant_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
    } else {
        sqlx::query("SELECT id FROM sessions WHERE tenant_id = $1 ORDER BY updated_at DESC")
            .bind(&tenant_id)
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
    Json(json!({ "sessions": list })).into_response()
}

async fn get_messages(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
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

    let Some(message) = add_message(
        state.clone(),
        &target_session_id,
        sender,
        &body.text,
        None,
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

async fn list_whatsapp_templates(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let _agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let session_tenant_id = tenant_for_session(&state, &session_id)
        .await
        .unwrap_or_default();
    if session_tenant_id.is_empty() || session_tenant_id != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }

    let (channel, _to_phone) =
        match whatsapp_channel_and_recipient_for_session(&state, &session_id).await {
            Ok(v) => v,
            Err(err) => {
                return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
            }
        };
    let access_token = config_text(&channel.config, "accessToken");
    let business_account_id = config_text(&channel.config, "businessAccountId");
    if access_token.is_empty() || business_account_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing whatsapp accessToken or businessAccountId" })),
        )
            .into_response();
    }

    let raw_templates =
        match fetch_whatsapp_templates_from_meta(&state, &access_token, &business_account_id).await
        {
            Ok(v) => v,
            Err(err) => {
                return (StatusCode::BAD_GATEWAY, Json(json!({ "error": err }))).into_response();
            }
        };
    let templates = raw_templates
        .into_iter()
        .map(|item| {
            let components = item
                .get("components")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let body_preview = whatsapp_template_body_preview(&components);
            let max_param_idx = whatsapp_template_param_count(&components);
            json!({
                "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
                "status": item.get("status").and_then(Value::as_str).unwrap_or(""),
                "category": item.get("category").and_then(Value::as_str).unwrap_or(""),
                "language": item.get("language").and_then(Value::as_str).unwrap_or(""),
                "bodyPreview": body_preview,
                "paramCount": max_param_idx
            })
        })
        .collect::<Vec<_>>();

    (StatusCode::OK, Json(json!({ "templates": templates }))).into_response()
}

async fn send_whatsapp_template(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SendWhatsappTemplateBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let session_tenant_id = tenant_for_session(&state, &session_id)
        .await
        .unwrap_or_default();
    if session_tenant_id.is_empty() || session_tenant_id != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }

    let template_name = body.template_name.trim().to_string();
    if template_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "template_name required" })),
        )
            .into_response();
    }
    let language_code = body
        .language_code
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("en_US")
        .to_string();

    let (channel, to_phone) =
        match whatsapp_channel_and_recipient_for_session(&state, &session_id).await {
            Ok(v) => v,
            Err(err) => {
                return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
            }
        };
    let access_token = config_text(&channel.config, "accessToken");
    let phone_number_id = config_text(&channel.config, "phoneNumberId");
    if access_token.is_empty() || phone_number_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing whatsapp accessToken or phoneNumberId" })),
        )
            .into_response();
    }

    let params = body.parameters.clone().unwrap_or_default();
    let raw_templates = fetch_whatsapp_templates_from_meta(
        &state,
        &access_token,
        &config_text(&channel.config, "businessAccountId"),
    )
    .await
    .unwrap_or_default();
    let selected_components = raw_templates
        .iter()
        .find(|item| {
            let name = item.get("name").and_then(Value::as_str).unwrap_or("");
            let lang = item.get("language").and_then(Value::as_str).unwrap_or("");
            name == template_name && (lang.is_empty() || lang == language_code)
        })
        .and_then(|item| item.get("components").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let mut template_payload = json!({
        "name": template_name,
        "language": { "code": language_code }
    });
    let components_payload = whatsapp_template_components_payload(&selected_components, &params);
    if !components_payload.is_empty() {
        template_payload["components"] = Value::Array(components_payload);
    }

    let response = match state
        .ai_client
        .post(format!(
            "https://graph.facebook.com/v21.0/{}/messages",
            phone_number_id
        ))
        .bearer_auth(&access_token)
        .json(&json!({
            "messaging_product": "whatsapp",
            "to": to_phone,
            "type": "template",
            "template": template_payload
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("failed to send whatsapp template: {e}") })),
            )
                .into_response();
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("whatsapp template send error {status}: {body}") })),
        )
            .into_response();
    }
    let rendered = render_whatsapp_template_text(
        &selected_components,
        &params,
        &format!("Template: {}", body.template_name.trim()),
    );
    let _ = add_message(
        state.clone(),
        &session_id,
        "agent",
        &rendered,
        None,
        Some(json!({
            "type": "whatsapp_template",
            "name": body.template_name,
            "languageCode": body.language_code.unwrap_or_else(|| "en_US".to_string()),
            "parameters": body.parameters.unwrap_or_default(),
            "alreadyDelivered": true
        })),
        Some(&agent),
    )
    .await;

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn close_session_by_visitor(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let Some((summary, changed)) = set_session_status(&state, &session_id, "resolved").await else {
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
            None,
        )
        .await;

        // Fire lifecycle trigger
        let st = state.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            run_lifecycle_trigger(st, sid, "conversation_closed".into()).await;
        });
    }

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn register_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> impl IntoResponse {
    let email = normalize_email(&body.email);
    let full_name = body.name.trim().to_string();
    if email.is_empty() || full_name.is_empty() || body.password.trim().len() < 6 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid registration payload" })),
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
                .into_response();
        }
    };

    let user_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
        > 0;
    if user_exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "email already registered" })),
        )
            .into_response();
    }

    let user_id = Uuid::new_v4().to_string();
    let now = now_iso();
    if sqlx::query(
        "INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&full_name)
    .bind(&now)
    .bind(&now)
    .bind("")
    .execute(&state.db)
    .await
    .is_err()
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create user" })),
        )
            .into_response();
    }

    if let Some(invitation_token) = body.invitation_token {
        let inv_row = sqlx::query(
            "SELECT tenant_id, role, status, email FROM tenant_invitations WHERE token = $1",
        )
        .bind(&invitation_token)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
        let Some(inv) = inv_row else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid invitation token" })),
            )
                .into_response();
        };
        let status: String = inv.get("status");
        let invited_email: String = inv.get("email");
        if status != "pending" {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invitation already used" })),
            )
                .into_response();
        }
        if normalize_email(&invited_email) != email {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invitation email mismatch" })),
            )
                .into_response();
        }
        let tenant_id: String = inv.get("tenant_id");
        let role: String = inv.get("role");
        let agent_id = Uuid::new_v4().to_string();
        let _ = sqlx::query(
            "INSERT INTO agents (id, user_id, tenant_id, name, email, status, password_hash, role, avatar_url, team_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&agent_id)
        .bind(&user_id)
        .bind(&tenant_id)
        .bind(&full_name)
        .bind(&email)
        .bind("online")
        .bind(&password_hash)
        .bind(&role)
        .bind("")
        .bind("[]")
        .execute(&state.db)
        .await;

        let _ = sqlx::query("UPDATE tenant_invitations SET status = 'accepted' WHERE token = $1")
            .bind(&invitation_token)
            .execute(&state.db)
            .await;

        let Some((token, profile)) = issue_workspace_token(&state, &user_id, &tenant_id).await
        else {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to create auth token" })),
            )
                .into_response();
        };
        let workspaces = list_user_workspaces(&state, &user_id).await;
        let active_workspace = workspaces
            .iter()
            .find(|w| w.id == tenant_id)
            .cloned()
            .unwrap_or(WorkspaceSummary {
                id: tenant_id.clone(),
                name: "".to_string(),
                slug: "".to_string(),
                workspace_username: "".to_string(),
                role: role.clone(),
            });
        return (
            StatusCode::CREATED,
            Json(json!({
                "token": token,
                "agent": profile,
                "tenantId": tenant_id,
                "activeWorkspace": active_workspace,
                "workspaces": workspaces
            })),
        )
            .into_response();
    }

    let ws_name = body
        .workspace_name
        .as_deref()
        .unwrap_or("My Workspace")
        .trim()
        .to_string();
    let ws_name = if ws_name.is_empty() {
        "My Workspace".to_string()
    } else {
        ws_name
    };
    let workspace_username = match validate_workspace_username(&slugify(&ws_name)) {
        Ok(v) => v,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
        }
    };

    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE workspace_username = $1")
            .bind(&workspace_username)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
            > 0;
    if exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "workspace_username_taken" })),
        )
            .into_response();
    }

    let tenant_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let slug = slugify(&ws_name);
    let _ = sqlx::query(
        "INSERT INTO tenants (id, name, slug, workspace_username, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&tenant_id)
    .bind(&ws_name)
    .bind(&slug)
    .bind(&workspace_username)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO tenant_settings (tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    )
    .bind(&tenant_id)
    .bind(&ws_name)
    .bind("")
    .bind("")
    .bind("#e4b84f")
    .bind("#1f2230")
    .bind("")
    .bind("#")
    .bind("bottom-right")
    .bind("Hello! How can we help?")
    .bind("")
    .bind("")
    .bind(true)
    .bind("")
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO agents (id, user_id, tenant_id, name, email, status, password_hash, role, avatar_url, team_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&tenant_id)
    .bind(&full_name)
    .bind(&email)
    .bind("online")
    .bind(&password_hash)
    .bind("owner")
    .bind("")
    .bind("[]")
    .execute(&state.db)
    .await;

    let Some((token, profile)) = issue_workspace_token(&state, &user_id, &tenant_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user_id).await;
    let active_workspace = workspaces
        .iter()
        .find(|w| w.id == tenant_id)
        .cloned()
        .unwrap_or(WorkspaceSummary {
            id: tenant_id.clone(),
            name: ws_name.clone(),
            slug,
            workspace_username,
            role: "owner".to_string(),
        });
    (
        StatusCode::CREATED,
        Json(json!({
            "token": token,
            "agent": profile,
            "tenantId": tenant_id,
            "activeWorkspace": active_workspace,
            "workspaces": workspaces
        })),
    )
        .into_response()
}

async fn signup_user(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupBody>,
) -> impl IntoResponse {
    let email = normalize_email(&body.email);
    let full_name = body.full_name.trim().to_string();
    if email.is_empty() || full_name.is_empty() || body.password.trim().len() < 6 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid signup payload" })),
        )
            .into_response();
    }
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM users WHERE email = $1")
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
                .into_response();
        }
    };
    let user_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let inserted = sqlx::query(
        "INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&full_name)
    .bind(&now)
    .bind(&now)
    .bind("")
    .execute(&state.db)
    .await
    .is_ok();
    if !inserted {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create user" })),
        )
            .into_response();
    }
    let Some(login_ticket) = issue_login_ticket(&state, &user_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create login ticket" })),
        )
            .into_response();
    };
    (
        StatusCode::CREATED,
        Json(json!({
            "userId": user_id,
            "loginTicket": login_ticket,
            "workspaces": []
        })),
    )
        .into_response()
}

async fn login_agent(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let email = normalize_email(&body.email);
    let row = sqlx::query("SELECT id, email, password_hash, full_name FROM users WHERE email = $1")
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
    let user_id: String = row.get("id");
    let password_hash: String = row.get("password_hash");

    let valid = verify(body.password, &password_hash).unwrap_or(false);
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid credentials" })),
        )
            .into_response();
    }

    let _ = sqlx::query("UPDATE users SET last_login_at = $1 WHERE id = $2")
        .bind(now_iso())
        .bind(&user_id)
        .execute(&state.db)
        .await;

    let workspaces = list_user_workspaces(&state, &user_id).await;
    if workspaces.len() == 1 {
        let workspace = workspaces[0].clone();
        let Some((token, profile)) = issue_workspace_token(&state, &user_id, &workspace.id).await
        else {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to create auth token" })),
            )
                .into_response();
        };
        return (
            StatusCode::OK,
            Json(json!({
                "token": token,
                "agent": profile,
                "tenantId": workspace.id,
                "activeWorkspace": workspace,
                "workspaces": workspaces
            })),
        )
            .into_response();
    }

    let Some(login_ticket) = issue_login_ticket(&state, &user_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create login ticket" })),
        )
            .into_response();
    };
    (
        StatusCode::OK,
        Json(json!({
            "workspaceSelectionRequired": true,
            "loginTicket": login_ticket,
            "workspaces": workspaces
        })),
    )
        .into_response()
}

async fn select_workspace(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SelectWorkspaceBody>,
) -> impl IntoResponse {
    let ticket = body.login_ticket.trim().to_string();
    let workspace_username = normalize_workspace_username(&body.workspace_username);
    if ticket.is_empty() || workspace_username.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "login_ticket and workspace_username are required" })),
        )
            .into_response();
    }
    let Some(user_id) = consume_login_ticket(&state, &ticket).await else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid or expired login ticket" })),
        )
            .into_response();
    };
    let tenant_row = sqlx::query(
        "SELECT t.id, t.name, t.slug, t.workspace_username, a.role \
         FROM agents a JOIN tenants t ON t.id = a.tenant_id \
         WHERE a.user_id = $1 AND t.workspace_username = $2 LIMIT 1",
    )
    .bind(&user_id)
    .bind(&workspace_username)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(tenant_row) = tenant_row else {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "workspace not accessible" })),
        )
            .into_response();
    };
    let tenant_id: String = tenant_row.get("id");
    let workspace = WorkspaceSummary {
        id: tenant_id.clone(),
        name: tenant_row.get("name"),
        slug: tenant_row.get("slug"),
        workspace_username: tenant_row.get("workspace_username"),
        role: tenant_row.get("role"),
    };
    let Some((token, profile)) = issue_workspace_token(&state, &user_id, &tenant_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user_id).await;
    (
        StatusCode::OK,
        Json(json!({
            "token": token,
            "agent": profile,
            "tenantId": tenant_id,
            "activeWorkspace": workspace,
            "workspaces": workspaces
        })),
    )
        .into_response()
}

async fn auth_user_for_agent(state: &Arc<AppState>, agent_id: &str) -> Option<UserProfile> {
    let row = sqlx::query(
        "SELECT u.id, u.email, u.full_name FROM users u JOIN agents a ON a.user_id = u.id WHERE a.id = $1 LIMIT 1",
    )
    .bind(agent_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    Some(UserProfile {
        id: row.get("id"),
        email: row.get("email"),
        full_name: row.get("full_name"),
    })
}

async fn get_me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(tid) => tid,
        Err(err) => return err.into_response(),
    };
    match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => {
            let Some(user) = auth_user_for_agent(&state, &agent.id).await else {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "missing user account" })),
                )
                    .into_response();
            };
            let workspaces = list_user_workspaces(&state, &user.id).await;
            let active_workspace = workspaces
                .iter()
                .find(|w| w.id == tenant_id)
                .cloned()
                .or_else(|| workspaces.first().cloned());
            (
                StatusCode::OK,
                Json(json!({
                    "user": user,
                    "agent": agent,
                    "tenantId": tenant_id,
                    "activeWorkspace": active_workspace,
                    "workspaces": workspaces
                })),
            )
                .into_response()
        }
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

async fn patch_agent_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PatchAgentProfileBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };

    let name = body.name.unwrap_or(agent.name.clone());
    let avatar_url = body.avatar_url.unwrap_or(agent.avatar_url.clone());

    let _ = sqlx::query("UPDATE agents SET name = $1, avatar_url = $2 WHERE id = $3")
        .bind(&name)
        .bind(&avatar_url)
        .bind(&agent.id)
        .execute(&state.db)
        .await;

    let mut updated = agent;
    updated.name = name;
    updated.avatar_url = avatar_url;
    (StatusCode::OK, Json(json!({ "agent": updated }))).into_response()
}

async fn get_teams(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let rows = if agent.role == "owner" || agent.role == "admin" {
        sqlx::query("SELECT id, tenant_id, name, agent_ids FROM teams WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
    } else {
        sqlx::query("SELECT id, tenant_id, name, agent_ids FROM teams WHERE tenant_id = $1 AND $2 = ANY(jsonb_array_elements_text(agent_ids))")
            .bind(&tenant_id)
            .bind(&agent.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
    };
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
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only admin or owner can create teams" })),
        )
            .into_response();
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
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only admin or owner can add members to teams" })),
        )
            .into_response();
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

async fn get_agents(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query("SELECT id, name, email, status, role, avatar_url, team_ids FROM agents WHERE tenant_id = $1")
        .bind(&tenant_id)
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
            role: row.get("role"),
            avatar_url: row.get("avatar_url"),
            team_ids: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("team_ids"))
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "agents": agents }))).into_response()
}

async fn patch_session_assignee(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionAssigneeBody>,
) -> impl IntoResponse {
    let actor = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let previous_assignee: Option<String> = match sqlx::query(
        "SELECT assignee_agent_id FROM sessions WHERE id = $1",
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    {
        Some(row) => row.get("assignee_agent_id"),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "session not found" })),
            )
                .into_response()
        }
    };
    let requested = body
        .agent_id
        .as_deref()
        .unwrap_or("__bot__")
        .trim()
        .to_string();
    let (assignee_agent_id, handover_active) = if requested.is_empty() || requested == "__bot__" {
        (Some("__bot__".to_string()), false)
    } else {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM agents WHERE id = $1 AND tenant_id = $2",
        )
        .bind(&requested)
        .bind(&tenant_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
            > 0;
        if !exists {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "assignee not found" })),
            )
                .into_response();
        }
        (Some(requested), true)
    };

    let affected = sqlx::query(
        "UPDATE sessions SET assignee_agent_id = $1, handover_active = $2, updated_at = $3 WHERE id = $4",
    )
            .bind(&assignee_agent_id)
            .bind(handover_active)
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
    let assignee_changed = previous_assignee.as_deref() != assignee_agent_id.as_deref();
    if assignee_changed {
        let target_label = match assignee_agent_id.as_deref() {
            Some("__bot__") => "Bot".to_string(),
            Some(agent_id) => sqlx::query_scalar::<_, String>(
                "SELECT name FROM agents WHERE id = $1 AND tenant_id = $2",
            )
            .bind(agent_id)
            .bind(&tenant_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Unknown agent".to_string()),
            None => "Unassigned".to_string(),
        };
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &format!("{} assigned conversation to {}", actor.name, target_label),
            None,
            None,
            None,
        )
        .await;
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

async fn session_allows_human_reply(state: &Arc<AppState>, session_id: &str) -> bool {
    let row = sqlx::query(
        "SELECT channel, handover_active, assignee_agent_id FROM sessions WHERE id = $1 LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return false;
    };
    let channel: String = row.get("channel");
    if channel != "whatsapp" {
        return true;
    }
    let handover_active: bool = row.get("handover_active");
    if !handover_active {
        return false;
    }
    let assignee: Option<String> = row.get("assignee_agent_id");
    match assignee {
        Some(id) => {
            let value = id.trim();
            !value.is_empty() && value != "__bot__"
        }
        None => false,
    }
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

async fn patch_session_team(
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SessionTeamBody>,
) -> impl IntoResponse {
    let actor = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let previous_team_id: Option<String> = match sqlx::query("SELECT team_id FROM sessions WHERE id = $1")
        .bind(&session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
    {
        Some(row) => row.get("team_id"),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "session not found" })),
            )
                .into_response()
        }
    };
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
    if previous_team_id != body.team_id {
        let team_label = match body.team_id.as_deref() {
            Some(team_id) => sqlx::query_scalar::<_, String>(
                "SELECT name FROM teams WHERE id = $1 AND tenant_id = $2",
            )
            .bind(team_id)
            .bind(&tenant_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Unknown team".to_string()),
            None => "No team".to_string(),
        };
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &format!("{} changed team to {}", actor.name, team_label),
            None,
            None,
            None,
        )
        .await;
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

    let row = sqlx::query(
        "SELECT status, priority, snooze_mode, snoozed_until FROM sessions WHERE id = $1",
    )
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
    let previous_snooze_mode: Option<String> = row.get("snooze_mode");
    let previous_snoozed_until: Option<String> = row.get("snoozed_until");
    let mut next_snooze_mode = previous_snooze_mode.clone();
    let mut next_snoozed_until = previous_snoozed_until.clone();

    if let Some(status) = body.status {
        let normalized = status.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "open" | "resolved" | "awaiting" | "snoozed" => next_status = normalized,
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

    if let Some(snooze_mode) = body.snooze_mode {
        let Some(normalized) = normalize_snooze_mode(&snooze_mode) else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid snooze_mode (expected until_reply or until_time)" })),
            )
                .into_response();
        };
        next_snooze_mode = Some(normalized.clone());
        if normalized == "until_reply" {
            next_snoozed_until = None;
        }
    }

    if let Some(snoozed_until_raw) = body.snoozed_until {
        let value = snoozed_until_raw.trim();
        if value.is_empty() {
            next_snoozed_until = None;
        } else {
            let Some(parsed) = parse_snoozed_until_utc(value) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid snoozed_until (expected RFC3339)" })),
                )
                    .into_response();
            };
            if parsed <= Utc::now() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "snoozed_until must be in the future" })),
                )
                    .into_response();
            }
            next_snoozed_until = Some(parsed.to_rfc3339());
            next_snooze_mode = Some("until_time".to_string());
        }
    }

    if next_status != "snoozed" {
        next_snooze_mode = None;
        next_snoozed_until = None;
    } else {
        if next_snooze_mode.is_none() {
            next_snooze_mode = Some("until_reply".to_string());
        }
        if next_snooze_mode.as_deref() == Some("until_time") {
            let Some(until) = next_snoozed_until.clone() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "snoozed_until required when snooze_mode is until_time" })),
                )
                    .into_response();
            };
            let Some(parsed) = parse_snoozed_until_utc(&until) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid snoozed_until (expected RFC3339)" })),
                )
                    .into_response();
            };
            if parsed <= Utc::now() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "snoozed_until must be in the future" })),
                )
                    .into_response();
            }
        }
    }

    let _ = sqlx::query(
        "UPDATE sessions \
         SET status = $1, priority = $2, snooze_mode = $3, snoozed_until = $4, updated_at = $5 \
         WHERE id = $6",
    )
    .bind(&next_status)
    .bind(&next_priority)
    .bind(&next_snooze_mode)
    .bind(&next_snoozed_until)
    .bind(now_iso())
    .bind(&session_id)
    .execute(&state.db)
    .await;
    let was_terminal = previous_status == "resolved" || previous_status == "closed";
    let changed_to_resolved = !was_terminal && next_status == "resolved";
    let changed_from_terminal_to_open = was_terminal && next_status == "open";
    let Some(summary) = get_session_summary_db(&state.db, &session_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };

    emit_session_update(&state, summary.clone()).await;

    if changed_to_resolved {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "Conversation resolved by agent",
            None,
            None,
            None,
        )
        .await;

        // Fire lifecycle trigger
        let st = state.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            run_lifecycle_trigger(st, sid, "conversation_closed".into()).await;
        });
    } else if changed_from_terminal_to_open {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            "Conversation reopened",
            None,
            None,
            None,
        )
        .await;

        // Fire lifecycle trigger
        let st = state.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            run_lifecycle_trigger(st, sid, "conversation_reopened".into()).await;
        });
    } else if previous_status != next_status {
        if next_status == "snoozed" {
            let message = if next_snooze_mode.as_deref() == Some("until_time") {
                format!(
                    "Conversation snoozed until {}",
                    next_snoozed_until.clone().unwrap_or_default()
                )
            } else {
                "Conversation snoozed until next visitor reply".to_string()
            };
            let _ = add_message(
                state.clone(),
                &session_id,
                "system",
                &message,
                None,
                None,
                None,
            )
            .await;
        } else if previous_status == "snoozed" && next_status == "open" {
            let _ = add_message(
                state.clone(),
                &session_id,
                "system",
                "Conversation unsnoozed",
                None,
                None,
                None,
            )
            .await;
        } else {
            let _ = add_message(
                state.clone(),
                &session_id,
                "system",
                &format!(
                    "Status changed: {} -> {}",
                    humanize_system_value(&previous_status),
                    humanize_system_value(&next_status)
                ),
                None,
                None,
                None,
            )
            .await;
        }
    } else if next_status == "snoozed"
        && (previous_snooze_mode != next_snooze_mode
            || previous_snoozed_until != next_snoozed_until)
    {
        let message = if next_snooze_mode.as_deref() == Some("until_time") {
            format!(
                "Snooze updated until {}",
                next_snoozed_until.clone().unwrap_or_default()
            )
        } else {
            "Snooze updated: until next visitor reply".to_string()
        };
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &message,
            None,
            None,
            None,
        )
        .await;
    }

    if next_priority != row.get::<String, _>("priority") {
        let previous_priority: String = row.get("priority");
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &format!(
                "Priority changed: {} -> {}",
                humanize_system_value(&previous_priority),
                humanize_system_value(&next_priority)
            ),
            None,
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
        shortcut: normalize_canned_shortcut(&body.shortcut),
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
        reply.shortcut = normalize_canned_shortcut(&shortcut);
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationsQuery {
    #[serde(default)]
    unread_only: bool,
}

async fn get_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<NotificationsQuery>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let unread_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agent_notifications WHERE agent_id = $1 AND read_at IS NULL",
    )
    .bind(&agent.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let rows = if query.unread_only {
        sqlx::query(
            "SELECT id, tenant_id, agent_id, session_id, message_id, kind, title, body, read_at, created_at
             FROM agent_notifications
             WHERE agent_id = $1 AND read_at IS NULL
             ORDER BY created_at DESC
             LIMIT 200",
        )
        .bind(&agent.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query(
            "SELECT id, tenant_id, agent_id, session_id, message_id, kind, title, body, read_at, created_at
             FROM agent_notifications
             WHERE agent_id = $1
             ORDER BY created_at DESC
             LIMIT 400",
        )
        .bind(&agent.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };
    let notifications = rows
        .into_iter()
        .map(|row| AgentNotification {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            agent_id: row.get("agent_id"),
            session_id: row.get("session_id"),
            message_id: row.get("message_id"),
            kind: row.get("kind"),
            title: row.get("title"),
            body: row.get("body"),
            read_at: row.get("read_at"),
            created_at: row.get("created_at"),
        })
        .collect::<Vec<_>>();

    (
        StatusCode::OK,
        Json(json!({
            "notifications": notifications,
            "unreadCount": unread_count
        })),
    )
        .into_response()
}

async fn mark_notification_read(
    Path(notification_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let _ = sqlx::query(
        "UPDATE agent_notifications SET read_at = $1 WHERE id = $2 AND agent_id = $3 AND read_at IS NULL",
    )
    .bind(now_iso())
    .bind(&notification_id)
    .bind(&agent.id)
    .execute(&state.db)
    .await;
    let unread_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agent_notifications WHERE agent_id = $1 AND read_at IS NULL",
    )
    .bind(&agent.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    (StatusCode::OK, Json(json!({ "ok": true, "unreadCount": unread_count }))).into_response()
}

async fn mark_all_notifications_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let _ = sqlx::query(
        "UPDATE agent_notifications SET read_at = $1 WHERE agent_id = $2 AND read_at IS NULL",
    )
    .bind(now_iso())
    .bind(&agent.id)
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true, "unreadCount": 0 }))).into_response()
}

async fn whatsapp_webhook_verify(
    Path(channel_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let Some(channel) = find_channel_by_id(&state, &channel_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "channel not found" })),
        )
            .into_response();
    };
    if channel.channel_type != "whatsapp" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "channel exists but type is '{}', expected 'whatsapp'",
                    channel.channel_type
                )
            })),
        )
            .into_response();
    }

    let mode = params.get("hub.mode").cloned().unwrap_or_default();
    let verify_token = params.get("hub.verify_token").cloned().unwrap_or_default();
    let challenge = params.get("hub.challenge").cloned().unwrap_or_default();
    let expected_verify_token = config_text(&channel.config, "verifyToken");

    if mode == "subscribe"
        && !challenge.is_empty()
        && !expected_verify_token.is_empty()
        && verify_token == expected_verify_token
    {
        return (StatusCode::OK, challenge).into_response();
    }

    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "invalid webhook verification token" })),
    )
        .into_response()
}

async fn whatsapp_webhook_event(
    Path(channel_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let Some(channel) = find_channel_by_id(&state, &channel_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "channel not found" })),
        )
            .into_response();
    };
    if channel.channel_type != "whatsapp" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "channel exists but type is '{}', expected 'whatsapp'",
                    channel.channel_type
                )
            })),
        )
            .into_response();
    }

    let app_secret = config_text(&channel.config, "appSecret");
    let signature_header = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok());
    if !verify_whatsapp_signature(&app_secret, signature_header, &body) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid webhook signature" })),
        )
            .into_response();
    }

    let payload = serde_json::from_slice::<Value>(&body).unwrap_or_else(|_| json!({}));
    let expected_phone_number_id = config_text(&channel.config, "phoneNumberId");
    let entries = payload
        .get("entry")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut processed = 0usize;
    for entry in entries {
        let changes = entry
            .get("changes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for change in changes {
            let value = change.get("value").cloned().unwrap_or_else(|| json!({}));
            let contact_profile_names = whatsapp_contact_profile_names(&value);
            let metadata_phone_id = value
                .get("metadata")
                .and_then(|m| m.get("phone_number_id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !expected_phone_number_id.is_empty()
                && !metadata_phone_id.is_empty()
                && expected_phone_number_id != metadata_phone_id
            {
                continue;
            }

            let messages = value
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            for message in messages {
                let from = message
                    .get("from")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let Some(visitor_id) = whatsapp_visitor_id(&from) else {
                    continue;
                };
                let from_digits = normalize_whatsapp_phone(&from).unwrap_or_default();
                let profile_name = contact_profile_names
                    .get(&from_digits)
                    .cloned()
                    .unwrap_or_default();
                let Some((text, widget)) =
                    whatsapp_inbound_content(&message, &channel.id, &app_secret)
                else {
                    continue;
                };
                let widget = match widget {
                    Some(w) => Some(archive_whatsapp_media_widget(&state, &channel, w).await),
                    None => None,
                };

                let Some(session_id) = find_or_create_whatsapp_session(
                    &state,
                    &channel.tenant_id,
                    &visitor_id,
                )
                .await
                else {
                    continue;
                };

                let _ = sqlx::query(
                    "UPDATE sessions SET channel = 'whatsapp', visitor_id = $1, updated_at = $2 WHERE id = $3",
                )
                .bind(&visitor_id)
                .bind(now_iso())
                .bind(&session_id)
                .execute(&state.db)
                .await;

                if let Some(contact_id) = ensure_whatsapp_contact_for_visitor(
                    &state,
                    &channel.tenant_id,
                    &visitor_id,
                    &from,
                    &profile_name,
                    &channel.id,
                )
                .await
                {
                    let _ = sqlx::query(
                        "UPDATE sessions SET contact_id = $1 WHERE visitor_id = $2 AND visitor_id != ''",
                    )
                    .bind(&contact_id)
                    .bind(&visitor_id)
                    .execute(&state.db)
                    .await;
                } else {
                    resolve_contact_from_visitor_id(&state, &session_id, &visitor_id).await;
                }
                let persisted = add_message(
                    state.clone(),
                    &session_id,
                    "visitor",
                    &text,
                    None,
                    widget,
                    None,
                )
                .await
                .is_some();
                if persisted {
                    processed += 1;
                }
                let state_clone = state.clone();
                let session_clone = session_id.clone();
                let text_clone = text.clone();
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
    }

    (
        StatusCode::OK,
        Json(json!({ "received": true, "processed": processed })),
    )
        .into_response()
}

async fn whatsapp_media_proxy(
    Path((channel_id, media_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let Some(channel) = find_channel_by_id(&state, &channel_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "channel not found" })),
        )
            .into_response();
    };
    if channel.channel_type != "whatsapp" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "channel exists but type is '{}', expected 'whatsapp'",
                    channel.channel_type
                )
            })),
        )
            .into_response();
    }

    let app_secret = config_text(&channel.config, "appSecret");
    let exp = params
        .get("exp")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or_default();
    let sig = params.get("sig").cloned().unwrap_or_default();
    if !verify_whatsapp_media_token(&app_secret, &channel_id, &media_id, exp, &sig) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid or expired media token" })),
        )
            .into_response();
    }

    let access_token = config_text(&channel.config, "accessToken");
    if access_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing whatsapp access token" })),
        )
            .into_response();
    }

    let (body, content_type) =
        match fetch_whatsapp_media_from_meta(&state, &access_token, &media_id).await {
            Ok(v) => v,
            Err(err) => {
                return (StatusCode::BAD_GATEWAY, Json(json!({ "error": err }))).into_response();
            }
        };

    let mut response = axum::response::Response::new(axum::body::Body::from(body));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=300"),
    );
    if let Ok(v) = HeaderValue::from_str(&content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    response.into_response()
}

async fn serve_stored_media(
    Path(file_name): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if !is_safe_media_file_name(&file_name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid media file name" })),
        )
            .into_response();
    }
    let path = state.media_storage_dir.join(&file_name);
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "media file not found" })),
        )
            .into_response();
    };

    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let content_type = media_content_type_from_extension(&ext);

    let mut response = axum::response::Response::new(axum::body::Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    if let Ok(v) = HeaderValue::from_str(content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    response.into_response()
}

async fn upload_attachment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    if let Err(err) = auth_tenant_from_headers(&state, &headers).await {
        return err.into_response();
    }

    let mut uploaded: Option<Value> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name != "file" {
            continue;
        }
        let filename = field.file_name().unwrap_or("").to_string();
        let content_type = field
            .content_type()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let bytes = match field.bytes().await {
            Ok(b) if !b.is_empty() => b,
            _ => continue,
        };
        let ext = media_extension_from_filename(&filename)
            .unwrap_or_else(|| media_extension_from_mime(&content_type, "document"));
        let file_name = format!("{}.{}", Uuid::new_v4(), ext);
        let path = state.media_storage_dir.join(&file_name);
        if tokio::fs::write(&path, &bytes).await.is_err() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to store uploaded file" })),
            )
                .into_response();
        }

        uploaded = Some(json!({
            "url": format!("/api/media/{file_name}"),
            "fileName": if filename.is_empty() { file_name.clone() } else { filename.clone() },
            "mimeType": content_type.clone(),
            "sizeBytes": bytes.len(),
            "attachmentType": attachment_type_from_mime(&content_type),
            "storedFileName": file_name,
            "stored": true,
            "storage": "local"
        }));
        break;
    }

    let Some(file) = uploaded else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing file field in multipart form" })),
        )
            .into_response();
    };

    (StatusCode::CREATED, Json(json!({ "file": file }))).into_response()
}

async fn list_channels(
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
        "SELECT id, tenant_id, channel_type, name, config, enabled, created_at, updated_at \
         FROM channels WHERE tenant_id = $1 ORDER BY created_at ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let channel_records = rows.into_iter().map(parse_channel_row).collect::<Vec<_>>();
    let mut unique_types = channel_records
        .iter()
        .map(|c| c.channel_type.clone())
        .collect::<Vec<_>>();
    unique_types.extend(["web".to_string(), "api".to_string(), "whatsapp".to_string()]);
    unique_types.sort();
    unique_types.dedup();
    (
        StatusCode::OK,
        Json(json!({
            "channels": unique_types,
            "channelRecords": channel_records,
            "availableTypes": ["web", "api", "whatsapp"]
        })),
    )
        .into_response()
}

async fn create_channel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateChannelBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only admin or owner can create channels" })),
        )
            .into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let channel_type = body.channel_type.trim().to_ascii_lowercase();
    if channel_type.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channel_type required" })),
        )
            .into_response();
    }

    let name = body
        .name
        .unwrap_or_else(|| format!("{} Channel", channel_type))
        .trim()
        .to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }
    if channel_type != "web" && channel_type != "api" && channel_type != "whatsapp" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channel_type must be web, api, or whatsapp" })),
        )
            .into_response();
    }
    let config = body.config.unwrap_or_else(|| json!({}));
    if let Err(err) = validate_channel_config(&channel_type, &config) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
    }
    let now = now_iso();
    let channel = Channel {
        id: Uuid::new_v4().to_string(),
        tenant_id: tenant_id.clone(),
        channel_type: channel_type.clone(),
        name: name.clone(),
        config,
        enabled: true,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let _ = sqlx::query(
        "INSERT INTO channels (id, tenant_id, channel_type, name, config, enabled, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(&channel.id)
    .bind(&channel.tenant_id)
    .bind(&channel.channel_type)
    .bind(&channel.name)
    .bind(json_text(&channel.config))
    .bind(channel.enabled)
    .bind(&channel.created_at)
    .bind(&channel.updated_at)
    .execute(&state.db)
    .await;

    (StatusCode::CREATED, Json(json!({ "channel": channel }))).into_response()
}

async fn update_channel(
    Path(channel_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateChannelBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only admin or owner can update channels" })),
        )
            .into_response();
    }

    let channel_row = sqlx::query("SELECT id, tenant_id, name, channel_type, config, enabled, created_at FROM channels WHERE id = $1")
        .bind(&channel_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(channel_row) = channel_row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "channel not found" })),
        )
            .into_response();
    };

    let name = body.name.unwrap_or_else(|| channel_row.get("name"));
    let config = body
        .config
        .unwrap_or_else(|| parse_json_text(&channel_row.get::<String, _>("config")));
    let existing_channel_type: String = channel_row.get("channel_type");
    let channel_type = body
        .channel_type
        .as_deref()
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or(existing_channel_type);
    if channel_type != "web" && channel_type != "api" && channel_type != "whatsapp" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channel_type must be web, api, or whatsapp" })),
        )
            .into_response();
    }
    if let Err(err) = validate_channel_config(&channel_type, &config) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
    }
    let enabled = body.enabled.unwrap_or(channel_row.get("enabled"));
    let now = now_iso();

    let _ = sqlx::query(
        "UPDATE channels SET channel_type = $1, name = $2, config = $3, enabled = $4, updated_at = $5 WHERE id = $6",
    )
    .bind(&channel_type)
    .bind(&name)
    .bind(json_text(&config))
    .bind(enabled)
    .bind(&now)
    .bind(&channel_id)
    .execute(&state.db)
    .await;

    let updated = Channel {
        id: channel_id,
        tenant_id: channel_row.get("tenant_id"),
        channel_type,
        name,
        config,
        enabled,
        created_at: channel_row.get("created_at"),
        updated_at: now,
    };

    (StatusCode::OK, Json(json!({ "channel": updated }))).into_response()
}

async fn delete_channel(
    Path(channel_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only admin or owner can delete channels" })),
        )
            .into_response();
    }

    let channel_row = sqlx::query("SELECT id FROM channels WHERE id = $1")
        .bind(&channel_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    if channel_row.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "channel not found" })),
        )
            .into_response();
    }

    // Delete the channel
    let _ = sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(&channel_id)
        .execute(&state.db)
        .await;

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn get_tenants(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let user = match auth_user_for_agent(&state, &agent.id).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing user account" })),
            )
                .into_response();
        }
    };
    let rows = sqlx::query(
        "SELECT t.id, t.name, t.slug, t.workspace_username, t.created_at, t.updated_at \
         FROM tenants t JOIN agents a ON a.tenant_id = t.id \
         WHERE a.user_id = $1 ORDER BY t.created_at ASC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let tenants = rows
        .into_iter()
        .map(|row| Tenant {
            id: row.get("id"),
            name: row.get("name"),
            slug: row.get("slug"),
            workspace_username: row.get("workspace_username"),
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
    let user = match auth_user_for_agent(&state, &agent.id).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing user account" })),
            )
                .into_response();
        }
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }

    let default_workspace_username = slugify(&name);
    let workspace_username_raw = body
        .workspace_username
        .as_deref()
        .unwrap_or(&default_workspace_username)
        .to_string();
    let workspace_username = match validate_workspace_username(&workspace_username_raw) {
        Ok(v) => v,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
        }
    };
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE workspace_username = $1")
            .bind(&workspace_username)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
            > 0;
    if exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "workspace_username_taken" })),
        )
            .into_response();
    }

    let now = now_iso();
    let tenant = Tenant {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        slug: slugify(&name),
        workspace_username: workspace_username.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    if sqlx::query(
        "INSERT INTO tenants (id, name, slug, workspace_username, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&tenant.id)
    .bind(&tenant.name)
    .bind(&tenant.slug)
    .bind(&tenant.workspace_username)
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
        workspace_short_bio: "".to_string(),
        workspace_description: "".to_string(),
        primary_color: "#e4b84f".to_string(),
        accent_color: "#1f2230".to_string(),
        logo_url: "".to_string(),
        privacy_url: "#".to_string(),
        launcher_position: "bottom-right".to_string(),
        welcome_text: "Hello! How can we help?".to_string(),
        bot_name: "".to_string(),
        bot_avatar_url: "".to_string(),
        bot_enabled_by_default: true,
        bot_personality: "".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let _ = sqlx::query(
        "INSERT INTO tenant_settings (tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    )
    .bind(&settings.tenant_id)
    .bind(&settings.brand_name)
    .bind(&settings.workspace_short_bio)
    .bind(&settings.workspace_description)
    .bind(&settings.primary_color)
    .bind(&settings.accent_color)
    .bind(&settings.logo_url)
    .bind(&settings.privacy_url)
    .bind(&settings.launcher_position)
    .bind(&settings.welcome_text)
    .bind(&settings.bot_name)
    .bind(&settings.bot_avatar_url)
    .bind(settings.bot_enabled_by_default)
    .bind(&settings.bot_personality)
    .bind(&settings.created_at)
    .bind(&settings.updated_at)
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
        "INSERT INTO agents (id, user_id, tenant_id, name, email, status, password_hash, role, avatar_url, team_ids) \
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 \
         WHERE NOT EXISTS (SELECT 1 FROM agents WHERE user_id = $2 AND tenant_id = $3)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&user.id)
        .bind(&tenant.id)
    .bind(&user.full_name)
    .bind(&user.email)
    .bind("online")
    .bind(
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or_default(),
    )
    .bind("owner")
    .bind("")
    .bind("[]")
    .execute(&state.db)
    .await;

    let Some((token, _)) = issue_workspace_token(&state, &user.id, &tenant.id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create workspace token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user.id).await;
    (
        StatusCode::CREATED,
        Json(json!({
            "tenant": tenant,
            "token": token,
            "workspaces": workspaces,
            "activeWorkspace": workspaces.iter().find(|w| w.id == tenant.id).cloned()
        })),
    )
        .into_response()
}

async fn create_workspace_with_ticket(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateTenantBody>,
) -> impl IntoResponse {
    let ticket = body.login_ticket.unwrap_or_default();
    let Some(user_id) = consume_login_ticket(&state, &ticket).await else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid or expired login ticket" })),
        )
            .into_response();
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name required" })),
        )
            .into_response();
    }
    let default_workspace_username = slugify(&name);
    let workspace_username_raw = body
        .workspace_username
        .as_deref()
        .unwrap_or(&default_workspace_username)
        .to_string();
    let workspace_username = match validate_workspace_username(&workspace_username_raw) {
        Ok(v) => v,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
        }
    };
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE workspace_username = $1")
            .bind(&workspace_username)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
            > 0;
    if exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "workspace_username_taken" })),
        )
            .into_response();
    }
    let user_row = sqlx::query("SELECT email, full_name, password_hash FROM users WHERE id = $1")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(user_row) = user_row else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid user context" })),
        )
            .into_response();
    };
    let email: String = user_row.get("email");
    let full_name: String = user_row.get("full_name");
    let password_hash: String = user_row.get("password_hash");
    let now = now_iso();
    let tenant = Tenant {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        slug: slugify(&name),
        workspace_username: workspace_username.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let _ = sqlx::query(
        "INSERT INTO tenants (id, name, slug, workspace_username, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&tenant.id)
    .bind(&tenant.name)
    .bind(&tenant.slug)
    .bind(&tenant.workspace_username)
    .bind(&tenant.created_at)
    .bind(&tenant.updated_at)
    .execute(&state.db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO tenant_settings (tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    )
    .bind(&tenant.id)
    .bind(&tenant.name)
    .bind("")
    .bind("")
    .bind("#e4b84f")
    .bind("#1f2230")
    .bind("")
    .bind("#")
    .bind("bottom-right")
    .bind("Hello! How can we help?")
    .bind("")
    .bind("")
    .bind(true)
    .bind("")
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO agents (id, user_id, tenant_id, name, email, status, password_hash, role, avatar_url, team_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&tenant.id)
    .bind(&full_name)
    .bind(&email)
    .bind("online")
    .bind(&password_hash)
    .bind("owner")
    .bind("")
    .bind("[]")
    .execute(&state.db)
    .await;

    let Some((token, profile)) = issue_workspace_token(&state, &user_id, &tenant.id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user_id).await;
    (
        StatusCode::CREATED,
        Json(json!({
            "tenant": tenant,
            "token": token,
            "agent": profile,
            "tenantId": tenant.id,
            "activeWorkspace": workspaces.iter().find(|w| w.id == tenant.id).cloned(),
            "workspaces": workspaces
        })),
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
    let user = match auth_user_for_agent(&state, &agent.id).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing user account" })),
            )
                .into_response();
        }
    };
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agents WHERE user_id = $1 AND tenant_id = $2",
    )
    .bind(&user.id)
    .bind(&tenant_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;
    if !exists {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "tenant not accessible" })),
        )
            .into_response();
    }
    let Some((token, _)) = issue_workspace_token(&state, &user.id, &tenant_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    (
        StatusCode::OK,
        Json(json!({ "tenantId": tenant_id, "token": token })),
    )
        .into_response()
}

async fn switch_workspace_by_username(
    Path(workspace_username): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    let user = match auth_user_for_agent(&state, &agent.id).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing user account" })),
            )
                .into_response();
        }
    };
    let tenant_id = sqlx::query_scalar::<_, String>(
        "SELECT t.id FROM tenants t JOIN agents a ON a.tenant_id = t.id WHERE a.user_id = $1 AND t.workspace_username = $2 LIMIT 1",
    )
    .bind(&user.id)
    .bind(normalize_workspace_username(&workspace_username))
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(tenant_id) = tenant_id else {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "workspace not accessible" })),
        )
            .into_response();
    };
    let Some((token, profile)) = issue_workspace_token(&state, &user.id, &tenant_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user.id).await;
    (
        StatusCode::OK,
        Json(json!({
            "tenantId": tenant_id,
            "token": token,
            "agent": profile,
            "activeWorkspace": workspaces.iter().find(|w| w.id == tenant_id).cloned(),
            "workspaces": workspaces
        })),
    )
        .into_response()
}

// ── Tenant Members & Invitations ──

async fn get_tenant_members(
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
        "SELECT id, name, email, role, status, avatar_url FROM agents WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let members: Vec<TenantMember> = rows
        .into_iter()
        .map(|row| TenantMember {
            id: row.get("id"),
            name: row.get("name"),
            email: row.get("email"),
            role: row.get("role"),
            status: row.get("status"),
            avatar_url: row.get("avatar_url"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "members": members }))).into_response()
}

async fn invite_member(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<InviteMemberBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    // Only owner/admin can invite
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only owners and admins can invite members" })),
        )
            .into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let email = body.email.trim().to_lowercase();
    let role = body.role.trim().to_lowercase();
    if email.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "email required" })),
        )
            .into_response();
    }
    if role != "agent" && role != "admin" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "role must be agent or admin" })),
        )
            .into_response();
    }
    // Check if already a member
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agents WHERE tenant_id = $1 AND email = $2",
    )
    .bind(&tenant_id)
    .bind(&email)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;
    if exists {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "user is already a member of this workspace" })),
        )
            .into_response();
    }
    // Check if already invited
    let pending = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM tenant_invitations WHERE tenant_id = $1 AND email = $2 AND status = 'pending'",
    )
    .bind(&tenant_id)
    .bind(&email)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;
    if pending {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "invitation already pending for this email" })),
        )
            .into_response();
    }

    let now = now_iso();
    let inv_token = Uuid::new_v4().to_string();
    let invitation = TenantInvitation {
        id: Uuid::new_v4().to_string(),
        tenant_id: tenant_id.clone(),
        email: email.clone(),
        role: role.clone(),
        token: inv_token.clone(),
        status: "pending".to_string(),
        invited_by: agent.id.clone(),
        created_at: now.clone(),
        expires_at: "".to_string(), // no expiry for now
    };

    let _ = sqlx::query(
        "INSERT INTO tenant_invitations (id, tenant_id, email, role, token, status, invited_by, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&invitation.id)
    .bind(&invitation.tenant_id)
    .bind(&invitation.email)
    .bind(&invitation.role)
    .bind(&invitation.token)
    .bind(&invitation.status)
    .bind(&invitation.invited_by)
    .bind(&invitation.created_at)
    .bind(&invitation.expires_at)
    .execute(&state.db)
    .await;

    (
        StatusCode::CREATED,
        Json(json!({ "invitation": invitation })),
    )
        .into_response()
}

async fn get_tenant_invitations(
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
        "SELECT id, tenant_id, email, role, token, status, invited_by, created_at, expires_at FROM tenant_invitations WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let invitations: Vec<TenantInvitation> = rows
        .into_iter()
        .map(|row| TenantInvitation {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            email: row.get("email"),
            role: row.get("role"),
            token: row.get("token"),
            status: row.get("status"),
            invited_by: row.get("invited_by"),
            created_at: row.get("created_at"),
            expires_at: row.get("expires_at"),
        })
        .collect();
    (StatusCode::OK, Json(json!({ "invitations": invitations }))).into_response()
}

async fn revoke_invitation(
    Path(invitation_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only owners and admins can revoke invitations" })),
        )
            .into_response();
    }
    let _ = sqlx::query("DELETE FROM tenant_invitations WHERE id = $1")
        .bind(&invitation_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn update_member_role(
    Path(member_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateMemberRoleBody>,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only owners can change member roles" })),
        )
            .into_response();
    }
    if member_id == agent.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "cannot change your own role" })),
        )
            .into_response();
    }
    let role = body.role.trim().to_lowercase();
    if role != "agent" && role != "admin" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "role must be agent or admin" })),
        )
            .into_response();
    }
    let _ = sqlx::query("UPDATE agents SET role = $1 WHERE id = $2")
        .bind(&role)
        .bind(&member_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true, "role": role }))).into_response()
}

async fn remove_member(
    Path(member_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let agent = match auth_agent_from_headers(&state, &headers).await {
        Ok(a) => a,
        Err(err) => return err.into_response(),
    };
    if agent.role != "owner" && agent.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "only owners and admins can remove members" })),
        )
            .into_response();
    }
    if member_id == agent.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "cannot remove yourself" })),
        )
            .into_response();
    }
    // Cannot remove the owner
    let target_role = sqlx::query_scalar::<_, String>("SELECT role FROM agents WHERE id = $1")
        .bind(&member_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    if target_role == "owner" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "cannot remove the workspace owner" })),
        )
            .into_response();
    }
    // Delete auth tokens, then agent
    let _ = sqlx::query("DELETE FROM auth_tokens WHERE agent_id = $1")
        .bind(&member_id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM agents WHERE id = $1")
        .bind(&member_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// Public endpoint — no auth needed, checks token in body
async fn get_invitation_info(
    Path(inv_token): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let row = sqlx::query(
        "SELECT i.id, i.tenant_id, i.email, i.role, i.status, t.name as tenant_name, t.workspace_username \
         FROM tenant_invitations i JOIN tenants t ON t.id = i.tenant_id WHERE i.token = $1",
    )
    .bind(&inv_token)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some(row) => {
            let status: String = row.get("status");
            (
                StatusCode::OK,
                Json(json!({
                    "email": row.get::<String, _>("email"),
                    "role": row.get::<String, _>("role"),
                    "status": status,
                    "tenantName": row.get::<String, _>("tenant_name"),
                    "workspaceUsername": row.get::<String, _>("workspace_username"),
                })),
            )
                .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "invitation not found" })),
        )
            .into_response(),
    }
}

async fn accept_invitation_with_ticket(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AcceptInvitationBody>,
) -> impl IntoResponse {
    let invitation_token = body.invitation_token.trim().to_string();
    if invitation_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invitation_token is required" })),
        )
            .into_response();
    }
    let user_id = if let Some(ticket) = body.login_ticket {
        let Some(user_id) = consume_login_ticket(&state, ticket.trim()).await else {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "invalid or expired login ticket" })),
            )
                .into_response();
        };
        user_id
    } else {
        let agent = match auth_agent_from_headers(&state, &headers).await {
            Ok(a) => a,
            Err(err) => return err.into_response(),
        };
        let Some(user) = auth_user_for_agent(&state, &agent.id).await else {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing user account" })),
            )
                .into_response();
        };
        user.id
    };

    let user_row = sqlx::query("SELECT email, full_name, password_hash FROM users WHERE id = $1")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(user_row) = user_row else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid user context" })),
        )
            .into_response();
    };
    let email: String = user_row.get("email");
    let full_name: String = user_row.get("full_name");
    let password_hash: String = user_row.get("password_hash");

    let invitation_row = sqlx::query(
        "SELECT id, tenant_id, role, email, status FROM tenant_invitations WHERE token = $1",
    )
    .bind(&invitation_token)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(invitation_row) = invitation_row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "invitation not found" })),
        )
            .into_response();
    };
    let invitation_status: String = invitation_row.get("status");
    if invitation_status != "pending" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invitation already used" })),
        )
            .into_response();
    }
    let invited_email: String = invitation_row.get("email");
    if normalize_email(&invited_email) != normalize_email(&email) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invitation email mismatch" })),
        )
            .into_response();
    }
    let tenant_id: String = invitation_row.get("tenant_id");
    let role: String = invitation_row.get("role");
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM agents WHERE user_id = $1 AND tenant_id = $2",
    )
    .bind(&user_id)
    .bind(&tenant_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;
    if !exists {
        let _ = sqlx::query(
            "INSERT INTO agents (id, user_id, tenant_id, name, email, status, password_hash, role, avatar_url, team_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&user_id)
        .bind(&tenant_id)
        .bind(&full_name)
        .bind(&email)
        .bind("online")
        .bind(&password_hash)
        .bind(&role)
        .bind("")
        .bind("[]")
        .execute(&state.db)
        .await;
    }
    let _ = sqlx::query("UPDATE tenant_invitations SET status = 'accepted' WHERE token = $1")
        .bind(&invitation_token)
        .execute(&state.db)
        .await;

    let Some((token, profile)) = issue_workspace_token(&state, &user_id, &tenant_id).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to create auth token" })),
        )
            .into_response();
    };
    let workspaces = list_user_workspaces(&state, &user_id).await;
    (
        StatusCode::OK,
        Json(json!({
            "token": token,
            "agent": profile,
            "tenantId": tenant_id,
            "activeWorkspace": workspaces.iter().find(|w| w.id == tenant_id).cloned(),
            "workspaces": workspaces
        })),
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
        "SELECT tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        workspace_short_bio: row.get("workspace_short_bio"),
        workspace_description: row.get("workspace_description"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        bot_name: row.get("bot_name"),
        bot_avatar_url: row.get("bot_avatar_url"),
        bot_enabled_by_default: row.get("bot_enabled_by_default"),
        bot_personality: row.get("bot_personality"),
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
        "SELECT tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        workspace_short_bio: row.get("workspace_short_bio"),
        workspace_description: row.get("workspace_description"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        bot_name: row.get("bot_name"),
        bot_avatar_url: row.get("bot_avatar_url"),
        bot_enabled_by_default: row.get("bot_enabled_by_default"),
        bot_personality: row.get("bot_personality"),
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
    if let Some(v) = body.workspace_short_bio {
        settings.workspace_short_bio = v;
    }
    if let Some(v) = body.workspace_description {
        settings.workspace_description = v;
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
    if let Some(v) = body.bot_name {
        settings.bot_name = v;
    }
    if let Some(v) = body.bot_avatar_url {
        settings.bot_avatar_url = v;
    }
    if let Some(v) = body.bot_enabled_by_default {
        settings.bot_enabled_by_default = v;
    }
    if let Some(v) = body.bot_personality {
        settings.bot_personality = v;
    }
    settings.updated_at = now_iso();
    let _ = sqlx::query(
        "UPDATE tenant_settings SET brand_name = $1, workspace_short_bio = $2, workspace_description = $3, primary_color = $4, accent_color = $5, logo_url = $6, privacy_url = $7, launcher_position = $8, welcome_text = $9, bot_name = $10, bot_avatar_url = $11, bot_enabled_by_default = $12, bot_personality = $13, updated_at = $14 WHERE tenant_id = $15",
    )
    .bind(&settings.brand_name)
    .bind(&settings.workspace_short_bio)
    .bind(&settings.workspace_description)
    .bind(&settings.primary_color)
    .bind(&settings.accent_color)
    .bind(&settings.logo_url)
    .bind(&settings.privacy_url)
    .bind(&settings.launcher_position)
    .bind(&settings.welcome_text)
    .bind(&settings.bot_name)
    .bind(&settings.bot_avatar_url)
    .bind(settings.bot_enabled_by_default)
    .bind(&settings.bot_personality)
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
    let rows = sqlx::query("SELECT id, tenant_id, name, color, description, created_at FROM tags WHERE tenant_id = $1 ORDER BY name ASC")
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
            description: r.get("description"),
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
        description: body.description,
        created_at: now_iso(),
    };
    let _ = sqlx::query("INSERT INTO tags (id, tenant_id, name, color, description, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, name) DO NOTHING")
        .bind(&tag.id)
        .bind(&tag.tenant_id)
        .bind(&tag.name)
        .bind(&tag.color)
        .bind(&tag.description)
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

async fn update_tag(
    Path(tag_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateTagBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    // Build dynamic SET clauses
    let mut sets = Vec::new();
    let mut idx = 3u32;
    if body.name.is_some() {
        sets.push(format!("name = ${idx}"));
        idx += 1;
    }
    if body.color.is_some() {
        sets.push(format!("color = ${idx}"));
        idx += 1;
    }
    if body.description.is_some() {
        sets.push(format!("description = ${idx}"));
    }
    if sets.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "nothing to update" })),
        )
            .into_response();
    }
    let sql = format!("UPDATE tags SET {} WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, name, color, description, created_at", sets.join(", "));
    let mut q = sqlx::query(&sql).bind(&tag_id).bind(&tenant_id);
    if let Some(ref n) = body.name {
        q = q.bind(n.trim());
    }
    if let Some(ref c) = body.color {
        q = q.bind(c.as_str());
    }
    if let Some(ref d) = body.description {
        q = q.bind(d.as_str());
    }
    match q.fetch_optional(&state.db).await {
        Ok(Some(r)) => {
            let tag = Tag {
                id: r.get("id"),
                tenant_id: r.get("tenant_id"),
                name: r.get("name"),
                color: r.get("color"),
                description: r.get("description"),
                created_at: r.get("created_at"),
            };
            (StatusCode::OK, Json(json!({ "tag": tag }))).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tag not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

fn parse_kb_collection_row(row: sqlx::postgres::PgRow) -> KbCollection {
    KbCollection {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        name: row.get("name"),
        description: row.get("description"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn parse_kb_article_row(row: sqlx::postgres::PgRow) -> KbArticle {
    KbArticle {
        id: row.get("id"),
        tenant_id: row.get("tenant_id"),
        collection_id: row.get("collection_id"),
        title: row.get("title"),
        slug: row.get("slug"),
        markdown: row.get("markdown"),
        plain_text: row.get("plain_text"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        published_at: row.get("published_at"),
    }
}

async fn ensure_kb_collection_in_tenant(
    state: &Arc<AppState>,
    tenant_id: &str,
    collection_id: &str,
) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM kb_collections WHERE tenant_id = $1 AND id = $2",
    )
    .bind(tenant_id)
    .bind(collection_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0
}

async fn openai_embeddings(
    state: &Arc<AppState>,
    inputs: &[String],
) -> Result<Vec<Vec<f64>>, String> {
    if inputs.is_empty() {
        return Ok(vec![]);
    }
    let api_key = env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err("OPENAI_API_KEY not configured".to_string());
    }
    let model =
        env::var("OPENAI_EMBEDDING_MODEL").unwrap_or_else(|_| "text-embedding-3-large".to_string());
    let response = state
        .ai_client
        .post("https://api.openai.com/v1/embeddings")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "input": inputs,
        }))
        .send()
        .await
        .map_err(|err| format!("embedding request failed: {err}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("embedding provider returned {status}: {body}"));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|err| format!("embedding parse failed: {err}"))?;
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedding provider response missing data".to_string())?;
    let mut out = Vec::with_capacity(data.len());
    for item in data {
        let embedding = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or_else(|| "embedding provider item missing embedding".to_string())?
            .iter()
            .filter_map(Value::as_f64)
            .collect::<Vec<_>>();
        if embedding.len() != 3072 {
            return Err(format!(
                "embedding dimension mismatch: expected 3072 got {}",
                embedding.len()
            ));
        }
        out.push(embedding);
    }
    Ok(out)
}

async fn openai_rerank_scores(
    state: &Arc<AppState>,
    query: &str,
    candidates: &[(String, String, String)],
) -> Result<Vec<f64>, String> {
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let model = env::var("OPENAI_RERANK_MODEL").unwrap_or_else(|_| "gpt-4.1".to_string());
    let docs = candidates
        .iter()
        .enumerate()
        .map(|(idx, (title, collection, snippet))| {
            format!(
                "{}. title: {}\ncollection: {}\ntext: {}",
                idx + 1,
                title,
                collection,
                snippet
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let user_prompt = render_rerank_user_prompt(&RerankUserContext { query, docs: &docs });
    let raw = openai_chat_completion_text(
        state,
        &model,
        &render_rerank_system_prompt(),
        &user_prompt,
    )
    .await?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|err| format!("reranker json parse failed: {err}; raw={raw}"))?;
    let scores = value
        .get("scores")
        .and_then(Value::as_array)
        .ok_or_else(|| "reranker output missing scores".to_string())?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0))
        .collect::<Vec<_>>();
    if scores.len() != candidates.len() {
        return Err(format!(
            "reranker score length mismatch: expected {}, got {}",
            candidates.len(),
            scores.len()
        ));
    }
    Ok(scores)
}

async fn kb_collect_candidates(
    state: &Arc<AppState>,
    tenant_id: &str,
    query_text: &str,
    collection_ids: &[String],
    tag_ids: &[String],
    ann_limit: i64,
    bm25_limit: i64,
) -> Vec<(String, i32, String, String, String, String, String, String, f64, f64)> {
    let mut vector_rows = vec![];
    let query_embedding = openai_embeddings(state, &[query_text.to_string()]).await;
    if let Ok(embeddings) = query_embedding {
        if let Some(embedding) = embeddings.first() {
            let vector = embedding_to_pgvector(embedding);
            vector_rows = sqlx::query(
                "SELECT ch.id AS chunk_id, ch.chunk_index, ch.content_text, a.id AS article_id, a.title AS article_title, a.slug AS article_slug, \
                        c.id AS collection_id, c.name AS collection_name, ((1 - (ch.embedding <=> $2::vector))::double precision) AS score \
                 FROM kb_chunks ch \
                 INNER JOIN kb_articles a ON a.id = ch.article_id \
                 INNER JOIN kb_collections c ON c.id = a.collection_id \
                 WHERE ch.tenant_id = $1 \
                   AND a.status = 'published' \
                   AND (cardinality($3::text[]) = 0 OR a.collection_id = ANY($3)) \
                   AND (cardinality($4::text[]) = 0 OR EXISTS (SELECT 1 FROM kb_article_tags kat WHERE kat.article_id = a.id AND kat.tag_id = ANY($4)) OR EXISTS (SELECT 1 FROM kb_collection_tags kct WHERE kct.collection_id = c.id AND kct.tag_id = ANY($4))) \
                   AND ch.embedding IS NOT NULL \
                 ORDER BY ch.embedding <=> $2::vector \
                 LIMIT $5",
            )
            .bind(tenant_id)
            .bind(vector)
            .bind(collection_ids)
            .bind(tag_ids)
            .bind(ann_limit)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
        }
    }

    let bm25_rows = sqlx::query(
        "SELECT ch.id AS chunk_id, ch.chunk_index, ch.content_text, a.id AS article_id, a.title AS article_title, a.slug AS article_slug, \
                c.id AS collection_id, c.name AS collection_name, \
                (ts_rank_cd(ch.tsv, plainto_tsquery('english', $2))::double precision) AS score \
         FROM kb_chunks ch \
         INNER JOIN kb_articles a ON a.id = ch.article_id \
         INNER JOIN kb_collections c ON c.id = a.collection_id \
         WHERE ch.tenant_id = $1 \
           AND a.status = 'published' \
           AND (cardinality($3::text[]) = 0 OR a.collection_id = ANY($3)) \
           AND (cardinality($4::text[]) = 0 OR EXISTS (SELECT 1 FROM kb_article_tags kat WHERE kat.article_id = a.id AND kat.tag_id = ANY($4)) OR EXISTS (SELECT 1 FROM kb_collection_tags kct WHERE kct.collection_id = c.id AND kct.tag_id = ANY($4))) \
           AND ch.tsv @@ plainto_tsquery('english', $2) \
         ORDER BY score DESC \
         LIMIT $5",
    )
    .bind(tenant_id)
    .bind(query_text)
    .bind(collection_ids)
    .bind(tag_ids)
    .bind(bm25_limit)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    #[derive(Clone)]
    struct Candidate {
        chunk_id: String,
        chunk_index: i32,
        snippet: String,
        article_id: String,
        article_title: String,
        article_slug: String,
        collection_id: String,
        collection_name: String,
        vector_rank: Option<usize>,
        bm25_rank: Option<usize>,
        vector_score: f64,
        bm25_score: f64,
        fused_score: f64,
        rerank_score: f64,
    }

    let mut merged = HashMap::<String, Candidate>::new();
    for (rank, row) in vector_rows.iter().enumerate() {
        let chunk_id: String = row.get("chunk_id");
        let entry = merged.entry(chunk_id.clone()).or_insert(Candidate {
            chunk_id: chunk_id.clone(),
            chunk_index: row.get("chunk_index"),
            snippet: row.get::<String, _>("content_text"),
            article_id: row.get("article_id"),
            article_title: row.get("article_title"),
            article_slug: row.get("article_slug"),
            collection_id: row.get("collection_id"),
            collection_name: row.get("collection_name"),
            vector_rank: None,
            bm25_rank: None,
            vector_score: 0.0,
            bm25_score: 0.0,
            fused_score: 0.0,
            rerank_score: 0.0,
        });
        entry.vector_rank = Some(rank);
        entry.vector_score = row.get::<f64, _>("score");
    }
    for (rank, row) in bm25_rows.iter().enumerate() {
        let chunk_id: String = row.get("chunk_id");
        let entry = merged.entry(chunk_id.clone()).or_insert(Candidate {
            chunk_id: chunk_id.clone(),
            chunk_index: row.get("chunk_index"),
            snippet: row.get::<String, _>("content_text"),
            article_id: row.get("article_id"),
            article_title: row.get("article_title"),
            article_slug: row.get("article_slug"),
            collection_id: row.get("collection_id"),
            collection_name: row.get("collection_name"),
            vector_rank: None,
            bm25_rank: None,
            vector_score: 0.0,
            bm25_score: 0.0,
            fused_score: 0.0,
            rerank_score: 0.0,
        });
        entry.bm25_rank = Some(rank);
        entry.bm25_score = row.get::<f64, _>("score");
    }

    let rrf_k = 60.0f64;
    let query_terms = query_text
        .to_ascii_lowercase()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut candidates_all = merged.into_values().collect::<Vec<_>>();
    for candidate in &mut candidates_all {
        let mut fused = 0.0f64;
        if let Some(rank) = candidate.vector_rank {
            fused += 1.0 / (rrf_k + rank as f64 + 1.0);
        }
        if let Some(rank) = candidate.bm25_rank {
            fused += 1.0 / (rrf_k + rank as f64 + 1.0);
        }
        candidate.fused_score = fused;
        candidate.rerank_score = fused;
    }
    candidates_all.sort_by(|a, b| b.fused_score.total_cmp(&a.fused_score));

    let rerank_window = candidates_all.len().min(40);
    let mut candidates = candidates_all
        .into_iter()
        .take(rerank_window)
        .collect::<Vec<_>>();
    let rerank_inputs = candidates
        .iter()
        .map(|item| {
            (
                item.article_title.clone(),
                item.collection_name.clone(),
                item.snippet.clone(),
            )
        })
        .collect::<Vec<_>>();
    let rerank_scores = openai_rerank_scores(state, query_text, &rerank_inputs).await;
    if let Ok(scores) = rerank_scores {
        for (idx, candidate) in candidates.iter_mut().enumerate() {
            candidate.rerank_score = candidate.fused_score + scores[idx];
        }
    } else {
        for candidate in &mut candidates {
            let snippet_lower = candidate.snippet.to_ascii_lowercase();
            let chunk_terms = snippet_lower.split_whitespace().collect::<Vec<_>>();
            let overlap = query_terms
                .iter()
                .filter(|term| chunk_terms.contains(&term.as_str()))
                .count() as f64;
            candidate.rerank_score =
                candidate.fused_score + overlap * 0.02 + candidate.vector_score * 0.05 + candidate.bm25_score * 0.05;
        }
    }
    candidates.sort_by(|a, b| b.rerank_score.total_cmp(&a.rerank_score));

    candidates
        .into_iter()
        .map(|item| {
            (
                item.chunk_id,
                item.chunk_index,
                item.snippet,
                item.article_id,
                item.article_title,
                item.article_slug,
                item.collection_id,
                item.collection_name,
                item.fused_score,
                item.rerank_score,
            )
        })
        .collect()
}

async fn kb_expand_chunk_context(
    state: &Arc<AppState>,
    article_id: &str,
    center_index: i32,
    window: i32,
) -> String {
    let start = center_index.saturating_sub(window);
    let end = center_index.saturating_add(window);
    let rows = sqlx::query(
        "SELECT content_text FROM kb_chunks \
         WHERE article_id = $1 AND chunk_index BETWEEN $2 AND $3 \
         ORDER BY chunk_index ASC",
    )
    .bind(article_id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|row| row.get::<String, _>("content_text"))
        .collect::<Vec<_>>()
        .join(" ")
}

async fn kb_context_for_ai(state: &Arc<AppState>, tenant_id: &str, query_text: &str) -> String {
    let candidates = kb_collect_candidates(state, tenant_id, query_text, &[], &[], 50, 50).await;
    if candidates.is_empty() {
        return String::new();
    }
    let mut lines = Vec::new();
    for (idx, item) in candidates.into_iter().take(6).enumerate() {
        let (_chunk_id, chunk_index, _snippet, article_id, article_title, _slug, _cid, cname, _score, rerank) =
            item;
        let expanded = kb_expand_chunk_context(state, &article_id, chunk_index, 1).await;
        let clipped = expanded.chars().take(900).collect::<String>();
        lines.push(format!(
            "[{}] {} / {} (relevance {:.3})\n{}",
            idx + 1,
            cname,
            article_title,
            rerank,
            clipped
        ));
    }
    lines.join("\n\n")
}

async fn reindex_kb_article(state: &Arc<AppState>, article: &KbArticle) -> Result<usize, String> {
    let _ = sqlx::query("DELETE FROM kb_chunks WHERE article_id = $1")
        .bind(&article.id)
        .execute(&state.db)
        .await
        .map_err(|err| format!("failed clearing old chunks: {err}"))?;

    if article.status != "published" || article.plain_text.trim().is_empty() {
        return Ok(0);
    }

    let chunks = chunk_text(&article.plain_text, 600, 80);
    if chunks.is_empty() {
        return Ok(0);
    }

    let mut embeddings = Vec::<Vec<f64>>::new();
    for batch in chunks.chunks(32) {
        let batch_inputs = batch.iter().map(|item| item.to_string()).collect::<Vec<_>>();
        let mut batch_embeds = openai_embeddings(state, &batch_inputs).await?;
        embeddings.append(&mut batch_embeds);
    }
    if embeddings.len() != chunks.len() {
        return Err("embedding count mismatch".to_string());
    }

    let created_at = now_iso();
    for (idx, chunk) in chunks.iter().enumerate() {
        let vector_text = embedding_to_pgvector(&embeddings[idx]);
        let token_count = approximate_token_count(chunk) as i32;
        sqlx::query(
            "INSERT INTO kb_chunks (id, tenant_id, article_id, chunk_index, content_text, token_count, embedding, tsv, created_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7::vector,to_tsvector('english', $5),$8)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&article.tenant_id)
        .bind(&article.id)
        .bind(idx as i32)
        .bind(chunk)
        .bind(token_count)
        .bind(vector_text)
        .bind(&created_at)
        .execute(&state.db)
        .await
        .map_err(|err| format!("failed inserting chunk: {err}"))?;
    }

    Ok(chunks.len())
}

// ── Knowledge Base: Collections ─────────────────────────────────────
async fn get_kb_collections(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, name, description, created_at, updated_at \
         FROM kb_collections WHERE tenant_id = $1 ORDER BY name ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let collections = rows
        .into_iter()
        .map(parse_kb_collection_row)
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "collections": collections }))).into_response()
}

async fn create_kb_collection(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateKbCollectionBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let now = now_iso();
    let collection = KbCollection {
        id: Uuid::new_v4().to_string(),
        tenant_id,
        name: body.name.trim().to_string(),
        description: body.description.trim().to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    let result = sqlx::query(
        "INSERT INTO kb_collections (id, tenant_id, name, description, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&collection.id)
    .bind(&collection.tenant_id)
    .bind(&collection.name)
    .bind(&collection.description)
    .bind(&collection.created_at)
    .bind(&collection.updated_at)
    .execute(&state.db)
    .await;
    match result {
        Ok(_) => (StatusCode::CREATED, Json(json!({ "collection": collection }))).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("failed to create collection: {err}") })),
        )
            .into_response(),
    }
}

async fn patch_kb_collection(
    Path(collection_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateKbCollectionBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let mut sets = vec![];
    let mut idx = 3u32;
    if body.name.is_some() {
        sets.push(format!("name = ${idx}"));
        idx += 1;
    }
    if body.description.is_some() {
        sets.push(format!("description = ${idx}"));
        idx += 1;
    }
    sets.push(format!("updated_at = ${idx}"));
    let sql = format!(
        "UPDATE kb_collections SET {} WHERE id = $1 AND tenant_id = $2 \
         RETURNING id, tenant_id, name, description, created_at, updated_at",
        sets.join(", ")
    );
    let mut q = sqlx::query(&sql).bind(&collection_id).bind(&tenant_id);
    if let Some(name) = body.name.as_ref() {
        q = q.bind(name.trim());
    }
    if let Some(desc) = body.description.as_ref() {
        q = q.bind(desc.trim());
    }
    q = q.bind(now_iso());
    match q.fetch_optional(&state.db).await {
        Ok(Some(row)) => {
            let collection = parse_kb_collection_row(row);
            (StatusCode::OK, Json(json!({ "collection": collection }))).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "collection not found" })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn delete_kb_collection(
    Path(collection_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let affected = sqlx::query("DELETE FROM kb_collections WHERE id = $1 AND tenant_id = $2")
        .bind(&collection_id)
        .bind(&tenant_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|res| res.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "collection not found" })),
        )
            .into_response();
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Knowledge Base: Articles ────────────────────────────────────────
async fn get_kb_articles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListKbArticlesQuery>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, collection_id, title, slug, markdown, plain_text, status, created_at, updated_at, published_at \
         FROM kb_articles \
         WHERE tenant_id = $1 \
           AND ($2 = '' OR collection_id = $2) \
           AND ($3 = '' OR status = $3) \
         ORDER BY updated_at DESC",
    )
    .bind(&tenant_id)
    .bind(query.collection_id.trim())
    .bind(query.status.trim())
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let articles = rows.into_iter().map(parse_kb_article_row).collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "articles": articles }))).into_response()
}

async fn get_kb_article(
    Path(article_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    match sqlx::query(
        "SELECT id, tenant_id, collection_id, title, slug, markdown, plain_text, status, created_at, updated_at, published_at \
         FROM kb_articles WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&tenant_id)
    .bind(&article_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let article = parse_kb_article_row(row);
            (StatusCode::OK, Json(json!({ "article": article }))).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "article not found" })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn create_kb_article(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateKbArticleBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    if !ensure_kb_collection_in_tenant(&state, &tenant_id, &body.collection_id).await {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "collection not found in workspace" })),
        )
            .into_response();
    }
    let now = now_iso();
    let status = if body.status.trim().eq_ignore_ascii_case("published") {
        "published".to_string()
    } else {
        "draft".to_string()
    };
    let plain_text = markdown_to_plain_text(&body.markdown);
    let content_hash = sha256_hex(&plain_text);
    let slug = format!("{}-{}", slugify(&body.title), Uuid::new_v4().simple());
    let article = KbArticle {
        id: Uuid::new_v4().to_string(),
        tenant_id,
        collection_id: body.collection_id.clone(),
        title: body.title.trim().to_string(),
        slug,
        markdown: body.markdown.clone(),
        plain_text,
        status: status.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
        published_at: if status == "published" {
            Some(now.clone())
        } else {
            None
        },
    };
    let result = sqlx::query(
        "INSERT INTO kb_articles (id, tenant_id, collection_id, title, slug, markdown, plain_text, content_hash, status, published_at, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(&article.id)
    .bind(&article.tenant_id)
    .bind(&article.collection_id)
    .bind(&article.title)
    .bind(&article.slug)
    .bind(&article.markdown)
    .bind(&article.plain_text)
    .bind(content_hash)
    .bind(&article.status)
    .bind(&article.published_at)
    .bind(&article.created_at)
    .bind(&article.updated_at)
    .execute(&state.db)
    .await;
    if let Err(err) = result {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response();
    }
    if article.status == "published" {
        if let Err(err) = reindex_kb_article(&state, &article).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": err })),
            )
                .into_response();
        }
    }
    (StatusCode::CREATED, Json(json!({ "article": article }))).into_response()
}

async fn patch_kb_article(
    Path(article_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateKbArticleBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let existing = sqlx::query(
        "SELECT id, tenant_id, collection_id, title, slug, markdown, plain_text, status, created_at, updated_at, published_at \
         FROM kb_articles WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&tenant_id)
    .bind(&article_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = existing else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "article not found" })),
        )
            .into_response();
    };
    let mut article = parse_kb_article_row(row);
    if let Some(collection_id) = body.collection_id.as_ref() {
        if !ensure_kb_collection_in_tenant(&state, &tenant_id, collection_id).await {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "collection not found in workspace" })),
            )
                .into_response();
        }
        article.collection_id = collection_id.clone();
    }
    if let Some(title) = body.title.as_ref() {
        article.title = title.trim().to_string();
        article.slug = format!("{}-{}", slugify(&article.title), Uuid::new_v4().simple());
    }
    if let Some(markdown) = body.markdown.as_ref() {
        article.markdown = markdown.clone();
        article.plain_text = markdown_to_plain_text(&article.markdown);
    }
    article.updated_at = now_iso();
    let content_hash = sha256_hex(&article.plain_text);
    let result = sqlx::query(
        "UPDATE kb_articles \
         SET collection_id = $1, title = $2, slug = $3, markdown = $4, plain_text = $5, content_hash = $6, updated_at = $7 \
         WHERE id = $8 AND tenant_id = $9",
    )
    .bind(&article.collection_id)
    .bind(&article.title)
    .bind(&article.slug)
    .bind(&article.markdown)
    .bind(&article.plain_text)
    .bind(content_hash)
    .bind(&article.updated_at)
    .bind(&article.id)
    .bind(&tenant_id)
    .execute(&state.db)
    .await;
    if let Err(err) = result {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response();
    }
    if article.status == "published" {
        if let Err(err) = reindex_kb_article(&state, &article).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": err })),
            )
                .into_response();
        }
    }
    (StatusCode::OK, Json(json!({ "article": article }))).into_response()
}

async fn delete_kb_article(
    Path(article_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let affected = sqlx::query("DELETE FROM kb_articles WHERE id = $1 AND tenant_id = $2")
        .bind(&article_id)
        .bind(&tenant_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|res| res.rows_affected())
        .unwrap_or(0);
    if affected == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "article not found" })),
        )
            .into_response();
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn publish_kb_article(
    Path(article_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let now = now_iso();
    let row = sqlx::query(
        "UPDATE kb_articles SET status = 'published', published_at = $1, updated_at = $1 \
         WHERE id = $2 AND tenant_id = $3 \
         RETURNING id, tenant_id, collection_id, title, slug, markdown, plain_text, status, created_at, updated_at, published_at",
    )
    .bind(&now)
    .bind(&article_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "article not found" })),
        )
            .into_response();
    };
    let article = parse_kb_article_row(row);
    if let Err(err) = reindex_kb_article(&state, &article).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response();
    }
    (StatusCode::OK, Json(json!({ "article": article }))).into_response()
}

async fn unpublish_kb_article(
    Path(article_id): Path<String>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let row = sqlx::query(
        "UPDATE kb_articles SET status = 'draft', published_at = NULL, updated_at = $1 \
         WHERE id = $2 AND tenant_id = $3 \
         RETURNING id, tenant_id, collection_id, title, slug, markdown, plain_text, status, created_at, updated_at, published_at",
    )
    .bind(now_iso())
    .bind(&article_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "article not found" })),
        )
            .into_response();
    };
    let article = parse_kb_article_row(row);
    let _ = sqlx::query("DELETE FROM kb_chunks WHERE article_id = $1")
        .bind(&article.id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "article": article }))).into_response()
}

// ── Knowledge Base: Tags ────────────────────────────────────────────
async fn get_kb_tags(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, name, color, description, created_at \
         FROM kb_tags WHERE tenant_id = $1 ORDER BY name ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let tags = rows
        .into_iter()
        .map(|row| KbTag {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            name: row.get("name"),
            color: row.get("color"),
            description: row.get("description"),
            created_at: row.get("created_at"),
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "tags": tags }))).into_response()
}

async fn create_kb_tag(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateKbTagBody>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let tag = KbTag {
        id: Uuid::new_v4().to_string(),
        tenant_id,
        name: body.name.trim().to_string(),
        color: body.color,
        description: body.description,
        created_at: now_iso(),
    };
    match sqlx::query(
        "INSERT INTO kb_tags (id, tenant_id, name, color, description, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&tag.id)
    .bind(&tag.tenant_id)
    .bind(&tag.name)
    .bind(&tag.color)
    .bind(&tag.description)
    .bind(&tag.created_at)
    .execute(&state.db)
    .await
    {
        Ok(_) => (StatusCode::CREATED, Json(json!({ "tag": tag }))).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn attach_kb_collection_tag(
    Path((collection_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM kb_collections c, kb_tags t \
         WHERE c.id = $1 AND c.tenant_id = $3 AND t.id = $2 AND t.tenant_id = $3",
    )
    .bind(&collection_id)
    .bind(&tag_id)
    .bind(&tenant_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if exists == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid collection or tag" })),
        )
            .into_response();
    }
    let _ = sqlx::query(
        "INSERT INTO kb_collection_tags (collection_id, tag_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(&collection_id)
    .bind(&tag_id)
    .bind(now_iso())
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn detach_kb_collection_tag(
    Path((collection_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("DELETE FROM kb_collection_tags WHERE collection_id = $1 AND tag_id = $2")
        .bind(&collection_id)
        .bind(&tag_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn attach_kb_article_tag(
    Path((article_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM kb_articles a, kb_tags t \
         WHERE a.id = $1 AND a.tenant_id = $3 AND t.id = $2 AND t.tenant_id = $3",
    )
    .bind(&article_id)
    .bind(&tag_id)
    .bind(&tenant_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if exists == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid article or tag" })),
        )
            .into_response();
    }
    let _ = sqlx::query(
        "INSERT INTO kb_article_tags (article_id, tag_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(&article_id)
    .bind(&tag_id)
    .bind(now_iso())
    .execute(&state.db)
    .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn detach_kb_article_tag(
    Path((article_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let _ = sqlx::query("DELETE FROM kb_article_tags WHERE article_id = $1 AND tag_id = $2")
        .bind(&article_id)
        .bind(&tag_id)
        .execute(&state.db)
        .await;
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

// ── Knowledge Base: Search ──────────────────────────────────────────
async fn kb_search(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<KbSearchRequest>,
) -> impl IntoResponse {
    if let Err(err) = auth_agent_from_headers(&state, &headers).await {
        return err.into_response();
    }
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(value) => value,
        Err(err) => return err.into_response(),
    };
    let query_text = body.query.trim().to_string();
    if query_text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "query is required" })),
        )
            .into_response();
    }
    let top_k = body.top_k.clamp(1, 20) as usize;
    let ann_limit = 80i64;
    let bm25_limit = 80i64;
    let collection_ids = body.collection_ids.clone();
    let tag_ids = body.tag_ids.clone();
    let candidates = kb_collect_candidates(
        &state,
        &tenant_id,
        &query_text,
        &collection_ids,
        &tag_ids,
        ann_limit,
        bm25_limit,
    )
    .await
    .into_iter()
    .take(top_k)
    .collect::<Vec<_>>();
    let article_ids = candidates
        .iter()
        .map(|item| item.3.clone())
        .collect::<Vec<_>>();

    let tag_rows = if article_ids.is_empty() {
        vec![]
    } else {
        sqlx::query(
            "SELECT src.article_id, t.id, t.tenant_id, t.name, t.color, t.description, t.created_at \
             FROM ( \
                SELECT kat.article_id, kat.tag_id FROM kb_article_tags kat WHERE kat.article_id = ANY($1) \
                UNION \
                SELECT a.id AS article_id, kct.tag_id \
                FROM kb_articles a \
                INNER JOIN kb_collection_tags kct ON kct.collection_id = a.collection_id \
                WHERE a.id = ANY($1) \
             ) src \
             INNER JOIN kb_tags t ON t.id = src.tag_id \
             WHERE t.tenant_id = $2",
        )
        .bind(&article_ids)
        .bind(&tenant_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };
    let mut tags_by_article = HashMap::<String, Vec<KbTag>>::new();
    for row in tag_rows {
        let article_id: String = row.get("article_id");
        let tag = KbTag {
            id: row.get("id"),
            tenant_id: row.get("tenant_id"),
            name: row.get("name"),
            color: row.get("color"),
            description: row.get("description"),
            created_at: row.get("created_at"),
        };
        tags_by_article.entry(article_id).or_default().push(tag);
    }

    let mut hits = Vec::new();
    for candidate in candidates {
        let (chunk_id, chunk_index, snippet, article_id, article_title, article_slug, collection_id, collection_name, score, rerank_score) =
            candidate;
        let expanded = kb_expand_chunk_context(&state, &article_id, chunk_index, 1).await;
        let snippet_text = if expanded.trim().is_empty() {
            snippet
        } else {
            expanded
        };
        let snippet = snippet_text
            .chars()
            .take(1200)
            .collect::<String>()
            .trim()
            .to_string();
        hits.push(KbSearchHit {
            article_id: article_id.clone(),
            article_title,
            article_slug,
            collection_id,
            collection_name,
            chunk_id,
            chunk_index,
            snippet,
            score,
            rerank_score,
            tags: tags_by_article.remove(&article_id).unwrap_or_default(),
        });
    }
    (StatusCode::OK, Json(json!({ "hits": hits }))).into_response()
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
        "SELECT t.id, t.tenant_id, t.name, t.color, t.description, t.created_at FROM tags t INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.session_id = $1 ORDER BY t.name ASC",
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
            description: r.get("description"),
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
    let actor = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let inserted = sqlx::query("INSERT INTO conversation_tags (session_id, tag_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
        .bind(&session_id)
        .bind(&body.tag_id)
        .bind(now_iso())
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if inserted > 0 {
        let tag_name = sqlx::query_scalar::<_, String>(
            "SELECT name FROM tags WHERE id = $1 AND tenant_id = $2",
        )
        .bind(&body.tag_id)
        .bind(&tenant_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Unknown tag".to_string());
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &format!("{} added tag {}", actor.name, tag_name),
            None,
            None,
            None,
        )
        .await;
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn remove_session_tag(
    Path((session_id, tag_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match auth_agent_from_headers(&state, &headers).await {
        Ok(agent) => agent,
        Err(err) => return err.into_response(),
    };
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };
    let tag_name = sqlx::query_scalar::<_, String>("SELECT name FROM tags WHERE id = $1 AND tenant_id = $2")
        .bind(&tag_id)
        .bind(&tenant_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Unknown tag".to_string());
    let removed = sqlx::query("DELETE FROM conversation_tags WHERE session_id = $1 AND tag_id = $2")
        .bind(&session_id)
        .bind(&tag_id)
        .execute(&state.db)
        .await
        .ok()
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if removed > 0 {
        let _ = add_message(
            state.clone(),
            &session_id,
            "system",
            &format!("{} removed tag {}", actor.name, tag_name),
            None,
            None,
            None,
        )
        .await;
    }
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
    let tenant_id = match auth_tenant_from_headers(&state, &headers).await {
        Ok(id) => id,
        Err(err) => return err.into_response(),
    };

    let session_row = sqlx::query("SELECT tenant_id, visitor_id FROM sessions WHERE id = $1")
        .bind(&session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some(session_row) = session_row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )
            .into_response();
    };
    let session_tenant: String = session_row.get("tenant_id");
    let visitor_id: String = session_row
        .get::<Option<String>, _>("visitor_id")
        .unwrap_or_default();
    if session_tenant != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "session not in active workspace" })),
        )
            .into_response();
    }

    if let Some(cid) = body.contact_id.as_ref() {
        let contact_in_tenant = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM contacts WHERE id = $1 AND tenant_id = $2",
        )
        .bind(cid)
        .bind(&tenant_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
            > 0;
        if !contact_in_tenant {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "contact does not belong to this workspace" })),
            )
                .into_response();
        }
    }

    let _ = sqlx::query("UPDATE sessions SET contact_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&body.contact_id)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await;

    if let Some(cid) = body.contact_id.as_ref() {
        if !visitor_id.is_empty() {
            let _ = sqlx::query(
                "UPDATE sessions SET contact_id = $1 \
                 WHERE tenant_id = $3 AND visitor_id = $2 AND visitor_id != '' AND (contact_id IS NULL OR contact_id = '')",
            )
            .bind(cid)
            .bind(&visitor_id)
            .bind(&tenant_id)
            .execute(&state.db)
            .await;
        }
    }

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
    let tenant_id = tenant_for_session(&state, &session_id)
        .await
        .unwrap_or_default();
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

    // Resume the paused flow if cursor is on a csat or close_conversation node
    let sid = survey.session_id.clone();
    let st = state.clone();
    tokio::spawn(async move {
        if let Some((cursor_flow_id, cursor_node_id, cursor_node_type, cursor_vars)) =
            get_flow_cursor(&st, &sid).await
        {
            if cursor_node_type == "csat" || cursor_node_type == "close_conversation" {
                if let Some(flow) = get_flow_by_id_db(&st.db, &cursor_flow_id).await {
                    execute_flow_from(
                        st,
                        sid,
                        flow,
                        String::new(),
                        Some(cursor_node_id),
                        cursor_vars,
                    )
                    .await;
                }
            }
        }
    });

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

async fn widget_bootstrap(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let tenant_id = match params.get("tenant_id") {
        Some(tid) if !tid.is_empty() => tid.clone(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "tenant_id query parameter is required" })),
            )
                .into_response();
        }
    };

    // Validate tenant exists
    let tenant_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM tenants WHERE id = $1")
        .bind(&tenant_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
        > 0;
    if !tenant_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tenant not found" })),
        )
            .into_response();
    }

    let _channel_id = params.get("channel_id").cloned();

    // Channel config is available for future per-channel overrides
    let _channel_config = if let Some(ref ch_id) = _channel_id {
        sqlx::query("SELECT config, channel_type FROM channels WHERE id = $1 AND tenant_id = $2")
            .bind(ch_id)
            .bind(&tenant_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .map(|row| {
                let config_str: String = row.get("config");
                let channel_type: String = row.get("channel_type");
                (parse_json_text(&config_str), channel_type)
            })
    } else {
        None
    };

    // Fetch tenant settings
    let settings = sqlx::query(
        "SELECT tenant_id, brand_name, workspace_short_bio, workspace_description, primary_color, accent_color, logo_url, privacy_url, launcher_position, welcome_text, bot_name, bot_avatar_url, bot_enabled_by_default, bot_personality, created_at, updated_at FROM tenant_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| TenantSettings {
        tenant_id: row.get("tenant_id"),
        brand_name: row.get("brand_name"),
        workspace_short_bio: row.get("workspace_short_bio"),
        workspace_description: row.get("workspace_description"),
        primary_color: row.get("primary_color"),
        accent_color: row.get("accent_color"),
        logo_url: row.get("logo_url"),
        privacy_url: row.get("privacy_url"),
        launcher_position: row.get("launcher_position"),
        welcome_text: row.get("welcome_text"),
        bot_name: row.get("bot_name"),
        bot_avatar_url: row.get("bot_avatar_url"),
        bot_enabled_by_default: row.get("bot_enabled_by_default"),
        bot_personality: row.get("bot_personality"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    });

    // Fetch available agents for the widget header (show online team members)
    let agent_rows = sqlx::query(
        "SELECT id, name, avatar_url, status FROM agents WHERE tenant_id = $1 AND status = 'online' ORDER BY name ASC LIMIT 5",
    )
    .bind(&tenant_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let agents: Vec<Value> = agent_rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "name": row.get::<String, _>("name"),
                "avatarUrl": row.get::<Option<String>, _>("avatar_url").unwrap_or_default(),
            })
        })
        .collect();

    (
        StatusCode::OK,
        Json(json!({ "settings": settings, "agents": agents })),
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
                    let tenant_id = envelope
                        .data
                        .get("tenantId")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if tenant_id.is_empty() {
                        emit_to_client(
                            &state,
                            client_id,
                            "error",
                            json!({ "message": "tenantId is required" }),
                        )
                        .await;
                        continue;
                    }
                    let session = ensure_session(state.clone(), session_id, tenant_id).await;

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

                let agent_row = sqlx::query(
                    "SELECT a.id, a.name, a.email, a.status, a.role, a.avatar_url, a.team_ids, t.tenant_id FROM auth_tokens t JOIN agents a ON a.id = t.agent_id WHERE t.token = $1",
                )
                .bind(&token)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();

                if let Some(row) = agent_row {
                    let profile = AgentProfile {
                        id: row.get("id"),
                        name: row.get("name"),
                        email: row.get("email"),
                        status: row.get("status"),
                        role: row.get("role"),
                        avatar_url: row
                            .get::<Option<String>, _>("avatar_url")
                            .unwrap_or_default(),
                        team_ids: serde_json::from_str::<Vec<String>>(
                            &row.get::<String, _>("team_ids"),
                        )
                        .unwrap_or_default(),
                    };
                    let mut rt = state.realtime.lock().await;
                    rt.agents.insert(client_id);
                    rt.agent_profiles.insert(client_id, profile);
                    rt.agent_tenant_by_client
                        .insert(client_id, row.get::<String, _>("tenant_id"));
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

                    let _ = add_message(
                        state.clone(),
                        &target_session_id,
                        "visitor",
                        text,
                        None,
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
                    let client_tenant_id = {
                        let rt = state.realtime.lock().await;
                        rt.agent_tenant_by_client.get(&client_id).cloned()
                    };
                    if let Some(client_tenant_id) = client_tenant_id {
                        let session_tenant_id = tenant_for_session(&state, session_id)
                            .await
                            .unwrap_or_default();
                        if session_tenant_id != client_tenant_id {
                            continue;
                        }
                    }
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
                    let client_tenant_id = {
                        let rt = state.realtime.lock().await;
                        rt.agent_tenant_by_client.get(&client_id).cloned()
                    };
                    if let Some(client_tenant_id) = client_tenant_id {
                        let session_tenant_id = tenant_for_session(&state, session_id)
                            .await
                            .unwrap_or_default();
                        if session_tenant_id != client_tenant_id {
                            continue;
                        }
                    }
                    let messages = get_session_messages_db(&state.db, session_id).await;

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

                    emit_to_client(&state, client_id, "session:history", messages).await;
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
                    if !internal && !session_allows_human_reply(&state, session_id).await {
                        emit_to_client(
                            &state,
                            client_id,
                            "agent:send-blocked",
                            json!({ "sessionId": session_id, "reason": "bot_assigned" }),
                        )
                        .await;
                        continue;
                    }
                    let sender = if internal { "team" } else { "agent" };
                    let agent_profile = {
                        let rt = state.realtime.lock().await;
                        rt.agent_profiles.get(&client_id).cloned()
                    };
                    let created = add_message(
                        state.clone(),
                        session_id,
                        sender,
                        text,
                        None,
                        None,
                        agent_profile.as_ref(),
                    )
                    .await;
                    if internal {
                        if let (Some(message), Some(author)) = (created.as_ref(), agent_profile.as_ref()) {
                            let tenant_id = {
                                let rt = state.realtime.lock().await;
                                rt.agent_tenant_by_client
                                    .get(&client_id)
                                    .cloned()
                                    .unwrap_or_default()
                            };
                            let resolved_tenant = if tenant_id.is_empty() {
                                tenant_for_session(&state, session_id).await.unwrap_or_default()
                            } else {
                                tenant_id
                            };
                            if !resolved_tenant.is_empty() {
                                dispatch_internal_note_mentions(
                                    state.clone(),
                                    &resolved_tenant,
                                    session_id,
                                    message,
                                    author,
                                )
                                .await;
                            }
                        }
                    }
                }
            }
            "agent:attachment" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let url = envelope
                    .data
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let file_name = envelope
                    .data
                    .get("fileName")
                    .and_then(Value::as_str)
                    .unwrap_or("attachment");
                let mime_type = envelope
                    .data
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or("application/octet-stream");
                let attachment_type = envelope
                    .data
                    .get("attachmentType")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let text = envelope
                    .data
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let internal = envelope
                    .data
                    .get("internal")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                if let Some(session_id) = session_id {
                    if !internal && !session_allows_human_reply(&state, session_id).await {
                        emit_to_client(
                            &state,
                            client_id,
                            "agent:send-blocked",
                            json!({ "sessionId": session_id, "reason": "bot_assigned" }),
                        )
                        .await;
                        continue;
                    }
                    let sender = if internal { "team" } else { "agent" };
                    let inferred_type = if attachment_type.trim().is_empty() {
                        attachment_type_from_mime(mime_type)
                    } else {
                        attachment_type.to_string()
                    };
                    let widget = json!({
                        "type": "attachment",
                        "attachmentType": inferred_type,
                        "url": url,
                        "mimeType": mime_type,
                        "filename": file_name,
                        "stored": true,
                        "storage": "local"
                    });
                    let safe_text = if text.is_empty() { String::new() } else { text };
                    let agent_profile = {
                        let rt = state.realtime.lock().await;
                        rt.agent_profiles.get(&client_id).cloned()
                    };
                    let created = add_message(
                        state.clone(),
                        session_id,
                        sender,
                        &safe_text,
                        None,
                        Some(widget),
                        agent_profile.as_ref(),
                    )
                    .await;
                    if internal {
                        if let (Some(message), Some(author)) = (created.as_ref(), agent_profile.as_ref()) {
                            let tenant_id = {
                                let rt = state.realtime.lock().await;
                                rt.agent_tenant_by_client
                                    .get(&client_id)
                                    .cloned()
                                    .unwrap_or_default()
                            };
                            let resolved_tenant = if tenant_id.is_empty() {
                                tenant_for_session(&state, session_id).await.unwrap_or_default()
                            } else {
                                tenant_id
                            };
                            if !resolved_tenant.is_empty() {
                                dispatch_internal_note_mentions(
                                    state.clone(),
                                    &resolved_tenant,
                                    session_id,
                                    message,
                                    author,
                                )
                                .await;
                            }
                        }
                    }
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
        rt.agent_profiles.remove(&client_id);
        rt.agent_tenant_by_client.remove(&client_id);
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
    let _ = dotenvy::dotenv();

    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(4000);
    let database_url = resolve_database_url();
    let media_storage_dir = env::var("MEDIA_STORAGE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./media_uploads"));
    let public_base_url = env::var("API_PUBLIC_URL")
        .unwrap_or_else(|_| format!("http://localhost:{port}"))
        .trim_end_matches('/')
        .to_string();
    if let Err(err) = tokio::fs::create_dir_all(&media_storage_dir).await {
        panic!(
            "failed to create media storage directory {}: {}",
            media_storage_dir.display(),
            err
        );
    }
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("failed to connect to postgres (set DATABASE_URL or POSTGRES_* env vars)");

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("failed to run sqlx migrations");

    let state = Arc::new(AppState {
        db,
        realtime: Mutex::new(RealtimeState::default()),
        next_client_id: AtomicUsize::new(0),
        ai_client: reqwest::Client::new(),
        media_storage_dir,
        public_base_url,
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/media/{file_name}", get(serve_stored_media))
        .route("/api/uploads/attachment", post(upload_attachment))
        .route("/api/widget/bootstrap", get(widget_bootstrap))
        .route("/api/auth/register", post(register_agent))
        .route("/api/auth/signup", post(signup_user))
        .route("/api/auth/login", post(login_agent))
        .route("/api/auth/select-workspace", post(select_workspace))
        .route("/api/auth/me", get(get_me))
        .route(
            "/api/workspaces",
            get(get_tenants).post(create_workspace_with_ticket),
        )
        .route(
            "/api/workspaces/{workspace_username}/switch",
            post(switch_workspace_by_username),
        )
        .route("/api/tenants", get(get_tenants).post(create_tenant))
        .route("/api/tenants/{tenant_id}/switch", post(switch_tenant))
        .route("/api/tenant/members", get(get_tenant_members))
        .route(
            "/api/tenant/members/{member_id}/role",
            patch(update_member_role),
        )
        .route(
            "/api/tenant/members/{member_id}",
            axum::routing::delete(remove_member),
        )
        .route(
            "/api/tenant/invitations",
            get(get_tenant_invitations).post(invite_member),
        )
        .route(
            "/api/tenant/invitations/{invitation_id}",
            axum::routing::delete(revoke_invitation),
        )
        .route("/api/invitation/{inv_token}", get(get_invitation_info))
        .route(
            "/api/invitations/accept",
            post(accept_invitation_with_ticket),
        )
        .route(
            "/api/tenant/settings",
            get(get_tenant_settings).patch(patch_tenant_settings),
        )
        .route("/api/agent/status", patch(patch_agent_status))
        .route("/api/agent/profile", patch(patch_agent_profile))
        .route("/api/notifications", get(get_notifications))
        .route(
            "/api/notifications/read-all",
            post(mark_all_notifications_read),
        )
        .route(
            "/api/notifications/{notification_id}/read",
            patch(mark_notification_read),
        )
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
        .route(
            "/api/tags/{tag_id}",
            axum::routing::delete(delete_tag).patch(update_tag),
        )
        .route(
            "/api/kb/collections",
            get(get_kb_collections).post(create_kb_collection),
        )
        .route(
            "/api/kb/collections/{collection_id}",
            patch(patch_kb_collection).delete(delete_kb_collection),
        )
        .route("/api/kb/articles", get(get_kb_articles).post(create_kb_article))
        .route(
            "/api/kb/articles/{article_id}",
            get(get_kb_article).patch(patch_kb_article).delete(delete_kb_article),
        )
        .route(
            "/api/kb/articles/{article_id}/publish",
            post(publish_kb_article),
        )
        .route(
            "/api/kb/articles/{article_id}/unpublish",
            post(unpublish_kb_article),
        )
        .route("/api/kb/tags", get(get_kb_tags).post(create_kb_tag))
        .route(
            "/api/kb/collections/{collection_id}/tags/{tag_id}",
            post(attach_kb_collection_tag).delete(detach_kb_collection_tag),
        )
        .route(
            "/api/kb/articles/{article_id}/tags/{tag_id}",
            post(attach_kb_article_tag).delete(detach_kb_article_tag),
        )
        .route("/api/kb/search", post(kb_search))
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
        .route("/api/channels", get(list_channels).post(create_channel))
        .route(
            "/api/channels/{channel_id}",
            patch(update_channel).delete(delete_channel),
        )
        .route(
            "/api/channels/{channel_id}/whatsapp/webhook",
            get(whatsapp_webhook_verify).post(whatsapp_webhook_event),
        )
        .route(
            "/api/channels/{channel_id}/whatsapp/media/{media_id}",
            get(whatsapp_media_proxy),
        )
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
        .route(
            "/api/session/{session_id}/whatsapp/templates",
            get(list_whatsapp_templates),
        )
        .route(
            "/api/session/{session_id}/whatsapp/template",
            post(send_whatsapp_template),
        )
        .route(
            "/api/session/{session_id}/whatsapp/block-status",
            get(whatsapp_block_status),
        )
        .route(
            "/api/session/{session_id}/whatsapp/block",
            post(whatsapp_block_user),
        )
        .route(
            "/api/session/{session_id}/whatsapp/unblock",
            post(whatsapp_unblock_user),
        )
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
