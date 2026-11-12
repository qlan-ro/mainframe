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

const MODEL_NOTICE: &str =
    "[claude-code:unrecognized_model] {\"model\":\"gpt-6-astra\",\"query_source\":\"compact\"}";
const CONNECTOR_NOTICE: &str = "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors";

#[test]
fn proxy_diagnostics_do_not_fail_an_active_compaction() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({"type":"system","subtype":"status","status":"compacting"}),
    );
    handle_stderr(&s, CONNECTOR_NOTICE.as_bytes(), &sink);
    handle_stderr(&s, MODEL_NOTICE.as_bytes(), &sink);
    assert_eq!(sink.r().errors, 0);
    assert_eq!(sink.r().compact_start, 1);
    assert_eq!(sink.r().compact, 0);
    assert_eq!(sink.r().results, 0);
    assert_eq!(
        sink.r().cli_messages,
        ["Claude account connectors are unavailable while using API or proxy authentication."]
    );
    feed(
        &s,
        &sink,
        serde_json::json!({"type":"system","subtype":"compact_boundary","uuid":"compact"}),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({"type":"result","subtype":"success","is_error":false}),
    );
    assert_eq!(sink.r().compact, 1);
    assert_eq!(sink.r().results, 1);
    assert_eq!(sink.r().errors, 0);
}

#[test]
fn actual_model_errors_are_still_reported() {
    let s = session();
    let sink = RecordingSink::default();
    handle_stderr(&s, b"API Error: 400 unknown model gpt-6-astra", &sink);
    handle_stderr(&s, b"[claude-code:other_error] request failed", &sink);
    assert_eq!(sink.r().errors, 2);
}
