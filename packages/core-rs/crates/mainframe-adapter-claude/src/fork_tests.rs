//! Tests for `fork.rs` — moved out to keep that file under the 300-line
//! ceiling once the from-message cut landed beside the whole-chat pin.

use super::*;
use std::io::Write;

fn fork_source(path: &str) -> ForkSource {
    ForkSource {
        source_session_id: "parent-session".to_string(),
        resume_path: Some(path.to_string()),
        last_turn_id: None,
    }
}

// ---- resolve_resume ----

#[test]
fn own_id_with_transcript_present_resumes_plainly() {
    let source = fork_source("/snap/parent-session.jsonl");
    assert_eq!(
        resolve_resume(Some("own-id"), true, Some(&source)),
        ResumeTarget::Own("own-id".to_string())
    );
}

#[test]
fn no_own_id_uses_the_fork_source() {
    let source = fork_source("/snap/parent-session.jsonl");
    assert_eq!(
        resolve_resume(None, false, Some(&source)),
        ResumeTarget::Fork("/snap/parent-session.jsonl".to_string())
    );
}

#[test]
fn own_id_with_missing_transcript_falls_back_to_fork_source() {
    let source = fork_source("/snap/parent-session.jsonl");
    assert_eq!(
        resolve_resume(Some("own-id"), false, Some(&source)),
        ResumeTarget::Fork("/snap/parent-session.jsonl".to_string())
    );
}

#[test]
fn no_own_id_and_no_fork_source_is_fresh() {
    assert_eq!(resolve_resume(None, false, None), ResumeTarget::Fresh);
}

/// Existing (pre-#343) behavior: a regular chat with a stored session id
/// and no pending fork always resumes plainly, even when the transcript
/// presence probe says no — that probe only gates the fork-source arms.
/// The CLI is responsible for failing loudly if `own-id` turns out to be
/// unresumable; Mainframe must not silently start a fresh session over
/// the top of it.
#[test]
fn own_id_present_with_no_fork_source_resumes_plainly_regardless_of_transcript_presence() {
    assert_eq!(
        resolve_resume(Some("own-id"), false, None),
        ResumeTarget::Own("own-id".to_string())
    );
}

/// The parent's own session id must never surface as a bare `--resume`
/// value: `ResumeTarget::Own` only ever carries `own_id`, and the only
/// value a `ForkSource` can produce is `resume_path` (the snapshot), never
/// `source_session_id` itself. Exhaustive over every combination of the
/// three inputs a caller can supply.
#[test]
fn resolver_never_surfaces_the_parent_session_id_as_a_bare_resume_value() {
    let source = fork_source("/snap/parent-session.jsonl");
    for own_id in [None, Some("own-id"), Some("parent-session")] {
        for own_present in [false, true] {
            for source_opt in [None, Some(&source)] {
                let target = resolve_resume(own_id, own_present, source_opt);
                match target {
                    ResumeTarget::Own(id) => {
                        // Only reachable when an own id was actually supplied.
                        // With no fork source, an own id resumes plainly
                        // regardless of transcript presence (existing
                        // behavior); with a fork source pending, it only
                        // wins once its own transcript is confirmed present.
                        assert_eq!(Some(id.as_str()), own_id);
                        assert!(source_opt.is_none() || own_present);
                    }
                    ResumeTarget::Fork(path) => {
                        // Never the bare parent session id — always the pinned
                        // snapshot path, and always paired with --fork-session
                        // by build_args.
                        assert_ne!(path, "parent-session");
                        assert_eq!(Some(path.as_str()), source.resume_path.as_deref());
                    }
                    ResumeTarget::Fresh => {}
                }
            }
        }
    }
}

// ---- pin_fork_point ----

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(contents.as_bytes()).unwrap();
}

#[tokio::test]
async fn pin_copies_the_transcript_verbatim() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(
        &source_path,
        "{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n",
    );

    let request = ForkPinRequest {
        source_session_id: "parent-session".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(source_path.to_string_lossy().to_string()),
        dest_dir: dest_dir.path().to_string_lossy().to_string(),
        cut: None,
    };
    let result = pin_fork_point(request).await.unwrap();
    assert_eq!(result.source_session_id, "parent-session");
    let dest_path = result.resume_path.unwrap();
    let copied = std::fs::read_to_string(&dest_path).unwrap();
    assert_eq!(copied, "{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n");
}

#[tokio::test]
async fn pin_trims_a_trailing_partial_line() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(
        &source_path,
        "{\"type\":\"user\"}\n{\"type\":\"assistant\", \"partial",
    );

    let request = ForkPinRequest {
        source_session_id: "parent-session".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(source_path.to_string_lossy().to_string()),
        dest_dir: dest_dir.path().to_string_lossy().to_string(),
        cut: None,
    };
    let result = pin_fork_point(request).await.unwrap();
    let copied = std::fs::read_to_string(result.resume_path.unwrap()).unwrap();
    assert_eq!(copied, "{\"type\":\"user\"}\n");
}

#[tokio::test]
async fn pin_copies_the_subagents_directory_when_present() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, "{\"type\":\"user\"}\n");
    let subagent_file = project_dir
        .path()
        .join("parent-session")
        .join("subagents")
        .join("agent-1.jsonl");
    write_file(&subagent_file, "{\"type\":\"assistant\"}\n");

    let request = ForkPinRequest {
        source_session_id: "parent-session".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(source_path.to_string_lossy().to_string()),
        dest_dir: dest_dir.path().to_string_lossy().to_string(),
        cut: None,
    };
    pin_fork_point(request).await.unwrap();

    let copied_subagent = dest_dir
        .path()
        .join("parent-session")
        .join("subagents")
        .join("agent-1.jsonl");
    assert_eq!(
        std::fs::read_to_string(copied_subagent).unwrap(),
        "{\"type\":\"assistant\"}\n"
    );
}

#[tokio::test]
async fn pin_omits_subagents_when_absent() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, "{\"type\":\"user\"}\n");

    let request = ForkPinRequest {
        source_session_id: "parent-session".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(source_path.to_string_lossy().to_string()),
        dest_dir: dest_dir.path().to_string_lossy().to_string(),
        cut: None,
    };
    pin_fork_point(request).await.unwrap();
    assert!(
        !dest_dir
            .path()
            .join("parent-session")
            .join("subagents")
            .exists()
    );
}

#[tokio::test]
async fn pin_maps_a_missing_transcript_to_transcript_missing() {
    let dest_dir = tempfile::tempdir().unwrap();
    let request = ForkPinRequest {
        source_session_id: "no-such-session".to_string(),
        cwd: "/nonexistent/project".to_string(),
        session_file_path: Some("/nonexistent/path.jsonl".to_string()),
        dest_dir: dest_dir.path().to_string_lossy().to_string(),
        cut: None,
    };
    assert_eq!(
        pin_fork_point(request).await.unwrap_err(),
        ForkPinError::TranscriptMissing
    );
}
