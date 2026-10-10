//! Reusable port fakes for automations tests, shared by the crate's unit
//! tests and, behind the `testkit` feature, by integration tests and other
//! crates. They implement the real public port traits, so a suite drives the
//! genuine engine and only the outside world (clock, chats, notifications,
//! projects, the event bus) is faked. Recording fakes let each scenario
//! assert what actually reached a boundary.
mod agent;

use std::sync::Mutex;

use chrono::{DateTime, FixedOffset};
use mainframe_types::BoxFuture;
use mainframe_types::sync::LockExt as _;

use crate::ports::{
    AutomationEvent, Clock, EventSink, InteractionSummary, Notification, Notifier, NotifyError,
    ProjectRegistry, RunSummary,
};

pub use agent::FakeAgentPort;

/// A frozen clock so the `today`/`now` builtins and every deadline are
/// deterministic. `Default` is `2026-07-12T10:00:00+00:00`.
pub struct FakeClock(pub DateTime<FixedOffset>);

impl FakeClock {
    /// The instant `rfc3339` names, keeping its offset as the local zone.
    pub fn at(rfc3339: &str) -> Result<Self, chrono::ParseError> {
        DateTime::parse_from_rfc3339(rfc3339).map(Self)
    }
}

impl Default for FakeClock {
    fn default() -> Self {
        // 2026-07-12T10:00:00Z; the fallback is unreachable for this constant.
        let instant = DateTime::from_timestamp(1_783_850_400, 0).unwrap_or_default();
        Self(instant.fixed_offset())
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<FixedOffset> {
        self.0
    }
}

/// Captures every engine event so a scenario can assert an interaction row was
/// created, a run streamed, or a completion fanned out.
#[derive(Default)]
pub struct CollectingSink {
    pub events: Mutex<Vec<AutomationEvent>>,
}

impl EventSink for CollectingSink {
    fn emit(&self, event: AutomationEvent) {
        self.events.lock_recover().push(event);
    }
}

impl CollectingSink {
    fn collect<T>(&self, pick: impl Fn(&AutomationEvent) -> Option<T>) -> Vec<T> {
        self.events.lock_recover().iter().filter_map(pick).collect()
    }

    pub fn run_updates(&self) -> Vec<RunSummary> {
        self.collect(|event| match event {
            AutomationEvent::RunUpdated { run } => Some(run.clone()),
            _ => None,
        })
    }

    pub fn interactions_created(&self) -> Vec<InteractionSummary> {
        self.collect(|event| match event {
            AutomationEvent::InteractionCreated { interaction } => Some(interaction.clone()),
            _ => None,
        })
    }

    /// `(interactionId, runId)` pairs from `automation.interaction.resolved`.
    pub fn interactions_resolved(&self) -> Vec<(String, String)> {
        self.collect(|event| match event {
            AutomationEvent::InteractionResolved {
                interaction_id,
                run_id,
            } => Some((interaction_id.clone(), run_id.clone())),
            _ => None,
        })
    }
}

/// Records every notification pushed; `failing()` makes each push fail after
/// recording it, as a dead push channel would.
#[derive(Default)]
pub struct FakeNotifier {
    pub sent: Mutex<Vec<Notification>>,
    fail: bool,
}

impl FakeNotifier {
    pub fn failing() -> Self {
        Self {
            fail: true,
            ..Self::default()
        }
    }

    pub fn bodies(&self) -> Vec<String> {
        self.sent
            .lock_recover()
            .iter()
            .map(|n| n.body.clone())
            .collect()
    }
}

impl Notifier for FakeNotifier {
    fn notify(&self, notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        self.sent.lock_recover().push(notification);
        let fail = self.fail;
        Box::pin(async move {
            if fail {
                Err(NotifyError("push channel down".to_string()))
            } else {
                Ok(())
            }
        })
    }
}

/// Resolves every project to one fixed containment root (usually a tempdir).
pub struct FixedProjects(pub String);

impl ProjectRegistry for FixedProjects {
    fn resolve_project_root<'a>(&'a self, _project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        let root = self.0.clone();
        Box::pin(async move { root })
    }
}

#[cfg(test)]
mod tests {
    use super::{Clock, FakeClock};

    #[test]
    fn the_default_clock_reads_the_documented_instant() {
        assert_eq!(
            FakeClock::default().now().to_rfc3339(),
            "2026-07-12T10:00:00+00:00"
        );
        assert_eq!(
            FakeClock::at("2026-07-12T21:30:00+02:00")
                .unwrap()
                .now()
                .to_rfc3339(),
            "2026-07-12T21:30:00+02:00"
        );
    }
}
