//! Domain model for Automations v2 — serde shapes are the ratified wire
//! contract (docs/plans/2026-07-12-automations-v2-contract.md §1).

pub mod automation;
pub mod condition;
pub mod form;
pub mod step;
pub mod template;
pub mod token;
pub mod trigger;

pub use automation::{AutomationCreateInput, AutomationDefinition, AutomationScope};
pub use condition::{Comparator, ConditionMatch, ConditionRow, ConditionValue, ScalarValue};
pub use form::{AutomationFormField, FormFieldType, ShowWhen};
pub use step::{
    AskAgentStep, AskMeStep, ExpectedOutput, ExpectedOutputType, IfBlock, NotifyStep, OutputAs,
    RepeatBlock, RunActionStep, Step, WorktreeSpec,
};
pub use template::{ChipPart, ChipText, chip_tokens};
pub use token::{TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER, TokenRef};
pub use trigger::{
    AutomationEventName, DailySchedule, EventTrigger, EveryNHoursSchedule, OnMissed,
    SchedulePattern, ScheduleTrigger, Trigger, WebhookPreset, WebhookTrigger, WeekdaysSchedule,
    WeeklySchedule,
};

/// `skip_serializing_if` helper for wire-optional booleans that default false
/// (`keepGoing`, `required`).
pub(crate) fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod serde_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: fixture conformance test (T1.2) and validation (T1.3) extend this module.
