//! File-walk behavior: symlink containment, the entry-count cap, and ignored
//! directories.

use std::fs;
use tempfile::tempdir;

use crate::setup_advisor::fingerprint::fingerprint;

#[tokio::test]
async fn does_not_walk_into_or_count_a_directory_symlinked_outside_the_project() {
    // Security: same containment concern as the root-manifest symlink test in
    // manifests/tests.rs, but for the general file walk. The out-of-root
    // package.json below WOULD populate `frameworks` with "react" if followed.
    let outside = tempdir().unwrap();
    fs::write(
        outside.path().join("package.json"),
        r#"{ "dependencies": { "react": "18.2.0" } }"#,
    )
    .unwrap();
    for i in 0..12 {
        fs::write(outside.path().join(format!("file{i}.txt")), "").unwrap();
    }

    let project = tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), project.path().join("vendor")).unwrap();

    let fp = fingerprint(project.path()).await;

    assert_eq!(fp.file_count, 0);
    assert!(!fp.frameworks.contains(&"react".to_string()));
}

#[tokio::test]
async fn the_file_walk_stops_at_the_five_thousand_entry_cap() {
    let tmp = tempdir().unwrap();
    for dir in ["a", "b", "c"] {
        let sub = tmp.path().join(dir);
        fs::create_dir_all(&sub).unwrap();
        for i in 0..1700 {
            fs::write(sub.join(format!("f{i}.txt")), "").unwrap();
        }
    }

    let fp = fingerprint(tmp.path()).await;

    assert_eq!(fp.file_count, 5000);
}

#[tokio::test]
async fn node_modules_and_target_directories_are_not_counted() {
    let tmp = tempdir().unwrap();
    for name in ["a.txt", "b.txt", "c.txt"] {
        fs::write(tmp.path().join(name), "").unwrap();
    }
    for dir in ["node_modules", "target"] {
        let sub = tmp.path().join(dir);
        fs::create_dir_all(&sub).unwrap();
        for i in 0..5 {
            fs::write(sub.join(format!("f{i}.txt")), "").unwrap();
        }
    }

    let fp = fingerprint(tmp.path()).await;

    assert_eq!(fp.file_count, 3);
}
