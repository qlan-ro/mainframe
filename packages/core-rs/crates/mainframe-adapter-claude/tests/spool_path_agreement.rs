//! Red-phase (todo #338, Task 2): pins that the Claude adapter's recorded
//! task-output path, `spool_root()`, and the production-default spool
//! validator all agree — the acceptance criterion "asserted in one test
//! rather than three independent constant checks."
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use mainframe_adapter_claude::task_events::{ClaudeTaskEvents, TaskStartedCtx, TaskStartedPayload};
use mainframe_background_tasks::encoding::encode_cwd_segment;
use mainframe_background_tasks::spool_root::spool_root;
use mainframe_background_tasks::spool_validator::{
    Platform, SpoolValidator, SpoolValidatorDeps, make_spool_validator,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;

fn oracle_uid() -> u32 {
    let output = Command::new("id").arg("-u").output().unwrap();
    String::from_utf8(output.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn base_tmp_dir() -> String {
    std::env::var("CLAUDE_CODE_TMPDIR").unwrap_or_else(|_| "/tmp".into())
}

/// Cleans up the encoded-cwd segment this test writes under the real CLI spool
/// root, even if an assertion panics.
struct RemoveDirOnDrop(PathBuf);
impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn recorded_task_output_path_is_accepted_by_the_default_validator() {
    let uid = oracle_uid();
    if uid == 0 {
        // Running as root: `claude-0` is the correct root and this test is meaningless.
        return;
    }

    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let events = ClaudeTaskEvents::new(tracker.clone(), store);

    let cwd_dir = tempfile::TempDir::new().unwrap();
    let real_cwd = cwd_dir.path().to_string_lossy().into_owned();

    // Constructed before anything is written — a no-op cleanup if a later
    // assertion panics before the spool directory is ever created.
    let _cleanup = RemoveDirOnDrop(spool_root().join(encode_cwd_segment(&real_cwd)));

    events.handle_task_started(
        "chat-agree",
        TaskStartedPayload {
            task_id: "task-agree".to_string(),
            tool_use_id: None,
            description: None,
            task_type: None,
            workflow_name: None,
        },
        TaskStartedCtx {
            claude_session_id: "sess-agree".to_string(),
            real_cwd,
        },
    );

    let task = tracker.get("chat-agree", "task-agree").unwrap();
    let output_path = task.output_path.unwrap();

    let root_str = spool_root().to_string_lossy().into_owned();
    assert!(output_path.starts_with(root_str.as_str()));

    let base = base_tmp_dir();
    assert!(output_path.starts_with(&format!("{base}/claude-{uid}/")));

    let output_path_buf = PathBuf::from(&output_path);
    std::fs::create_dir_all(output_path_buf.parent().unwrap()).unwrap();
    std::fs::write(&output_path_buf, b"agreement").unwrap();

    // Exactly the production default `routes/background_tasks.rs` builds — no
    // injected uid, no spool-root override.
    let validator = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::current(),
        getuid: None,
        env: std::env::vars().collect(),
        realpath: None,
        tmpdir: None,
    });
    assert!(validator.validate(&output_path, "task-agree").await);
}
