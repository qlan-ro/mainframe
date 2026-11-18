//! `is_task_output_under` against real files, so symlink resolution and the
//! macOS `/var` → `/private/var` temp-dir link are exercised for real.

use super::*;
use tempfile::TempDir;

/// `<tmp>/claude-test/` as the spool root, with one task output inside it.
struct Spool {
    tmp: TempDir,
}

impl Spool {
    fn new() -> Self {
        let spool = Spool {
            tmp: TempDir::new().unwrap(),
        };
        std::fs::create_dir_all(spool.root()).unwrap();
        spool
    }

    fn root(&self) -> PathBuf {
        self.tmp.path().join("claude-test")
    }

    fn write(&self, relative: &str) -> PathBuf {
        let path = self.root().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"output").unwrap();
        path
    }
}

#[tokio::test]
async fn accepts_a_task_output_under_the_root() {
    let spool = Spool::new();
    let path = spool.write("-proj/sess/tasks/abc123.output");
    assert!(is_task_output_under(&spool.root(), &path, "abc123").await);
}

#[tokio::test]
async fn rejects_a_file_named_for_another_task() {
    let spool = Spool::new();
    let path = spool.write("-proj/sess/tasks/other1.output");
    assert!(!is_task_output_under(&spool.root(), &path, "abc123").await);
}

#[tokio::test]
async fn rejects_a_path_without_a_tasks_directory() {
    let spool = Spool::new();
    let path = spool.write("-proj/sess/abc123.output");
    assert!(!is_task_output_under(&spool.root(), &path, "abc123").await);
}

#[tokio::test]
async fn rejects_a_path_outside_the_root_even_under_a_tasks_directory() {
    let spool = Spool::new();
    let outside = spool.tmp.path().join("tasks").join("abc123.output");
    std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
    std::fs::write(&outside, b"secret").unwrap();
    assert!(!is_task_output_under(&spool.root(), &outside, "abc123").await);
}

#[tokio::test]
async fn rejects_a_missing_file() {
    let spool = Spool::new();
    let path = spool.root().join("-proj/sess/tasks/abc123.output");
    assert!(!is_task_output_under(&spool.root(), &path, "abc123").await);
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_a_session_dir_symlinked_out_of_the_root() {
    let spool = Spool::new();
    let elsewhere = TempDir::new().unwrap();
    let target = elsewhere.path().join("tasks");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("abc123.output"), b"secret").unwrap();
    std::fs::create_dir_all(spool.root().join("-proj")).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), spool.root().join("-proj/sess")).unwrap();
    let path = spool.root().join("-proj/sess/tasks/abc123.output");
    assert!(!is_task_output_under(&spool.root(), &path, "abc123").await);
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_a_root_that_is_itself_a_symlink() {
    let tmp = TempDir::new().unwrap();
    let real = tmp.path().join("real-root");
    let path = real.join("-proj/sess/tasks/abc123.output");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"output").unwrap();
    let root = tmp.path().join("claude-test");
    std::os::unix::fs::symlink(&real, &root).unwrap();
    let via_root = root.join("-proj/sess/tasks/abc123.output");
    assert!(!is_task_output_under(&root, &via_root, "abc123").await);
}

#[tokio::test]
async fn a_tasks_directory_above_the_root_does_not_count() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("tasks").join("claude-test");
    let path = root.join("-proj/sess/abc123.output");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"output").unwrap();
    assert!(!is_task_output_under(&root, &path, "abc123").await);
}
