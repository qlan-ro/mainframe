//! Ported from `packages/core/src/plugins/builtin/claude/pr-detection.ts`.
//!
//! The TS module leans on JS regexes; the Rust workspace has no `regex` crate in
//! the allowlist (mirroring `mainframe-adapter-api::parse_version`), so every
//! pattern here is hand-rolled. The pure-function tests port assertion-for-
//! assertion; the `.test()` boolean checks map to `parse_*(...).is_some()`.
//!
//! Moved here from `mainframe-adapter-claude::pr_detection` for todo #339: PR
//! detection is adapter-neutral, so it lives next to the `SessionSink` trait it
//! will decorate rather than inside one adapter crate.

pub mod command;
pub mod parse;
mod text;

pub use command::{
    ToolUseMeta, is_pr_create_command, is_pr_mutation_command, parse_pr_identifier_from_args,
    should_scan_tool_result_for_pr,
};
pub use parse::{
    extract_pr_from_tool_result, parse_azure_pr_url, parse_gitlab_mr_url, parse_pr_url,
};

use mainframe_types::adapter::{DetectedPr, DetectedPrSource};

/// PR info without the `source` field — used as the value shape for stashed
/// mutations and as the parser return type. (`Omit<DetectedPr, 'source'>`.)
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPrCore {
    pub url: String,
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

impl DetectedPrCore {
    /// Rebuild the full `DetectedPr` (`{ ...core, source }`) — the events layer
    /// stamps `source` when emitting `onPrDetected`.
    pub fn with_source(self, source: DetectedPrSource) -> DetectedPr {
        DetectedPr {
            url: self.url,
            owner: self.owner,
            repo: self.repo,
            number: self.number,
            source,
        }
    }
}

// PORT STATUS: src/plugins/builtin/claude/pr-detection.ts (127 lines)
// confidence: high
// todos: 0
// notes: all JS regexes hand-rolled (no `regex` crate in the §8 allowlist), matching
// notes: mainframe-adapter-api::parse_version's approach. `DetectedPrCore` =
// notes: Omit<DetectedPr,'source'>. Pure-function tests ported assertion-for-assertion
// notes: from pr-detection.test.ts + pr-mutation-detection.test.ts; the `handleStdout`
// notes: integration blocks in those files belong to events.rs/user_event.rs (blocked
// notes: on the session cluster) and are NOT ported here.
// notes: moved from mainframe-adapter-claude::pr_detection to this adapter-neutral
// notes: module for todo #339 (Codex PR detection); split into text/parse/command,
// notes: unchanged matcher-for-matcher, to stay under the 300-line/file budget.
