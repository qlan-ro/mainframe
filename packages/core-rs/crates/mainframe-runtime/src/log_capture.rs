//! Captures `tracing` events emitted while a `#[tokio::test]` body runs, so
//! tests can assert on structured fields instead of formatted message strings.
//!
//! Install with `tracing::subscriber::set_default` (NOT `set_global_default`,
//! which is process-wide and would fight parallel tests) and keep the guard
//! alive for the duration of the awaited call. `#[tokio::test]` runs a
//! current-thread runtime, so the thread-local dispatcher covers everything
//! awaited in the test body — but a `tokio::spawn`ed task runs on its own
//! dispatcher context and its events will NOT be captured.
//!
//! Shared by `mainframe-chat` and `mainframe-server` test modules; both crates
//! already depend on `mainframe-runtime`, so this lives here instead of being
//! duplicated per crate.

use std::sync::{Arc, Mutex};

struct ReasonVisitor(Option<String>);

impl tracing::field::Visit for ReasonVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "reason" {
            self.0 = Some(value.to_string());
        }
    }
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "reason" {
            self.0 = Some(format!("{value:?}"));
        }
    }
}

/// One captured event: its level, and the `reason` field it carried (if any).
type CapturedEvents = Arc<Mutex<Vec<(tracing::Level, Option<String>)>>>;

pub struct LogCapture {
    events: CapturedEvents,
}

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for LogCapture {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = ReasonVisitor(None);
        event.record(&mut visitor);
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((*event.metadata().level(), visitor.0));
    }
}

impl LogCapture {
    pub fn install() -> (impl tracing::Subscriber, CapturedEvents) {
        use tracing_subscriber::layer::SubscriberExt;
        let events = Arc::new(Mutex::new(Vec::new()));
        let layer = LogCapture {
            events: events.clone(),
        };
        (tracing_subscriber::registry().with(layer), events)
    }

    /// Captured events that carried a `reason` field, dropping any other
    /// daemon logging so unrelated lines don't perturb the count.
    pub fn events_with_reason(events: &CapturedEvents) -> Vec<(tracing::Level, String)> {
        events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter_map(|(level, reason)| reason.clone().map(|r| (*level, r)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::LogCapture;

    #[test]
    fn log_capture_records_one_event_with_its_reason_field() {
        let (subscriber, events) = LogCapture::install();
        let _guard = tracing::subscriber::set_default(subscriber);
        tracing::debug!(reason = "probe", "x");
        let captured = LogCapture::events_with_reason(&events);
        assert_eq!(captured, vec![(tracing::Level::DEBUG, "probe".to_string())]);
    }
}
