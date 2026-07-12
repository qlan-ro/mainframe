//! Ported from `packages/core/src/background-tasks/reconcile.ts`.

use std::collections::HashMap;
use std::fs::Metadata;
use std::sync::Arc;

use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};
use mainframe_types::chat::{Chat, ChatStatus};

use crate::encoding::encode_cwd_segment;
use crate::lsof::lsof_writers;
use crate::spool_root::spool_root as default_spool_root;
use crate::spool_validator::{Platform, SpoolValidator, SpoolValidatorDeps, make_spool_validator};
use crate::spool_walker::{WalkOpts, walk_spool_tasks};
use crate::tracker::{AdoptOptions, BackgroundTaskTracker};

/// The DB surface reconcile reads — mirrors the structural TS dep
/// `{ chats: { listAll }, projects: { get } }`.
pub trait ReconcileDb: Send + Sync {
    fn chats_list_all(&self) -> Vec<Chat>;
    /// `projects.get(id)?.path`.
    fn project_path(&self, id: &str) -> Option<String>;
}

pub struct ReconcileDeps<'a> {
    pub tracker: &'a BackgroundTaskTracker,
    pub db: &'a dyn ReconcileDb,
    pub spool_root: Option<String>,
    /// Injected for tests so we don't depend on `process.getuid()` matching CI.
    pub validator: Option<Arc<dyn SpoolValidator>>,
}

pub async fn reconcile_background_tasks(deps: ReconcileDeps<'_>) {
    let spool_root = deps
        .spool_root
        .clone()
        .unwrap_or_else(|| default_spool_root().to_string_lossy().into_owned());
    reconcile_inner(&deps, &spool_root).await;
}

fn build_recovered_snapshot(
    task_id: &str,
    fp: &str,
    st: &Metadata,
    writers: &[u32],
) -> BackgroundTask {
    let running = !writers.is_empty();
    BackgroundTask {
        id: task_id.to_string(),
        kind: BackgroundWorkKind::Bash, // only bash tasks spool to disk, so only they can be recovered
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: String::new(),
        command: "<recovered>".to_string(),
        description: String::new(),
        output_path: Some(fp.to_string()),
        started_at: ctime_ms(st),
        ended_at: if running { None } else { Some(mtime_ms(st)) },
        status: if running {
            BackgroundTaskStatus::Running
        } else {
            BackgroundTaskStatus::Stopped
        },
        last_output_line: None,
        summary: if running {
            None
        } else {
            Some("recovered after daemon restart".to_string())
        },
        usage: None,
        recovered: Some(true),
    }
}

async fn reconcile_inner(deps: &ReconcileDeps<'_>, spool_root: &str) {
    let mut session_to_chat: HashMap<String, Chat> = HashMap::new();
    for chat in deps.db.chats_list_all() {
        if let Some(sid) = &chat.claude_session_id
            && chat.status != ChatStatus::Archived
        {
            session_to_chat.insert(sid.clone(), chat);
        }
    }
    if session_to_chat.is_empty() {
        return;
    }

    let validator: Arc<dyn SpoolValidator> = match &deps.validator {
        Some(v) => v.clone(),
        None => Arc::new(make_spool_validator(SpoolValidatorDeps {
            platform: Platform::current(),
            // TODO(port): getuid() needs libc/rustix (not allowlisted) — the
            // default validator computes `claude-<uid>`; production callers should
            // inject a validator until that dep lands. See spool_root.rs.
            getuid: None,
            env: std::env::vars().collect(),
            realpath: None,
            tmpdir: None,
        })),
    };

    let entries = walk_spool_tasks(&WalkOpts {
        root: spool_root.to_string(),
        scoped_cwd_seg: None,
    })
    .await;

    for entry in entries {
        let Some(chat) = session_to_chat.get(&entry.sess) else {
            continue;
        };
        let effective_path = chat
            .worktree_path
            .clone()
            .or_else(|| deps.db.project_path(&chat.project_id));
        let Some(effective_path) = effective_path else {
            continue;
        };
        let real_effective = match tokio::fs::canonicalize(&effective_path).await {
            Ok(p) => p,
            Err(_) => continue,
        };
        if encode_cwd_segment(&real_effective.to_string_lossy()) != entry.cwd_seg {
            continue;
        }

        if !validator.validate(&entry.fp, &entry.task_id).await {
            continue;
        }

        let st = match tokio::fs::symlink_metadata(&entry.fp).await {
            Ok(ls) if ls.is_file() && !ls.file_type().is_symlink() => {
                match tokio::fs::metadata(&entry.fp).await {
                    Ok(st) => st,
                    Err(_) => continue,
                }
            }
            _ => continue,
        };

        let writers = lsof_writers(&entry.fp).await;
        deps.tracker.adopt(
            &chat.id,
            build_recovered_snapshot(&entry.task_id, &entry.fp, &st, &writers),
            AdoptOptions { emit: true },
        );
        if !writers.is_empty() {
            deps.tracker.set_pid(&chat.id, &entry.task_id, writers[0]);
        }
    }
}

#[cfg(unix)]
fn ctime_ms(md: &Metadata) -> i64 {
    use std::os::unix::fs::MetadataExt;
    md.ctime() * 1000 + md.ctime_nsec() / 1_000_000
}

#[cfg(unix)]
fn mtime_ms(md: &Metadata) -> i64 {
    use std::os::unix::fs::MetadataExt;
    md.mtime() * 1000 + md.mtime_nsec() / 1_000_000
}

#[cfg(not(unix))]
fn system_time_ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok()
        .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(not(unix))]
fn ctime_ms(md: &Metadata) -> i64 {
    system_time_ms(md.created())
}

#[cfg(not(unix))]
fn mtime_ms(md: &Metadata) -> i64 {
    system_time_ms(md.modified())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsof::{ExecFn, ExecOk, set_exec_for_tests};
    use crate::seam_test_guard;
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

    fn set_lsof_writers(pids: &'static [u32]) {
        set_exec_for_tests(lsof_exec(pids));
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
    fn set_lsof_writers_for_path(needle: &'static str, pids: &'static [u32]) {
        set_exec_for_tests(Arc::new(move |_cmd, args: Vec<String>| {
            let path = args.last().cloned().unwrap_or_default();
            let mut stdout = String::new();
            if path.contains(needle) {
                for p in pids {
                    stdout.push_str(&format!("p{p}\naw\nn/p\n"));
                }
            }
            Box::pin(async move { Ok(ExecOk { stdout }) })
        }));
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
                TaskEvent::Ended { chat_id, task } => {
                    out.push(("ended".to_string(), chat_id, task.id))
                }
            }
        }
        out
    }

    #[tokio::test]
    async fn hydrates_a_running_task_when_lsof_finds_a_writer() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[777]);
        let sp = new_spool();
        let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;

        let list = tracker.list("chat-sess1");
        assert_eq!(list.len(), 1);
        let t = &list[0];
        assert_eq!(t.status, BackgroundTaskStatus::Running);
        assert_eq!(t.recovered, Some(true));
        assert_eq!(t.output_path.as_deref(), Some(fp.as_str()));
        assert_eq!(t.ended_at, None);
        // startedAt == the file's real ctime (TS asserts the mocked 1000).
        let md = std::fs::metadata(&fp).unwrap();
        assert_eq!(t.started_at, ctime_ms(&md));
        assert_eq!(tracker.get_pid("chat-sess1", "tkid01"), Some(777));
    }

    #[tokio::test]
    async fn marks_stopped_when_no_writer_ended_at_is_mtime() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        let t = tracker.list("chat-sess1").into_iter().next().unwrap();
        assert_eq!(t.status, BackgroundTaskStatus::Stopped);
        let md = std::fs::metadata(&fp).unwrap();
        assert_eq!(t.ended_at, Some(mtime_ms(&md)));
        assert_eq!(t.summary.as_deref(), Some("recovered after daemon restart"));
    }

    #[tokio::test]
    async fn emits_events_for_recovered_tasks() {
        let _guard = seam_test_guard();
        set_lsof_writers_for_path("run001", &[777]);
        let sp = new_spool();
        sp.place_file(&sp.encoded_project, "sess-running", "run001.output");
        sp.place_file(&sp.encoded_project, "sess-stopped", "stop01.output");
        let db = MockDb {
            chats: vec![
                make_chat("sess-running", None, "p1"),
                make_chat("sess-stopped", None, "p1"),
            ],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        // Walk/readdir order is not deterministic across platforms, so assert as a
        // set (TS relies on an ordered readdir mock).
        let mut events = drain(&mut rx);
        events.sort();
        assert_eq!(
            events,
            vec![
                (
                    "ended".to_string(),
                    "chat-sess-stopped".to_string(),
                    "stop01".to_string()
                ),
                (
                    "started".to_string(),
                    "chat-sess-running".to_string(),
                    "run001".to_string()
                ),
            ]
        );
    }

    #[tokio::test]
    async fn skips_unknown_claude_session_id() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        sp.place_file(&sp.encoded_project, "sess-other", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess-known", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        assert!(tracker.list("chat-sess-known").is_empty());
    }

    #[tokio::test]
    async fn skips_when_encoded_cwd_does_not_match() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        sp.place_file("-fake-spoof", "sess1", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        assert!(tracker.list("chat-sess1").is_empty());
    }

    #[tokio::test]
    async fn rejects_symlinks_via_lstat() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        sp.place_symlink(&sp.encoded_project, "sess1", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        assert!(tracker.list("chat-sess1").is_empty());
    }

    #[tokio::test]
    async fn skips_invalid_task_id_basenames() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        sp.place_file(&sp.encoded_project, "sess1", "BAD..ID.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(Arc::new(AlwaysValid)),
        })
        .await;
        assert!(tracker.list("chat-sess1").is_empty());
    }

    #[tokio::test]
    async fn respects_the_injected_spool_validator() {
        let _guard = seam_test_guard();
        set_lsof_writers(&[]);
        let sp = new_spool();
        let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
        let db = MockDb {
            chats: vec![make_chat("sess1", None, "p1")],
            project_path: sp.project_path.clone(),
        };
        let calls = Arc::new(Mutex::new(Vec::new()));
        let validator = Arc::new(RecordingValidator {
            result: false,
            calls: calls.clone(),
        });
        let tracker = BackgroundTaskTracker::new();
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &db,
            spool_root: Some(sp.root.clone()),
            validator: Some(validator),
        })
        .await;
        assert_eq!(
            calls.lock().unwrap().as_slice(),
            &[(fp, "tkid01".to_string())]
        );
        assert!(tracker.list("chat-sess1").is_empty());
    }
}

// PORT STATUS: src/background-tasks/reconcile.ts (103 lines)
// confidence: high
// todos: 1
// notes: recovered snapshot stamps kind:'bash' (only bash spools to disk).
// `deps.db` structural type → ReconcileDb trait (chats_list_all /
// project_path) so this crate stays decoupled from mainframe-db. The TS outer
// try/catch guarded against unexpected throws; every fallible step here is handled
// inline (Option/Result → skip), so the 'reconcileBackgroundTasks aborted' warn is
// unreachable and omitted. st.ctimeMs/mtimeMs → MetadataExt ctime/mtime (unix) with
// a SystemTime fallback. vitest fs mocks → real temp spool + real project dir
// (canonicalize must succeed, so a real project path is required); the events test
// asserts a SET (real readdir order is nondeterministic vs TS's ordered mock).
// TODO(port): default validator uid — see spool_root.rs blocker.
