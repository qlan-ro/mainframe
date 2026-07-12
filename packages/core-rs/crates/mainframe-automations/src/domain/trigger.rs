//! When-triggers (contract §1): `schedule | event | webhook` (manual is
//! implicit — every automation can be run by hand).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Trigger {
    Schedule(ScheduleTrigger),
    Event(EventTrigger),
    Webhook(WebhookTrigger),
}

impl Trigger {
    pub fn id(&self) -> &str {
        match self {
            Trigger::Schedule(t) => &t.id,
            Trigger::Event(t) => &t.id,
            Trigger::Webhook(t) => &t.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScheduleTrigger {
    pub id: String,
    pub schedule: SchedulePattern,
    pub on_missed: OnMissed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SchedulePattern {
    Daily(DailySchedule),
    Weekdays(WeekdaysSchedule),
    Weekly(WeeklySchedule),
    EveryNHours(EveryNHoursSchedule),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DailySchedule {
    /// Local wall-clock time, `HH:MM`.
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeekdaysSchedule {
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeeklySchedule {
    /// Days of week, 0 = Sunday … 6 = Saturday.
    pub days: Vec<u8>,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EveryNHoursSchedule {
    /// The picker offers only divisors of 24 (contract §1).
    pub n: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnMissed {
    RunOnce,
    Skip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutomationEventName {
    #[serde(rename = "session.finished")]
    SessionFinished,
    #[serde(rename = "automation.finished")]
    AutomationFinished,
    #[serde(rename = "automation.failed")]
    AutomationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventTrigger {
    pub id: String,
    pub event: AutomationEventName,
    /// For `automation.finished`/`automation.failed`: which automation to watch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
}

/// Server-side match predicate a webhook trigger opts into (contract §4).
/// GitHub PR opened/merged are webhook presets, NOT event triggers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookPreset {
    GithubPrOpened,
    GithubPrMerged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebhookTrigger {
    pub id: String,
    pub hook_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<WebhookPreset>,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: tagged enums wrap per-kind structs so deny_unknown_fields fires
//        (enum-level deny is inert on internally tagged enums).
