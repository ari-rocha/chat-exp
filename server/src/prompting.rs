use minijinja::{context, Environment};

const SYSTEM_PROMPT_TEMPLATE: &str = include_str!("prompts/system_prompt.j2");

pub struct SystemPromptContext<'a> {
    pub workspace_name: &'a str,
    pub bot_name: &'a str,
    pub workspace_personality: &'a str,
    pub flow_prompt: &'a str,
    pub tools_block: &'a str,
}

pub fn render_system_prompt(ctx: &SystemPromptContext<'_>) -> String {
    let mut env = Environment::new();
    if env
        .add_template("system_prompt", SYSTEM_PROMPT_TEMPLATE)
        .is_err()
    {
        return fallback_system_prompt(ctx);
    }

    let Ok(template) = env.get_template("system_prompt") else {
        return fallback_system_prompt(ctx);
    };

    template
        .render(context! {
            workspace_name => ctx.workspace_name,
            bot_name => ctx.bot_name,
            workspace_personality => ctx.workspace_personality,
            flow_prompt => ctx.flow_prompt,
            tools_block => ctx.tools_block,
            has_tools => !ctx.tools_block.trim().is_empty(),
        })
        .unwrap_or_else(|_| fallback_system_prompt(ctx))
}

fn fallback_system_prompt(ctx: &SystemPromptContext<'_>) -> String {
    let mut prompt = format!(
        "You are {} for workspace \"{}\".\n\
         Follow the global policy: be accurate, concise, safe, and practical. Never invent facts.\n\
         If user requests a human, transfer, escalation, or representative, set handover=true.\n\
         If the conversation is clearly complete and resolved, set closeChat=true.\n",
        if ctx.bot_name.trim().is_empty() {
            "Support Bot"
        } else {
            ctx.bot_name.trim()
        },
        if ctx.workspace_name.trim().is_empty() {
            "workspace"
        } else {
            ctx.workspace_name.trim()
        }
    );

    if !ctx.workspace_personality.trim().is_empty() {
        prompt.push_str("\nWorkspace personality:\n");
        prompt.push_str(ctx.workspace_personality.trim());
        prompt.push('\n');
    }

    if !ctx.flow_prompt.trim().is_empty() {
        prompt.push_str("\nFlow/route instructions:\n");
        prompt.push_str(ctx.flow_prompt.trim());
        prompt.push('\n');
    }

    if !ctx.tools_block.trim().is_empty() {
        prompt.push('\n');
        prompt.push_str(ctx.tools_block.trim());
        prompt.push('\n');
    }

    prompt
}
