//! Checkpoint entry kinds.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The `kind` of one checkpoint entry: a user-authored step kind, or one of
/// the engine's own bookkeeping markers. Stored as the plain wire string, so
/// a kind written by a newer or older daemon survives a round trip through
/// `Other` unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum AutomationStepKind {
    AskAgent,
    AskMe,
    RunAction,
    Notify,
    SetVariable,
    Wait,
    Break,
    If,
    Repeat,
    Loop,
    Retry,
    Parallel,
    /// Engine marker: one `retry` attempt's outcome.
    RetryAttempt,
    /// Engine marker: one concurrent branch's outcome.
    BranchOutcome,
    /// Engine marker: a concurrent repeat's progress watermark.
    RepeatWatermark,
    Other(String),
}

impl AutomationStepKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::AskAgent => "ask_agent",
            Self::AskMe => "ask_me",
            Self::RunAction => "run_action",
            Self::Notify => "notify",
            Self::SetVariable => "set_variable",
            Self::Wait => "wait",
            Self::Break => "break",
            Self::If => "if",
            Self::Repeat => "repeat",
            Self::Loop => "loop",
            Self::Retry => "retry",
            Self::Parallel => "parallel",
            Self::RetryAttempt => "retry_attempt",
            Self::BranchOutcome => "branch_outcome",
            Self::RepeatWatermark => "repeat_watermark",
            Self::Other(value) => value,
        }
    }

    /// True for an entry the engine wrote about itself rather than a step the
    /// automation author placed; the run timeline hides these.
    pub fn is_engine_marker(&self) -> bool {
        matches!(
            self,
            Self::RetryAttempt | Self::BranchOutcome | Self::RepeatWatermark
        )
    }
}

impl fmt::Display for AutomationStepKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<&str> for AutomationStepKind {
    fn from(value: &str) -> Self {
        match value {
            "ask_agent" => Self::AskAgent,
            "ask_me" => Self::AskMe,
            "run_action" => Self::RunAction,
            "notify" => Self::Notify,
            "set_variable" => Self::SetVariable,
            "wait" => Self::Wait,
            "break" => Self::Break,
            "if" => Self::If,
            "repeat" => Self::Repeat,
            "loop" => Self::Loop,
            "retry" => Self::Retry,
            "parallel" => Self::Parallel,
            "retry_attempt" => Self::RetryAttempt,
            "branch_outcome" => Self::BranchOutcome,
            "repeat_watermark" => Self::RepeatWatermark,
            other => Self::Other(other.to_string()),
        }
    }
}

impl From<String> for AutomationStepKind {
    fn from(value: String) -> Self {
        Self::from(value.as_str())
    }
}

impl From<AutomationStepKind> for String {
    fn from(kind: AutomationStepKind) -> Self {
        kind.as_str().to_string()
    }
}
