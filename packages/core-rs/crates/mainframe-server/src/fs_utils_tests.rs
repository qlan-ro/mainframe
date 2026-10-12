use super::*;

#[test]
fn binary_extension_matches_simple_and_double_extensions() {
    assert!(has_binary_extension("logo.png"));
    assert!(has_binary_extension("src/app.min.js"));
    assert!(has_binary_extension("styles.min.css"));
    assert!(has_binary_extension("bundle.js.map"));
    assert!(!has_binary_extension("index.ts"));
    assert!(!has_binary_extension("README"));
    assert!(!has_binary_extension(".env"));
}

#[test]
fn relative_drops_shared_prefix_and_climbs() {
    assert_eq!(relative(Path::new("/a/b"), Path::new("/a/b/c/d")), "c/d");
    assert_eq!(relative(Path::new("/a/b"), Path::new("/a/x")), "../x");
    assert_eq!(relative(Path::new("/a/b"), Path::new("/a/b")), "");
}

#[test]
fn path_resolve_collapses_dot_segments() {
    assert_eq!(path_resolve("/a/b", "c/../d"), "/a/b/d");
    assert_eq!(path_resolve("/a/b", "../e"), "/a/e");
    assert_eq!(path_resolve("/a/b", "/x/y"), "/x/y");
}

#[tokio::test]
async fn walk_collects_files_and_skips_ignored_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
    std::fs::create_dir_all(tmp.path().join("node_modules")).unwrap();
    std::fs::write(tmp.path().join("node_modules/dep.js"), "y").unwrap();
    std::fs::create_dir_all(tmp.path().join("src")).unwrap();
    std::fs::write(tmp.path().join("src/index.ts"), "z").unwrap();

    // Callers pass a realpath'd base (macOS /tmp → /private/tmp); mirror that.
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    let files = walk_project_files(&root.to_string_lossy(), true, WALK_LIMIT).await;
    assert!(files.iter().any(|f| f == "a.txt"));
    assert!(files.iter().any(|f| f == "src/index.ts"));
    assert!(!files.iter().any(|f| f.contains("node_modules")));
}

/// A directory symlink resolving back into the project is contained, so the walk
/// follows it and re-enters a subtree it has already covered. `limit` cannot stop
/// that: it counts files while the fan-out is in directories, so a project with
/// no files never reaches it and the walk runs forever.
#[tokio::test]
async fn a_directory_symlink_back_into_the_project_does_not_walk_forever() {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    std::fs::create_dir(root.join("src")).unwrap();
    std::os::unix::fs::symlink(&root, root.join("src/up")).unwrap();

    let files = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        walk_project_files(&root.to_string_lossy(), true, WALK_LIMIT),
    )
    .await
    .expect("the walk never finished");

    assert!(files.is_empty(), "files: {files:?}");
}

/// The cycle guard keys on the resolved directory, so two links to the same place
/// must not cost two walks of it — and the files under it are still reported once.
#[tokio::test]
async fn a_symlinked_directory_is_walked_once_and_its_files_reported_once() {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    std::fs::create_dir(root.join("shared")).unwrap();
    std::fs::write(root.join("shared/thing.ts"), "x").unwrap();
    std::os::unix::fs::symlink(root.join("shared"), root.join("first")).unwrap();
    std::os::unix::fs::symlink(root.join("shared"), root.join("second")).unwrap();

    let files = walk_project_files(&root.to_string_lossy(), true, WALK_LIMIT).await;

    assert_eq!(files, vec!["shared/thing.ts".to_string()]);
}
