//! Domain model for Automations v2 — serde shapes are the ratified wire
//! contract (docs/plans/2026-07-12-automations-v2-contract.md §1).

pub mod automation;
pub(crate) mod catalog;
pub mod condition;
pub mod form;
pub(crate) mod scope;
pub mod step;
pub mod template;
pub mod token;
pub mod trigger;
pub mod validate;

pub use automation::{AutomationCreateInput, AutomationDefinition, AutomationScope};
pub use condition::{Comparator, ConditionMatch, ConditionRow, ConditionValue, ScalarValue};
pub use form::{AutomationFormField, FormFieldType, ShowWhen};
pub use step::{
    AskAgentStep, AskMeStep, ExpectedOutput, ExpectedOutputType, IfBlock, NotifyStep, OutputAs,
    RepeatBlock, RunActionStep, Step, WorktreeSpec, find_step_by_id,
};
pub use template::{ChipPart, ChipText, chip_tokens};
pub use token::{TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER, TokenRef};
pub use trigger::{
    AutomationEventName, DailySchedule, EventTrigger, EveryNHoursSchedule, OnMissed,
    SchedulePattern, ScheduleTrigger, Trigger, WebhookPreset, WebhookTrigger, WeekdaysSchedule,
    WeeklySchedule,
};
pub use validate::{ValidationError, validate};

/// `skip_serializing_if` helper for wire-optional booleans that default false
/// (`keepGoing`).
pub(crate) fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod serde_tests;

#[cfg(test)]
mod serde_trigger_tests;

#[cfg(test)]
mod validate_tests;

/// T1.2 — the six canonical fixtures (contract §8, authored by Node Phase 0)
/// must deserialize, and re-serialize to the exact same JSON. Rust loads them
/// by relative path and never authors its own.
#[cfg(test)]
mod fixture_tests {
    use std::path::PathBuf;

    use serde_json::Value;

    use super::AutomationCreateInput;

    pub(super) const FIXTURES: [&str; 6] = [
        "daily-health-log",
        "daily-standup",
        "pr-auto-review",
        "morning-pr-sweep",
        "ship-work",
        "daily-feature-spike",
    ];

    pub(super) fn load_fixture(name: &str) -> (Value, AutomationCreateInput) {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../types/fixtures/automations")
            .join(format!("{name}.json"));
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("fixture {} must be readable: {e}", path.display()));
        let value: Value = serde_json::from_str(&raw).unwrap();
        let parsed: AutomationCreateInput = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("fixture {name} must deserialize: {e}"));
        (value, parsed)
    }

    #[test]
    fn all_six_fixtures_round_trip_losslessly() {
        for name in FIXTURES {
            let (raw, parsed) = load_fixture(name);
            let back = serde_json::to_value(&parsed).unwrap();
            assert_eq!(back, raw, "fixture {name} must re-serialize unchanged");
        }
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1-T1.2), not a TS port
// confidence: high
// todos: 0
// notes: fixture validate-clean assertion lands with validation (T1.3).
