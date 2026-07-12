//! Injected time source — schedules and the `today`/`now` builtins must be
//! testable with a frozen clock (laptops sleep; tests cannot).

use chrono::{DateTime, FixedOffset, Local};

pub trait Clock: Send + Sync {
    /// The current instant, carrying the LOCAL utc offset — `today` needs
    /// the local calendar date while `now` needs the UTC instant, and a
    /// `DateTime<FixedOffset>` serves both without a second call.
    fn now(&self) -> DateTime<FixedOffset>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<FixedOffset> {
        Local::now().fixed_offset()
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: FakeClock lives in the test modules until the testkit phase.
