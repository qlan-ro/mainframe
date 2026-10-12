//! The validator's view of action outputs, read from the launch action
//! manifests, plus the friendly output labels used in error messages.
//!
//! This is `domain`'s one dependency on `actions`, and it is on static data
//! only: `known_manifest` reads a table of plain manifest functions and never
//! builds an action or its HTTP client. The manifests stay in the action
//! modules, next to the input structs their params describe, so that an
//! action's params, schema and editor fields are declared in one place.

use crate::actions::{ActionOutputType, known_manifest};

use super::scope::TokenType;

impl From<ActionOutputType> for TokenType {
    fn from(output_type: ActionOutputType) -> Self {
        match output_type {
            ActionOutputType::Text => TokenType::Text,
            ActionOutputType::Number => TokenType::Number,
            ActionOutputType::List => TokenType::List,
            ActionOutputType::Record => TokenType::Object,
        }
    }
}

/// Named outputs for an action id: an `mcp:*` tool yields `{result: text}`
/// (contract §5); unknown ids produce nothing, so the ref checker reports
/// their tokens as unavailable.
pub(crate) fn action_outputs(action_id: &str) -> Vec<(String, TokenType)> {
    if action_id.starts_with("mcp:") {
        return vec![("result".to_string(), TokenType::Text)];
    }
    known_manifest(action_id)
        .map(|manifest| {
            manifest
                .outputs
                .iter()
                .map(|output| (output.name.clone(), output.output_type.into()))
                .collect()
        })
        .unwrap_or_default()
}

/// camelCase output name → friendly label for error messages (same table as
/// `OUTPUT_LABELS` in packages/types/src/automation-domain/tokens.ts).
pub(crate) fn output_label(name: &str) -> String {
    match name {
        "output" => "Output".to_string(),
        "exitCode" => "Exit code".to_string(),
        "content" => "File text".to_string(),
        "status" => "Status".to_string(),
        "body" => "Response".to_string(),
        "prUrl" => "PR URL".to_string(),
        "prNumber" => "PR number".to_string(),
        "prs" => "Open PRs".to_string(),
        "pageUrl" => "Page URL".to_string(),
        "workItemId" => "Work item ID".to_string(),
        "url" => "URL".to_string(),
        "result" => "Result".to_string(),
        other => capitalize(other),
    }
}

pub(crate) fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
