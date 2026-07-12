//! Ported from `packages/types/src/command.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCommand {
    /// Command name without the leading slash.
    pub name: String,
    /// Short description shown in the popover.
    pub description: String,
    /// Origin: adapter id (e.g. 'claude') or 'mainframe'.
    pub source: String,
    /// Mainframe commands only — prompt sent to the model.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_template: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omits_prompt_template_when_absent() {
        let cmd = CustomCommand {
            name: "review".to_string(),
            description: "Review changes".to_string(),
            source: "mainframe".to_string(),
            prompt_template: None,
        };
        assert_eq!(
            serde_json::to_string(&cmd).unwrap(),
            r#"{"name":"review","description":"Review changes","source":"mainframe"}"#
        );
    }

    #[test]
    fn round_trips_with_prompt_template() {
        let json = r#"{"name":"review","description":"Review changes","source":"mainframe","promptTemplate":"Review it"}"#;
        let cmd: CustomCommand = serde_json::from_str(json).unwrap();
        assert_eq!(cmd.prompt_template.as_deref(), Some("Review it"));
        assert_eq!(serde_json::to_string(&cmd).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/command.ts (11 lines)
// confidence: high
// todos: 0
// notes: `promptTemplate?` is optional → Option + skip_serializing_if.
