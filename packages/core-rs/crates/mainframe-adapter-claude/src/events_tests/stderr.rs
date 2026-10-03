use super::*;
#[test]
fn stderr_routes_fatal_with_not_trusted_to_error() {
    let s = session_at("/p", Arc::new(BackgroundTaskTracker::new()));
    let sink = RecordingSink::default();
    handle_stderr(
        &s,
        b"FatalError: this workspace has not been trusted and the process crashed unexpectedly",
        &sink,
    );
    assert_eq!(sink.r().errors, 1);
    assert!(sink.r().trust.is_empty());
}

#[test]
fn stderr_filters_informational_and_empty() {
    let s = session();
    let sink = RecordingSink::default();
    handle_stderr(&s, b"Warning: some deprecation\n", &sink);
    handle_stderr(&s, b"   \n", &sink);
    assert_eq!(sink.r().errors, 0);
}

#[test]
fn stderr_emits_error_for_non_informational() {
    let s = session();
    let sink = RecordingSink::default();
    handle_stderr(&s, b"Something went wrong\n", &sink);
    assert_eq!(sink.r().errors, 1);
}

#[test]
fn stderr_routes_untrusted_advisory_to_trust_required() {
    let s = session_at("/home/me/proj", Arc::new(BackgroundTaskTracker::new()));
    let sink = RecordingSink::default();
    handle_stderr(
        &s,
        b"Ignoring 4 permissions.allow entries from .claude/settings.local.json: this workspace has not been trusted. Run Claude Code interactively here once...",
        &sink,
    );
    assert_eq!(sink.r().trust, vec!["/home/me/proj".to_string()]);
    assert_eq!(sink.r().errors, 0);
}
