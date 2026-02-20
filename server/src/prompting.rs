use minijinja::{context, Environment};

const SYSTEM_PROMPT_TEMPLATE: &str = include_str!("prompts/system_prompt.j2");
const SYSTEM_PROMPT_FALLBACK_TEMPLATE: &str = include_str!("prompts/system_prompt_fallback.j2");
const AI_GROUNDING_POLICY_TEMPLATE: &str = include_str!("prompts/ai_grounding_policy.j2");
const AI_USER_CONTENT_TEMPLATE: &str = include_str!("prompts/ai_user_content.j2");
const AI_JSON_FORMAT_HINT_TEMPLATE: &str = include_str!("prompts/ai_json_format_hint.j2");
const AI_JSON_FORMAT_HINT_TOOLS_TEMPLATE: &str =
    include_str!("prompts/ai_json_format_hint_tools.j2");
const AI_JSON_FORMAT_HINT_BASIC_TEMPLATE: &str =
    include_str!("prompts/ai_json_format_hint_basic.j2");
const FLOW_AI_FALLBACK_PROMPT_TEMPLATE: &str = include_str!("prompts/flow_ai_fallback_prompt.j2");
const EXTRACT_VARS_SYSTEM_TEMPLATE: &str = include_str!("prompts/extract_vars_system.j2");
const EXTRACT_VARS_USER_TEMPLATE: &str = include_str!("prompts/extract_vars_user.j2");
const RERANK_SYSTEM_TEMPLATE: &str = include_str!("prompts/rerank_system.j2");
const RERANK_USER_TEMPLATE: &str = include_str!("prompts/rerank_user.j2");
const TOOLS_BLOCK_TEMPLATE: &str = include_str!("prompts/tools_block.j2");
const KB_BLOCK_TEMPLATE: &str = include_str!("prompts/kb_block.j2");

pub struct SystemPromptContext<'a> {
    pub workspace_name: &'a str,
    pub bot_name: &'a str,
    pub workspace_personality: &'a str,
    pub flow_prompt: &'a str,
    pub tools_block: &'a str,
}

pub struct AiUserContentContext<'a> {
    pub contact_block: &'a str,
    pub kb_block: &'a str,
    pub transcript: &'a str,
    pub visitor_text: &'a str,
    pub json_format_hint: &'a str,
}

pub struct ExtractVarsUserContext<'a> {
    pub contact_block: &'a str,
    pub transcript: &'a str,
    pub visitor_text: &'a str,
    pub var_list: &'a str,
}

pub struct RerankUserContext<'a> {
    pub query: &'a str,
    pub docs: &'a str,
}

pub struct ToolsBlockContext<'a> {
    pub tools_list: &'a str,
}

pub struct KbBlockContext<'a> {
    pub kb_context: &'a str,
}

fn render_with<F>(template_name: &str, template: &str, build_ctx: F) -> Option<String>
where
    F: FnOnce() -> minijinja::Value,
{
    let mut env = Environment::new();
    if env.add_template(template_name, template).is_err() {
        return None;
    }
    let Ok(t) = env.get_template(template_name) else {
        return None;
    };
    t.render(build_ctx()).ok()
}

pub fn render_system_prompt(ctx: &SystemPromptContext<'_>) -> String {
    render_with("system_prompt", SYSTEM_PROMPT_TEMPLATE, || {
        context! {
            workspace_name => ctx.workspace_name,
            bot_name => ctx.bot_name,
            workspace_personality => ctx.workspace_personality,
            flow_prompt => ctx.flow_prompt,
            tools_block => ctx.tools_block,
            has_tools => !ctx.tools_block.trim().is_empty(),
        }
    })
    .unwrap_or_else(|| fallback_system_prompt(ctx))
}

pub fn render_ai_grounding_policy() -> String {
    render_with("ai_grounding_policy", AI_GROUNDING_POLICY_TEMPLATE, || context! {})
        .unwrap_or_else(|| AI_GROUNDING_POLICY_TEMPLATE.to_string())
}

pub fn render_ai_json_format_hint(has_tools: bool) -> String {
    render_with("ai_json_format_hint", AI_JSON_FORMAT_HINT_TEMPLATE, || {
        context! {
            has_tools => has_tools,
        }
    })
    .unwrap_or_else(|| {
        if has_tools {
            AI_JSON_FORMAT_HINT_TOOLS_TEMPLATE.to_string()
        } else {
            AI_JSON_FORMAT_HINT_BASIC_TEMPLATE.to_string()
        }
    })
}

pub fn render_ai_user_content(ctx: &AiUserContentContext<'_>) -> String {
    render_with("ai_user_content", AI_USER_CONTENT_TEMPLATE, || {
        context! {
            contact_block => ctx.contact_block,
            kb_block => ctx.kb_block,
            transcript => ctx.transcript,
            visitor_text => ctx.visitor_text,
            json_format_hint => ctx.json_format_hint,
        }
    })
    .unwrap_or_else(|| {
        [
            ctx.contact_block,
            ctx.kb_block,
            ctx.transcript,
            ctx.visitor_text,
            ctx.json_format_hint,
        ]
        .join("\n")
    })
}

pub fn render_flow_ai_fallback_prompt() -> String {
    render_with(
        "flow_ai_fallback_prompt",
        FLOW_AI_FALLBACK_PROMPT_TEMPLATE,
        || context! {},
    )
    .unwrap_or_else(|| FLOW_AI_FALLBACK_PROMPT_TEMPLATE.to_string())
}

pub fn render_extract_vars_system_prompt() -> String {
    render_with("extract_vars_system", EXTRACT_VARS_SYSTEM_TEMPLATE, || context! {})
        .unwrap_or_else(|| EXTRACT_VARS_SYSTEM_TEMPLATE.to_string())
}

pub fn render_extract_vars_user_prompt(ctx: &ExtractVarsUserContext<'_>) -> String {
    render_with("extract_vars_user", EXTRACT_VARS_USER_TEMPLATE, || {
        context! {
            contact_block => ctx.contact_block,
            transcript => ctx.transcript,
            visitor_text => ctx.visitor_text,
            var_list => ctx.var_list,
        }
    })
    .unwrap_or_else(|| {
        [
            ctx.contact_block,
            ctx.transcript,
            ctx.visitor_text,
            ctx.var_list,
        ]
        .join("\n")
    })
}

pub fn render_rerank_system_prompt() -> String {
    render_with("rerank_system", RERANK_SYSTEM_TEMPLATE, || context! {})
        .unwrap_or_else(|| RERANK_SYSTEM_TEMPLATE.to_string())
}

pub fn render_rerank_user_prompt(ctx: &RerankUserContext<'_>) -> String {
    render_with("rerank_user", RERANK_USER_TEMPLATE, || {
        context! {
            query => ctx.query,
            docs => ctx.docs,
        }
    })
    .unwrap_or_else(|| [ctx.query, ctx.docs].join("\n"))
}

pub fn render_tools_block(ctx: &ToolsBlockContext<'_>) -> String {
    render_with("tools_block", TOOLS_BLOCK_TEMPLATE, || {
        context! {
            tools_list => ctx.tools_list,
        }
    })
    .unwrap_or_else(|| ctx.tools_list.to_string())
}

pub fn render_kb_block(ctx: &KbBlockContext<'_>) -> String {
    render_with("kb_block", KB_BLOCK_TEMPLATE, || {
        context! {
            kb_context => ctx.kb_context,
            has_kb_context => !ctx.kb_context.trim().is_empty(),
        }
    })
    .unwrap_or_else(|| ctx.kb_context.to_string())
}

fn fallback_system_prompt(ctx: &SystemPromptContext<'_>) -> String {
    render_with("system_prompt_fallback", SYSTEM_PROMPT_FALLBACK_TEMPLATE, || {
        context! {
            workspace_name => ctx.workspace_name,
            bot_name => ctx.bot_name,
            workspace_personality => ctx.workspace_personality,
            flow_prompt => ctx.flow_prompt,
            tools_block => ctx.tools_block,
            has_tools => !ctx.tools_block.trim().is_empty(),
        }
    })
    .unwrap_or_else(|| "Prompt rendering failed".to_string())
}
