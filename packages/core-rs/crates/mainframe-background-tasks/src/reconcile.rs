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

/// The DB surface reconcile reads: every chat, and a project's path by id.
pub trait ReconcileDb: Send + Sync {
    fn chats_list_all(&self) -> Vec<Chat>;
    /// `projects.get(id)?.path`.
    fn project_path(&self, id: &str) -> Option<String>;
}

pub struct ReconcileDeps<'a> {
    pub tracker: &'a BackgroundTaskTracker,
    pub db: &'a dyn ReconcileDb,
    pub spool_root: Option<String>,
    /// Test seam for pinning a validator; production leaves this `None` and
    /// gets the default (the real uid on unix).
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
        workflow_name: None,
        run_id: None,
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

        let writers = lsof_writers(&deps.tracker.process, &entry.fp).await;
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
mod tests;
