//! Ported from `packages/core/src/background-tasks/spool-walker.ts`.

use std::path::Path;

/// `^[a-z0-9]{6,16}$` — the spool task-id shape (checked without a regex crate).
fn task_id_matches(id: &str) -> bool {
    let len = id.chars().count();
    (6..=16).contains(&len)
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpoolTaskEntry {
    pub cwd_seg: String,
    pub sess: String,
    pub task_id: String,
    pub fp: String,
}

pub struct WalkOpts {
    /// Walk `${root}/<cwdSeg>/<sess>/tasks/*.output` for every cwdSeg under root.
    pub root: String,
    /// When set, only `<cwdSeg> === scopedCwdSeg` is walked (worktree sweep).
    pub scoped_cwd_seg: Option<String>,
}

/// Walk the spool directory and return every `<taskId>.output` entry whose
/// basename matches `TASK_ID_RE`. Does no I/O beyond `readdir` — callers run
/// their own lstat/stat/lsof per entry so they can early-exit cheaply.
///
/// The TS source invokes an async `onTask` callback per entry; the Rust port
/// returns the entries in the same traversal order and lets the caller loop,
/// which sidesteps borrowing an async closure across the walk.
pub async fn walk_spool_tasks(opts: &WalkOpts) -> Vec<SpoolTaskEntry> {
    let mut out = Vec::new();
    let cwd_segs = match &opts.scoped_cwd_seg {
        Some(seg) => vec![seg.clone()],
        None => safe_readdir(&opts.root).await,
    };
    for cwd_seg in cwd_segs {
        let cwd_path = Path::new(&opts.root).join(&cwd_seg);
        for sess in safe_readdir(&cwd_path.to_string_lossy()).await {
            let tasks_dir = cwd_path.join(&sess).join("tasks");
            for f in safe_readdir(&tasks_dir.to_string_lossy()).await {
                if !f.ends_with(".output") {
                    continue;
                }
                let task_id = &f[..f.len() - ".output".len()];
                if !task_id_matches(task_id) {
                    continue;
                }
                out.push(SpoolTaskEntry {
                    cwd_seg: cwd_seg.clone(),
                    sess: sess.clone(),
                    task_id: task_id.to_string(),
                    fp: tasks_dir.join(&f).to_string_lossy().into_owned(),
                });
            }
        }
    }
    out
}

async fn safe_readdir(p: &str) -> Vec<String> {
    let mut rd = match tokio::fs::read_dir(p).await {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };
    let mut names = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(entry)) => names.push(entry.file_name().to_string_lossy().into_owned()),
            Ok(None) => break,
            Err(_) => break,
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn task_id_re_accepts_and_rejects() {
        assert!(task_id_matches("tkid01"));
        assert!(task_id_matches("abc123def456ghij")); // 16
        assert!(!task_id_matches("short")); // 5
        assert!(!task_id_matches("UPPER1")); // uppercase
        assert!(!task_id_matches("has.dot")); // punctuation
    }

    #[tokio::test]
    async fn walks_output_files_and_skips_bad_ids() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let tasks = root.join("-Users-x-proj").join("sess1").join("tasks");
        fs::create_dir_all(&tasks).unwrap();
        fs::write(tasks.join("tkid01.output"), b"").unwrap();
        fs::write(tasks.join("BAD..ID.output"), b"").unwrap();
        fs::write(tasks.join("ignore.txt"), b"").unwrap();

        let entries = walk_spool_tasks(&WalkOpts {
            root: root.to_string_lossy().into_owned(),
            scoped_cwd_seg: None,
        })
        .await;

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].task_id, "tkid01");
        assert_eq!(entries[0].cwd_seg, "-Users-x-proj");
        assert_eq!(entries[0].sess, "sess1");
    }

    #[tokio::test]
    async fn scoped_cwd_seg_limits_traversal() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        for seg in ["-a", "-b"] {
            let tasks = root.join(seg).join("s").join("tasks");
            fs::create_dir_all(&tasks).unwrap();
            fs::write(tasks.join("tkid01.output"), b"").unwrap();
        }
        let entries = walk_spool_tasks(&WalkOpts {
            root: root.to_string_lossy().into_owned(),
            scoped_cwd_seg: Some("-a".to_string()),
        })
        .await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cwd_seg, "-a");
    }

    #[tokio::test]
    async fn missing_root_yields_empty() {
        let entries = walk_spool_tasks(&WalkOpts {
            root: "/no/such/spool/root/xyz".to_string(),
            scoped_cwd_seg: None,
        })
        .await;
        assert!(entries.is_empty());
    }
}

// PORT STATUS: src/background-tasks/spool-walker.ts (49 lines)
// confidence: high
// todos: 0
// notes: async `onTask` callback → returns Vec<SpoolTaskEntry> in traversal
// order (callers loop + await per entry); avoids borrowing an async closure
// across the walk. `readdir` → tokio::fs::read_dir with the same swallow-errors
// (`safeReaddir` → []). No standalone TS test file existed; added real-tempdir
// coverage for the TASK_ID_RE filter, scoping, and the empty-root path.
