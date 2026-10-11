use super::*;
use crate::lsof::{ExecFn, ExecOk, set_exec_for_tests};
use crate::tracker::TaskEvent;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use tempfile::{TempDir, tempdir};
use tokio::sync::broadcast;

// Chat has ~30 fields (most serde-defaulted optionals); build from JSON with
// only the required fields + the two reconcile reads.
fn make_chat(claude_session_id: &str, worktree_path: Option<&str>, project_id: &str) -> Chat {
    let mut v = serde_json::json!({
        "id": format!("chat-{claude_session_id}"),
        "adapterId": "claude",
        "projectId": project_id,
        "claudeSessionId": claude_session_id,
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

struct MockDb {
    chats: Vec<Chat>,
    project_path: String,
}
impl ReconcileDb for MockDb {
    fn chats_list_all(&self) -> Vec<Chat> {
        self.chats.clone()
    }
    fn project_path(&self, _id: &str) -> Option<String> {
        Some(self.project_path.clone())
    }
}

struct AlwaysValid;
impl SpoolValidator for AlwaysValid {
    fn validate<'a>(
        &'a self,
        _output_path: &'a str,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async { true })
    }
}

struct RecordingValidator {
    result: bool,
    calls: Arc<Mutex<Vec<(String, String)>>>,
}
impl SpoolValidator for RecordingValidator {
    fn validate<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        self.calls
            .lock()
            .unwrap()
            .push((output_path.to_string(), task_id.to_string()));
        let r = self.result;
        Box::pin(async move { r })
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
    /// Place `${root}/<cwdSeg>/<sess>/tasks/<file>` as a real file, returning its path.
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
    set_exec_for_tests(&tracker.process, lsof_exec(pids));
}

fn lsof_exec(pids: &'static [u32]) -> ExecFn {
    Arc::new(move |_c, _a| {
        let mut stdout = String::new();
        for p in pids {
            stdout.push_str(&format!("p{p}\naw\nn/p\n"));
        }
        Box::pin(async move { Ok(ExecOk { stdout }) })
    })
}

/// lsof exec that returns `pids` as writers only when the queried path
/// contains `needle` (so it's independent of nondeterministic walk order).
fn set_lsof_writers_for_path(
    tracker: &BackgroundTaskTracker,
    needle: &'static str,
    pids: &'static [u32],
) {
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_cmd, args: Vec<String>| {
            let path = args.last().cloned().unwrap_or_default();
            let mut stdout = String::new();
            if path.contains(needle) {
                for p in pids {
                    stdout.push_str(&format!("p{p}\naw\nn/p\n"));
                }
            }
            Box::pin(async move { Ok(ExecOk { stdout }) })
        }),
    );
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

mod hydration;
