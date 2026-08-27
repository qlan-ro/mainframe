//! Ported from `src/commands/registry.ts`.

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
mod tests {
    use super::*;

    #[test]
    fn exposes_the_launch_config_command() {
        let commands = get_mainframe_commands();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "launch-config");
        assert_eq!(commands[0].source, "mainframe");
        assert!(commands[0].prompt_template.is_some());
    }

    #[test]
    fn finds_a_command_by_name() {
        assert!(find_mainframe_command("launch-config").is_some());
        assert!(find_mainframe_command("nope").is_none());
    }

    #[test]
    fn prompt_file_is_loaded_whole() {
        let prompt = &get_mainframe_commands()[0].prompt_template.clone().unwrap();
        assert!(prompt.starts_with("Analyze this project and generate a .mainframe/launch.json"));
        assert!(prompt.contains("```json"));
        assert!(
            prompt
                .trim_end()
                .ends_with("only override what's necessary to run correctly.")
        );
    }

    /// The rules the launcher actually enforces (`mainframe-launch`). Each was absent
    /// from the original prompt and each produced configs that validate and then fail.
    #[test]
    fn prompt_states_the_runtime_rules() {
        let prompt = &get_mainframe_commands()[0].prompt_template.clone().unwrap();
        for rule in [
            "There is no `cwd` field",
            "${VAR:-default}",
            "the STRING \"1\"",
            "gates readiness",
        ] {
            assert!(prompt.contains(rule), "prompt no longer states: {rule}");
        }
    }

    /// The prompt predated variable expansion and told the model a string port was
    /// invalid; `parse_launch_config` accepts `"${PORT:-3000}"`. Guard the correction.
    #[test]
    fn prompt_does_not_forbid_string_ports() {
        let prompt = &get_mainframe_commands()[0].prompt_template.clone().unwrap();
        assert!(!prompt.contains("NOT a string"));
        assert!(prompt.contains("\"${PORT:-3000}\""));
    }
}

// PORT STATUS: src/commands/registry.ts (92 lines)
// confidence: high
// todos: 0
// notes: LAUNCH_CONFIG_PROMPT now lives in prompts/launch-config.md and is pulled
// in with include_str!; the body no longer matches the TS verbatim — it was
// rewritten against `mainframe-launch`'s parser and process manager, which had
// drifted from it (string ports, optional url, the executable "allowlist", the
// env-key rule). MAINFRAME_COMMANDS is rebuilt per call (CustomCommand owns
// Strings) — behaviorally identical to the module-level const the callers read.
// No TS test existed; coverage here anchors the file load and the runtime rules.
