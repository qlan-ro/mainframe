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
