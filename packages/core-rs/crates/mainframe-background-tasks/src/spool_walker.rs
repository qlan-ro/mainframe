//! Lists `<root>/<cwd_seg>/<sess>/tasks/<task_id>.output` files in the CLI
//! spool.

use std::path::Path;

/// A spool task id: 6 to 16 lowercase ASCII letters or digits.
fn is_task_id(id: &str) -> bool {
    (6..=16).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpoolTaskEntry {
    /// The encoded working directory (`encode_cwd_segment`).
    pub cwd_seg: String,
    /// The CLI's session id.
    pub sess: String,
    pub task_id: String,
    pub fp: String,
}

/// Every `<task_id>.output` under `root` with a valid task id, limited to one
/// `<cwd_seg>` when `scoped_cwd_seg` is set. Only reads directories: callers
/// stat and probe each entry themselves. Unreadable directories and
/// non-UTF-8 names are skipped.
pub(crate) async fn walk_spool_tasks(
    root: &Path,
    scoped_cwd_seg: Option<&str>,
) -> Vec<SpoolTaskEntry> {
    let cwd_segs = match scoped_cwd_seg {
        Some(seg) => vec![seg.to_string()],
        None => read_dir_names(root).await,
    };
    let mut out = Vec::new();
    for cwd_seg in cwd_segs {
        let cwd_path = root.join(&cwd_seg);
        for sess in read_dir_names(&cwd_path).await {
            let tasks_dir = cwd_path.join(&sess).join("tasks");
            for file in read_dir_names(&tasks_dir).await {
                let Some(task_id) = file.strip_suffix(".output").filter(|id| is_task_id(id)) else {
                    continue;
                };
                out.push(SpoolTaskEntry {
                    cwd_seg: cwd_seg.clone(),
                    sess: sess.clone(),
                    task_id: task_id.to_string(),
                    fp: tasks_dir.join(&file).to_string_lossy().into_owned(),
                });
            }
        }
    }
    out
}

async fn read_dir_names(dir: &Path) -> Vec<String> {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return Vec::new();
    };
    let mut names = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    names
}

#[cfg(test)]
#[path = "spool_walker_tests.rs"]
mod tests;
