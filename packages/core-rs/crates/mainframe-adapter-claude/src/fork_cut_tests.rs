//! Fixture tests for `fork_cut::prefix_len_before_message`, and for
//! `fork::pin_fork_point` when it is given a cut.

use super::*;
use crate::fork::pin_fork_point;
use mainframe_adapter_api::{ForkCut, ForkPinRequest};
use std::path::Path;

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

const SUMMARY: &str = r#"{"type":"summary","summary":"t","leafUuid":"a1"}"#;
const PROMPT_1: &str =
    r#"{"type":"user","uuid":"u1","parentUuid":null,"message":{"role":"user","content":"first"}}"#;
const REPLY_1: &str = r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"role":"assistant","content":[{"type":"text","text":"one"}]}}"#;
const PROMPT_2: &str =
    r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":"second"}}"#;
const REPLY_2: &str = r#"{"type":"assistant","uuid":"a2","parentUuid":"u2","message":{"role":"assistant","content":[{"type":"text","text":"two"}]}}"#;

fn transcript(lines: &[&str]) -> String {
    lines.iter().map(|l| format!("{l}\n")).collect()
}

fn reason(err: ForkPinError) -> String {
    match err {
        ForkPinError::PointNotFound(reason) => reason,
        other => panic!("expected PointNotFound, got {other:?}"),
    }
}

#[test]
fn the_prefix_ends_right_before_the_matching_prompt() {
    let text = transcript(&[PROMPT_1, REPLY_1, PROMPT_2, REPLY_2]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, REPLY_1]));
}

#[test]
fn a_sidechain_line_with_the_same_uuid_is_skipped() {
    let sidechain = r#"{"type":"user","uuid":"u2","isSidechain":true,"message":{"role":"user","content":"sub"}}"#;
    let text = transcript(&[PROMPT_1, REPLY_1, sidechain, PROMPT_2]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, REPLY_1, sidechain]));
}

#[test]
fn a_meta_line_with_the_same_uuid_is_skipped() {
    let meta =
        r#"{"type":"user","uuid":"u2","isMeta":true,"message":{"role":"user","content":"caveat"}}"#;
    let text = transcript(&[PROMPT_1, REPLY_1, meta, PROMPT_2]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, REPLY_1, meta]));
}

#[test]
fn a_tool_result_line_with_the_same_uuid_is_skipped() {
    let result = r#"{"type":"user","uuid":"u2","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#;
    let text = transcript(&[PROMPT_1, REPLY_1, result, PROMPT_2]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, REPLY_1, result]));
}

#[test]
fn a_prompt_with_text_and_tool_results_still_starts_a_turn() {
    let mixed = r#"{"type":"user","uuid":"u2","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"},{"type":"text","text":"and"}]}}"#;
    let text = transcript(&[PROMPT_1, REPLY_1, mixed]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, REPLY_1]));
}

#[test]
fn an_attachment_match_is_the_joined_a_turn_refusal() {
    let queued = r#"{"type":"attachment","uuid":"u2","parentUuid":"a1","attachment":{"type":"queued_command","prompt":"second"}}"#;
    let text = transcript(&[PROMPT_1, REPLY_1, queued]);
    let err = prefix_len_before_message(text.as_bytes(), "u2").unwrap_err();
    assert_eq!(reason(err), JOINED_TURN_REASON);
}

#[test]
fn no_match_is_point_not_found() {
    let text = transcript(&[PROMPT_1, REPLY_1]);
    let err = prefix_len_before_message(text.as_bytes(), "missing").unwrap_err();
    assert_eq!(reason(err), FORK_CUT_NOT_FOUND_REASON);
}

#[test]
fn a_prefix_with_no_chain_entry_is_point_not_found() {
    // Only a summary line precedes the first prompt: resuming that would hold
    // no conversation at all.
    let text = transcript(&[SUMMARY, PROMPT_1, REPLY_1]);
    let err = prefix_len_before_message(text.as_bytes(), "u1").unwrap_err();
    assert_eq!(reason(err), FORK_CUT_NOT_FOUND_REASON);
}

#[test]
fn unparseable_lines_are_carried_through_the_prefix() {
    let text = transcript(&[PROMPT_1, "not json", REPLY_1, PROMPT_2]);
    let len = prefix_len_before_message(text.as_bytes(), "u2").unwrap();
    assert_eq!(&text[..len], transcript(&[PROMPT_1, "not json", REPLY_1]));
}

// ---- pin_fork_point with a cut (fork from a message) ----

const CUT_TRANSCRIPT: &str = concat!(
    r#"{"type":"user","uuid":"u1","message":{"role":"user","content":"first"}}"#,
    "\n",
    r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"role":"assistant","content":"one"}}"#,
    "\n",
    r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":"second"}}"#,
    "\n",
);

fn cut_request(source: &Path, dest: &Path, vendor_message_id: &str) -> ForkPinRequest {
    ForkPinRequest {
        source_session_id: "parent-session".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(source.to_string_lossy().to_string()),
        dest_dir: dest.to_string_lossy().to_string(),
        cut: Some(ForkCut {
            vendor_message_id: vendor_message_id.to_string(),
        }),
    }
}

#[tokio::test]
async fn pin_with_a_cut_copies_only_the_prefix_and_leaves_the_parent_untouched() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, CUT_TRANSCRIPT);

    let result = pin_fork_point(cut_request(&source_path, dest_dir.path(), "u2"))
        .await
        .unwrap();
    let copied = std::fs::read_to_string(result.resume_path.unwrap()).unwrap();
    let expected_len = CUT_TRANSCRIPT
        .find(r#"{"type":"user","uuid":"u2""#)
        .unwrap();
    assert_eq!(copied, CUT_TRANSCRIPT[..expected_len]);
    assert_eq!(
        std::fs::read_to_string(&source_path).unwrap(),
        CUT_TRANSCRIPT
    );
}

#[tokio::test]
async fn pin_with_a_cut_still_copies_the_subagents_directory() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, CUT_TRANSCRIPT);
    let subagent = project_dir
        .path()
        .join("parent-session")
        .join("subagents")
        .join("agent-1.jsonl");
    write_file(&subagent, "{\"type\":\"assistant\"}\n");

    pin_fork_point(cut_request(&source_path, dest_dir.path(), "u2"))
        .await
        .unwrap();
    assert!(
        dest_dir
            .path()
            .join("parent-session")
            .join("subagents")
            .join("agent-1.jsonl")
            .exists()
    );
}

#[tokio::test]
async fn pin_with_an_unknown_cut_is_point_not_found() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, CUT_TRANSCRIPT);

    let err = pin_fork_point(cut_request(&source_path, dest_dir.path(), "nope"))
        .await
        .unwrap_err();
    assert!(matches!(err, ForkPinError::PointNotFound(_)));
}

#[tokio::test]
async fn pin_with_a_cut_at_the_first_prompt_is_point_not_found() {
    let project_dir = tempfile::tempdir().unwrap();
    let dest_dir = tempfile::tempdir().unwrap();
    let source_path = project_dir.path().join("parent-session.jsonl");
    write_file(&source_path, CUT_TRANSCRIPT);

    let err = pin_fork_point(cut_request(&source_path, dest_dir.path(), "u1"))
        .await
        .unwrap_err();
    assert!(matches!(err, ForkPinError::PointNotFound(_)));
}
