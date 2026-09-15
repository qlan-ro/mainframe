//! The version-probe half of `partial_stream.rs`'s tests (T18, R3.20). Split
//! out of `tests.rs` (todo #350, plan task 37, R2.13) — the probe tests need
//! none of the accumulation-test fixtures (`PartialRec`, `session()`, the
//! event-shape builders), only `LogCapture` and `supports_partial_messages`.

use super::*;

// T18, R3.20: the `OnceCell` cache keyed by executable is process-global and
// shared across this whole test binary, so a probe result once cached for a
// given executable string would silently short-circuit a later test. Each
// probe test below uses its own executable string for that reason.
#[tokio::test]
async fn a_failed_probe_logs_its_downgrade() {
    let (subscriber, events) = mainframe_runtime::log_capture::LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    let executable = "mainframe-test-nonexistent-cli-a-failed-probe";

    let supported = supports_partial_messages(executable, "").await;

    assert!(!supported, "an unresolvable executable must gate to false");
    let captured = mainframe_runtime::log_capture::LogCapture::events_with_reason(&events);
    assert_eq!(
        captured,
        vec![(tracing::Level::WARN, executable.to_string())],
        "the downgrade must log a warning naming the executable"
    );
}

#[tokio::test]
async fn concurrent_callers_for_the_same_executable_share_one_probe() {
    let (subscriber, events) = mainframe_runtime::log_capture::LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    let executable = "mainframe-test-nonexistent-cli-concurrent-probe";

    let (a, b) = tokio::join!(
        supports_partial_messages(executable, ""),
        supports_partial_messages(executable, ""),
    );

    assert_eq!((a, b), (false, false));
    // Two independent probes would log two warnings; the shared `OnceCell`
    // must collapse them to exactly one.
    let captured = mainframe_runtime::log_capture::LogCapture::events_with_reason(&events);
    assert_eq!(captured.len(), 1, "expected one probe, got {captured:?}");
}
