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
