use mainframe_types::adapter::EffortLevel;

use super::{DEFAULT_CONTEXT_WINDOW, EXTENDED_CONTEXT_WINDOW};

// Effort ladders, named for the rung they reach. The CLI gates them with three
// capability flags — `effort` (low/medium/high), `max_effort`, `xhigh_effort` —
// so read a model's ladder off that registry, never off its family: Sonnet 5
// carries `xhigh_effort` and Opus 4.6 does not.
const EFFORTS_TO_XHIGH: &[EffortLevel] = &[
    EffortLevel::Low,
    EffortLevel::Medium,
    EffortLevel::High,
    EffortLevel::Xhigh,
    EffortLevel::Max,
];
const EFFORTS_TO_MAX: &[EffortLevel] = &[
    EffortLevel::Low,
    EffortLevel::Medium,
    EffortLevel::High,
    EffortLevel::Max,
];
const EFFORTS_TO_HIGH: &[EffortLevel] = &[EffortLevel::Low, EffortLevel::Medium, EffortLevel::High];

pub(super) struct ModelSpec {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) description: Option<&'static str>,
    pub(super) context_window: i64,
    pub(super) efforts: &'static [EffortLevel],
    /// Verified `/fast` capability from the CLI registry.
    pub(super) fast: bool,
    /// Adaptive thinking — Claude 4.6 and later.
    pub(super) adaptive: bool,
}

/// Fallback entries; `default` inherits the configured CLI model.
pub(super) const CURRENT_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "default",
        label: "Use CLI setting",
        description: Some("Let Claude Code choose the model."),
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-5-5",
        label: "Opus 5.5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-5",
        label: "Opus 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-fable-5-1",
        label: "Fable 5.1",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-fable-5",
        label: "Fable 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-sonnet-5-5",
        label: "Sonnet 5.5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-haiku-5-5",
        label: "Haiku 5.5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-haiku-4-5-20251001",
        label: "Haiku 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
];

/// Models the API still serves that the CLI's picker hides. Checked against
/// <https://platform.claude.com/docs/en/about-claude/model-deprecations> on
/// 2026-07-29 — a retired id must never appear here, the API answers it with a
/// 404. Windows and effort ladders come from the CLI's own model registry
/// (v2.1.220): Opus 4.8 and 4.7 are `native_1m`, everything below them is 200k
/// unless asked for with the `[1m]` suffix.
pub(super) const OLDER_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "claude-opus-4-8",
        label: "Opus 4.8",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-7",
        label: "Opus 4.7",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-6",
        label: "Opus 4.6",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_MAX,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_MAX,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-5-20251101",
        label: "Opus 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_HIGH,
        fast: false,
        adaptive: false,
    },
    ModelSpec {
        id: "claude-sonnet-4-5-20250929",
        label: "Sonnet 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
    ModelSpec {
        id: "claude-opus-4-1-20250805",
        label: "Opus 4.1",
        description: Some("Retires August 5, 2026"),
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
];
