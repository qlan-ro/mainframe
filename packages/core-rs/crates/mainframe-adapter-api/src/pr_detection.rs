//! The TS module leans on JS regexes; the Rust workspace has no `regex` crate in
//! the allowlist (mirroring `mainframe-adapter-api::parse_version`), so every
//! pattern here is hand-rolled. The pure-function tests port assertion-for-
//! assertion; the `.test()` boolean checks map to `parse_*(...).is_some()`.
//!
//! Moved here from `mainframe-adapter-claude::pr_detection` for todo #339: PR
//! detection is adapter-neutral, so it lives next to the `SessionSink` trait it
//! will decorate rather than inside one adapter crate.

pub mod command;
pub mod history;
pub mod live;
pub mod parse;
mod sink;
mod text;

pub use command::{
    ToolUseMeta, is_pr_create_command, is_pr_mutation_command, parse_pr_identifier_from_args,
    should_scan_tool_result_for_pr,
};
pub use history::scan_history_for_prs;
pub use live::LivePrScanner;
pub use parse::{
    extract_pr_from_tool_result, parse_azure_pr_url, parse_gitlab_mr_url, parse_pr_url,
};
pub use sink::PrDetectionSink;

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
