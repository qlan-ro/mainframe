//! Pull request detection from a session's shell commands and tool results.
//! It is adapter-neutral, so it lives next to the `SessionSink` trait it
//! decorates rather than inside one adapter crate. The workspace has no
//! `regex` crate, so every pattern is hand-rolled; the doc comments give the
//! equivalent regular expression.

mod command;
mod history;
mod live;
mod parse;
mod sink;
mod text;

pub use command::{is_pr_create_command, is_pr_mutation_command, parse_pr_identifier_from_args};
pub use history::scan_history_for_prs;
pub use parse::{
    extract_pr_from_tool_result, parse_azure_pr_url, parse_gitlab_mr_url, parse_pr_url,
};
pub use sink::PrDetectionSink;

use mainframe_types::adapter::{DetectedPr, DetectedPrSource};

/// A parsed PR before it is classified as created or mentioned: what the
/// parsers return and what a pending mutation command stashes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPrCore {
    pub url: String,
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

impl DetectedPrCore {
    pub(crate) fn with_source(self, source: DetectedPrSource) -> DetectedPr {
        DetectedPr {
            url: self.url,
            owner: self.owner,
            repo: self.repo,
            number: self.number,
            source,
        }
    }
}

/// Whether `tool` is the shell tool whose `command` input PR detection reads.
fn is_shell_tool(tool: &str) -> bool {
    tool == "Bash" || tool == "BashTool"
}
