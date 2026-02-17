use std::{
    collections::{HashMap, HashSet},
    sync::atomic::AtomicUsize,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub sender: String,
    pub text: String,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub widget: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub tenant_id: String,
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatMessage>,
    pub channel: String,
    pub assignee_agent_id: Option<String>,
    pub inbox_id: Option<String>,
    pub team_id: Option<String>,
    pub flow_id: Option<String>,
    pub contact_id: Option<String>,
    pub visitor_id: String,
    pub handover_active: bool,
    pub status: String,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub tenant_id: String,
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_message: Option<ChatMessage>,
    pub message_count: usize,
    pub channel: String,
    pub assignee_agent_id: Option<String>,
    pub inbox_id: Option<String>,
    pub team_id: Option<String>,
    pub flow_id: Option<String>,
    pub contact_id: Option<String>,
    pub handover_active: bool,
    pub status: String,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CannedReply {
    pub tenant_id: String,
    pub id: String,
    pub title: String,
    pub shortcut: String,
    pub category: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub email: String,
    pub status: String,
    pub team_ids: Vec<String>,
    pub inbox_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub tenant_id: String,
    pub id: String,
    pub name: String,
    pub agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub tenant_id: String,
    pub id: String,
    pub name: String,
    pub channels: Vec<String>,
    pub agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationNote {
    pub tenant_id: String,
    pub id: String,
    pub session_id: String,
    pub agent_id: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFlow {
    pub tenant_id: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
    #[serde(default)]
    pub input_variables: Vec<FlowInputVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowInputVariable {
    pub key: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub position: FlowPosition,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPosition {
    pub x: f64,
    pub y: f64,
}

impl Default for FlowPosition {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub source_handle: Option<String>,
    #[serde(default)]
    pub target_handle: Option<String>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tenant {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantSettings {
    pub tenant_id: String,
    pub brand_name: String,
    pub primary_color: String,
    pub accent_color: String,
    pub logo_url: String,
    pub privacy_url: String,
    pub launcher_position: String,
    pub welcome_text: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub tenant_id: String,
    pub display_name: String,
    pub email: String,
    pub phone: String,
    pub external_id: String,
    pub metadata: Value,
    pub company: String,
    pub location: String,
    pub avatar_url: String,
    pub last_seen_at: String,
    pub browser: String,
    pub os: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactAttribute {
    pub id: String,
    pub contact_id: String,
    pub attribute_key: String,
    pub attribute_value: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAttribute {
    pub id: String,
    pub session_id: String,
    pub attribute_key: String,
    pub attribute_value: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsatSurvey {
    pub id: String,
    pub tenant_id: String,
    pub session_id: String,
    pub score: i32,
    pub comment: String,
    pub submitted_at: String,
}

#[derive(Default)]
pub struct RealtimeState {
    pub clients: HashMap<usize, mpsc::UnboundedSender<String>>,
    pub agents: HashSet<usize>,
    pub session_watchers: HashMap<String, HashSet<usize>>,
    pub watched_session: HashMap<usize, String>,
    pub agent_auto_typing_counts: HashMap<String, usize>,
    pub agent_human_typers: HashMap<String, HashSet<usize>>,
    pub agent_human_typing_session: HashMap<usize, String>,
    pub visitor_typing_session: HashMap<usize, String>,
}

pub struct AppState {
    pub db: PgPool,
    pub default_flow_id: String,
    pub default_tenant_id: String,
    pub realtime: Mutex<RealtimeState>,
    pub next_client_id: AtomicUsize,
    pub ai_client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageBody {
    pub sender: Option<String>,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterBody {
    pub name: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBody {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamBody {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInboxBody {
    pub name: String,
    pub channels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignBody {
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAssigneeBody {
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChannelBody {
    pub channel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInboxBody {
    pub inbox_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTeamBody {
    pub team_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteBody {
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFlowBody {
    pub flow_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandoverBody {
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTenantBody {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchTenantSettingsBody {
    pub brand_name: Option<String>,
    pub primary_color: Option<String>,
    pub accent_color: Option<String>,
    pub logo_url: Option<String>,
    pub privacy_url: Option<String>,
    pub launcher_position: Option<String>,
    pub welcome_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContactBody {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub external_id: Option<String>,
    pub metadata: Option<Value>,
    pub company: Option<String>,
    pub location: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchContactBody {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub external_id: Option<String>,
    pub metadata: Option<Value>,
    pub company: Option<String>,
    pub location: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagBody {
    pub name: String,
    #[serde(default = "default_tag_color")]
    pub color: String,
}

fn default_tag_color() -> String {
    "#6366f1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAttributeDefinition {
    pub id: String,
    pub tenant_id: String,
    pub display_name: String,
    pub key: String,
    pub description: String,
    pub attribute_model: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttributeDefBody {
    pub display_name: String,
    pub key: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_attr_model")]
    pub attribute_model: String,
}

fn default_attr_model() -> String {
    "contact".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAttributeDefBody {
    pub display_name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTagBody {
    pub tag_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContactBody {
    pub contact_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAttributeBody {
    pub attribute_key: String,
    pub attribute_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCsatBody {
    pub score: i32,
    pub comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetaBody {
    pub status: Option<String>,
    pub priority: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCannedReplyBody {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub shortcut: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCannedReplyBody {
    pub title: Option<String>,
    pub body: Option<String>,
    pub shortcut: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFlowBody {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub nodes: Vec<FlowNode>,
    #[serde(default)]
    pub edges: Vec<FlowEdge>,
    #[serde(default)]
    pub input_variables: Vec<FlowInputVariable>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFlowBody {
    pub name: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub nodes: Option<Vec<FlowNode>>,
    pub edges: Option<Vec<FlowEdge>>,
    pub input_variables: Option<Vec<FlowInputVariable>>,
}

#[derive(Debug, Deserialize)]
pub struct EventEnvelopeIn {
    pub event: String,
    #[serde(default)]
    pub data: Value,
}
