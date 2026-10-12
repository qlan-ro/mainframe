use mainframe_types::command::CustomCommand;

/// Prompt bodies live in `prompts/` as Markdown, not inline: they are prose that is
/// reviewed and edited like documentation, and a 70-line string literal in the middle of
/// the registry hides the code. `include_str!` keeps them compiled in, so the binary
/// stays self-contained.
const LAUNCH_CONFIG_PROMPT: &str = include_str!("prompts/launch-config.md");

fn mainframe_commands() -> Vec<CustomCommand> {
    vec![CustomCommand {
        name: "launch-config".to_string(),
        description: "Generate .mainframe/launch.json for this project".to_string(),
        source: "mainframe".to_string(),
        prompt_template: Some(LAUNCH_CONFIG_PROMPT.to_string()),
    }]
}

pub fn get_mainframe_commands() -> Vec<CustomCommand> {
    mainframe_commands()
}

pub fn find_mainframe_command(name: &str) -> Option<CustomCommand> {
    mainframe_commands().into_iter().find(|c| c.name == name)
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
