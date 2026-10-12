use super::*;

fn fork_source(last_turn_id: Option<&str>) -> ForkSource {
    ForkSource {
        source_session_id: "parent-thread".to_string(),
        resume_path: None,
        last_turn_id: last_turn_id.map(str::to_string),
    }
}

// ---- resolve_thread_target ----

#[test]
fn own_id_with_no_fork_source_resumes_plainly() {
    assert_eq!(
        resolve_thread_target(Some("own-id"), false, None),
        ThreadTarget::Resume("own-id".to_string())
    );
}

#[test]
fn own_id_with_fork_source_and_transcript_present_resumes_plainly() {
    let source = fork_source(Some("turn-1"));
    assert_eq!(
        resolve_thread_target(Some("own-id"), true, Some(&source)),
        ThreadTarget::Resume("own-id".to_string())
    );
}

#[test]
fn no_own_id_with_fork_source_forks() {
    let source = fork_source(Some("turn-1"));
    assert_eq!(
        resolve_thread_target(None, false, Some(&source)),
        ThreadTarget::Fork {
            source_id: "parent-thread".to_string(),
            last_turn_id: Some("turn-1".to_string()),
        }
    );
}

#[test]
fn own_id_with_fork_source_and_missing_transcript_falls_back_to_fork() {
    let source = fork_source(None);
    assert_eq!(
        resolve_thread_target(Some("own-id"), false, Some(&source)),
        ThreadTarget::Fork {
            source_id: "parent-thread".to_string(),
            last_turn_id: None,
        }
    );
}

#[test]
fn no_own_id_and_no_fork_source_starts_fresh() {
    assert_eq!(
        resolve_thread_target(None, false, None),
        ThreadTarget::Start
    );
}

// ---- fork_supported ----

#[test]
fn fork_supported_below_at_and_above_the_floor() {
    assert!(!fork_supported("0.142.9"));
    assert!(fork_supported("0.143.0"));
    assert!(fork_supported("0.155.1"));
    assert!(fork_supported("0.143.0-beta"));
}

#[test]
fn fork_supported_is_false_for_an_unparsable_version() {
    assert!(!fork_supported(""));
    assert!(!fork_supported("not-a-version"));
    assert!(!fork_supported("0.143"));
}

// ---- fork_unavailable_reason_for ----

#[test]
fn reason_is_none_when_version_unknown_or_supported() {
    assert_eq!(fork_unavailable_reason_for(None), None);
    assert_eq!(fork_unavailable_reason_for(Some("0.155.1")), None);
}

#[test]
fn reason_names_the_floor_and_installed_version_when_below_it() {
    assert_eq!(
        fork_unavailable_reason_for(Some("0.140.0")),
        Some(
            "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.140.0)".to_string()
        )
    );
}
