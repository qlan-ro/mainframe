use super::*;
use crate::lsof::{LsofFn, set_lsof_for_tests};
use crate::tracker::TaskEvent;
use std::sync::Arc;
use tempfile::{TempDir, tempdir};
use tokio::sync::broadcast;

// Build from JSON so only the required fields and the ones reconcile reads
// need spelling out.
fn make_chat(vendor_session_id: &str, worktree_path: Option<&str>, project_id: &str) -> Chat {
    let mut v = serde_json::json!({
        "id": format!("chat-{vendor_session_id}"),
        "adapterId": "claude",
        "projectId": project_id,
        "claudeSessionId": vendor_session_id,
        "status": "active",
        "createdAt": "2026-07-08T00:00:00.000Z",
        "updatedAt": "2026-07-08T00:00:00.000Z",
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
    });
    if let Some(wt) = worktree_path {
        v["worktreePath"] = wt.into();
    }
    serde_json::from_value(v).unwrap()
}

/// Every chat in `chats` lives in one project at `project_path`.
fn snapshot(chats: Vec<Chat>, project_path: &str) -> ReconcileSnapshot {
    ReconcileSnapshot {
        chats,
        project_paths: HashMap::from([("p1".to_string(), project_path.to_string())]),
    }
}

/// A real spool tree rooted at a temp dir, with a real project dir.
struct Spool {
    _spool: TempDir,
    _project: TempDir,
    root: String,
    project_path: String,
    encoded_project: String,
}

fn new_spool() -> Spool {
    let spool = tempdir().unwrap();
    let project = tempdir().unwrap();
    let real_project = std::fs::canonicalize(project.path()).unwrap();
    let encoded = encode_cwd_segment(&real_project.to_string_lossy());
    Spool {
        root: spool.path().to_string_lossy().into_owned(),
        project_path: project.path().to_string_lossy().into_owned(),
        encoded_project: encoded,
        _spool: spool,
        _project: project,
    }
}

impl Spool {
    /// Write `<root>/<cwd_seg>/<sess>/tasks/<file>`, returning its path.
    fn place_file(&self, cwd_seg: &str, sess: &str, file: &str) -> String {
        let tasks = std::path::Path::new(&self.root)
            .join(cwd_seg)
            .join(sess)
            .join("tasks");
        std::fs::create_dir_all(&tasks).unwrap();
        let fp = tasks.join(file);
        std::fs::write(&fp, b"output-bytes").unwrap();
        fp.to_string_lossy().into_owned()
    }
    fn place_symlink(&self, cwd_seg: &str, sess: &str, file: &str) -> String {
        let tasks = std::path::Path::new(&self.root)
            .join(cwd_seg)
            .join(sess)
            .join("tasks");
        std::fs::create_dir_all(&tasks).unwrap();
        let target = std::path::Path::new(&self.root).join("target.txt");
        std::fs::write(&target, b"x").unwrap();
        let fp = tasks.join(file);
        std::os::unix::fs::symlink(&target, &fp).unwrap();
        fp.to_string_lossy().into_owned()
    }
}

fn set_lsof_writers(tracker: &BackgroundTaskTracker, pids: &'static [u32]) {
    set_lsof_writers_for_path(tracker, "", pids);
}

/// Report `pids` as writers only for paths containing `needle`, so a test
/// doesn't depend on the walk order.
fn set_lsof_writers_for_path(
    tracker: &BackgroundTaskTracker,
    needle: &'static str,
    pids: &'static [u32],
) {
    let lsof: LsofFn = Arc::new(move |path| {
        let mut stdout = String::new();
        if path.contains(needle) {
            for p in pids {
                stdout.push_str(&format!("p{p}\naw\nn/p\n"));
            }
        }
        Box::pin(async move { Ok(stdout) })
    });
    set_lsof_for_tests(&tracker.process, lsof);
}

fn drain(rx: &mut broadcast::Receiver<TaskEvent>) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        match ev {
            TaskEvent::Started { chat_id, task } => {
                out.push(("started".to_string(), chat_id, task.id))
            }
            TaskEvent::Updated { chat_id, task } => {
                out.push(("updated".to_string(), chat_id, task.id))
            }
            TaskEvent::Ended { chat_id, task } => out.push(("ended".to_string(), chat_id, task.id)),
        }
    }
    out
}

#[path = "reconcile_tests_hydration.rs"]
mod hydration;
