//! T6.4 — files.append / files.write / files.read: create-or-append,
//! truncate, text/lines read, `~` expansion, contract §5 outputs.

use serde_json::json;

use crate::tokens::TokenValue;

use super::files::{FilesAppendAction, FilesReadAction, FilesWriteAction};
use super::manifest::{ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, expand_user_path};

fn ctx() -> ActionCtx {
    ActionCtx {
        creds: None,
        credential_label: None,
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

#[tokio::test]
async fn append_creates_then_appends_with_no_outputs() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("log/health.md");
    let path_str = path.to_string_lossy().into_owned();

    let action = FilesAppendAction;
    let outputs = action
        .execute(&json!({"path": path_str, "content": "one\n"}), &ctx())
        .await
        .unwrap();
    assert!(outputs.is_empty(), "files.append has no outputs");

    action
        .execute(&json!({"path": path_str, "content": "two\n"}), &ctx())
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\n");
}

#[tokio::test]
async fn write_truncates_with_no_outputs() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.txt");
    let path_str = path.to_string_lossy().into_owned();

    let action = FilesWriteAction;
    action
        .execute(
            &json!({"path": path_str, "content": "a much longer first body"}),
            &ctx(),
        )
        .await
        .unwrap();
    let outputs = action
        .execute(&json!({"path": path_str, "content": "short"}), &ctx())
        .await
        .unwrap();
    assert!(outputs.is_empty(), "files.write has no outputs");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "short");
}

#[tokio::test]
async fn read_returns_raw_content_as_text() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("in.txt");
    std::fs::write(&path, " raw body \nwith newline\n").unwrap();

    let outputs = FilesReadAction
        .execute(&json!({"path": path.to_string_lossy()}), &ctx())
        .await
        .unwrap();
    assert_eq!(
        outputs["content"],
        TokenValue::Text(" raw body \nwith newline\n".to_string()),
        "text read is raw — no trimming"
    );
}

#[tokio::test]
async fn read_lines_trims_and_drops_blanks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("list.txt");
    std::fs::write(&path, "a\n b \n\nc\n").unwrap();

    let outputs = FilesReadAction
        .execute(
            &json!({"path": path.to_string_lossy(), "outputAs": "lines"}),
            &ctx(),
        )
        .await
        .unwrap();
    assert_eq!(
        outputs["content"],
        TokenValue::List(vec![
            TokenValue::Text("a".to_string()),
            TokenValue::Text("b".to_string()),
            TokenValue::Text("c".to_string()),
        ])
    );
}

#[tokio::test]
async fn read_missing_file_fails_loudly() {
    let err = FilesReadAction
        .execute(&json!({"path": "/nonexistent/nope.txt"}), &ctx())
        .await
        .unwrap_err();
    assert!(
        err.0.contains("/nonexistent/nope.txt"),
        "error names the path: {}",
        err.0
    );
}

#[tokio::test]
async fn unknown_fields_are_rejected() {
    let err = FilesWriteAction
        .execute(
            &json!({"path": "/tmp/x", "content": "c", "mode": "0777"}),
            &ctx(),
        )
        .await
        .unwrap_err();
    assert!(err.0.contains("invalid input for 'files.write'"));
}

#[test]
fn tilde_expands_to_home() {
    let home = dirs::home_dir().unwrap();
    assert_eq!(expand_user_path("~"), home);
    assert_eq!(
        expand_user_path("~/notes/log.md"),
        home.join("notes/log.md")
    );
    // `~user` and mid-string `~` are NOT expanded (Node parity: only a
    // leading `~` / `~/` is).
    assert_eq!(
        expand_user_path("/data/~backup"),
        std::path::PathBuf::from("/data/~backup")
    );
    // Absolute paths pass through untouched.
    assert_eq!(
        expand_user_path("/var/log/x.txt"),
        std::path::PathBuf::from("/var/log/x.txt")
    );
    // Relative paths resolve against the process cwd (path.resolve parity).
    let cwd = std::env::current_dir().unwrap();
    assert_eq!(expand_user_path("rel/file.txt"), cwd.join("rel/file.txt"));
}

#[test]
fn manifests_match_contract() {
    let append = FilesAppendAction.manifest();
    assert_eq!(append.id, "files.append");
    assert!(append.outputs.is_empty());
    assert!(!append.idempotent);

    // Truncating write is restart-safe: blindly re-running it converges on
    // the same file body (Node ships idempotent: true).
    let write = FilesWriteAction.manifest();
    assert_eq!(write.id, "files.write");
    assert!(write.outputs.is_empty());
    assert!(write.idempotent);

    let read = FilesReadAction.manifest();
    assert_eq!(read.id, "files.read");
    assert_eq!(
        read.outputs,
        vec![ActionOutput::new("content", ActionOutputType::Text)]
    );
    assert!(read.idempotent);
}
