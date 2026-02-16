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
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    created_at: String,
    updated_at: String,
    last_message: Option<ChatMessage>,
    message_count: usize,
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
    realtime: Mutex<RealtimeState>,
    next_client_id: AtomicUsize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageBody {
    sender: Option<String>,
    text: String,
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
    }
}

fn event_payload<T: Serialize>(event: &str, data: T) -> Option<String> {
    serde_json::to_string(&json!({ "event": event, "data": data })).ok()
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
    let recipients = {
        let rt = state.realtime.lock().await;
        let mut ids = HashSet::new();
        if let Some(watchers) = rt.session_watchers.get(session_id) {
            ids.extend(watchers.iter().copied());
        }
        ids.extend(rt.agents.iter().copied());
        ids.into_iter().collect::<Vec<_>>()
    };

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
            };
            sessions.insert(session_id.to_string(), session.clone());
            session
        }
    };

    if created {
        emit_session_snapshot(state.clone()).await;
        spawn_welcome_sequence(state, session_id.to_string());
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

fn spawn_welcome_sequence(state: Arc<AppState>, session_id: String) {
    let messages = ["Hello!", "This is a demo.", "Have a wonderful day 😊"];

    for (index, text) in messages.into_iter().enumerate() {
        let state_clone = state.clone();
        let session_clone = session_id.clone();
        tokio::spawn(async move {
            start_agent_typing(state_clone.clone(), &session_clone).await;
            tokio::time::sleep(Duration::from_millis(600 + (index as u64 * 900))).await;
            let _ = add_message(state_clone.clone(), &session_clone, "agent", text).await;
            stop_agent_typing(state_clone, &session_clone).await;
        });
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

    if sender == "visitor" && body.text.trim().eq_ignore_ascii_case("okay") {
        let state_clone = state.clone();
        let session_clone = session_id.clone();
        tokio::spawn(async move {
            start_agent_typing(state_clone.clone(), &session_clone).await;
            tokio::time::sleep(Duration::from_millis(900)).await;
            let _ = add_message(state_clone.clone(), &session_clone, "agent", "Glad I could help!").await;
            stop_agent_typing(state_clone, &session_clone).await;
        });
    }

    (StatusCode::CREATED, Json(json!({ "message": message }))).into_response()
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
                {
                    let mut rt = state.realtime.lock().await;
                    rt.agents.insert(client_id);
                }
                emit_session_snapshot(state.clone()).await;
            }
            "widget:message" => {
                let session_id = envelope.data.get("sessionId").and_then(Value::as_str);
                let text = envelope.data.get("text").and_then(Value::as_str);
                if let (Some(session_id), Some(text)) = (session_id, text) {
                    let _ = ensure_session(state.clone(), session_id).await;
                    let _ = add_message(state.clone(), session_id, "visitor", text).await;
                    if text.trim().eq_ignore_ascii_case("okay") {
                        let state_clone = state.clone();
                        let session_clone = session_id.to_string();
                        tokio::spawn(async move {
                            start_agent_typing(state_clone.clone(), &session_clone).await;
                            tokio::time::sleep(Duration::from_millis(900)).await;
                            let _ =
                                add_message(state_clone.clone(), &session_clone, "agent", "Glad I could help!")
                                    .await;
                            stop_agent_typing(state_clone, &session_clone).await;
                        });
                    }
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

    let state = Arc::new(AppState {
        sessions: RwLock::new(HashMap::new()),
        realtime: Mutex::new(RealtimeState::default()),
        next_client_id: AtomicUsize::new(0),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/session", post(post_session))
        .route("/api/sessions", get(get_sessions))
        .route("/api/session/{session_id}/messages", get(get_messages))
        .route("/api/session/{session_id}/message", post(post_message))
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
