use super::*;

#[tokio::test]
async fn confinement_rejects_traversal_absolute_and_symlink_escapes() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("a");
    let sibling = tmp.path().join("ab");
    std::fs::create_dir(&base).unwrap();
    std::fs::create_dir(&sibling).unwrap();
    std::fs::write(base.join("inside"), "inside").unwrap();
    std::fs::write(sibling.join("outside"), "outside").unwrap();
    let base_str = base.to_str().unwrap();
    assert_eq!(
        resolve_and_validate_path(base_str, "../ab/outside").await,
        None
    );
    assert_eq!(
        resolve_and_validate_path(base_str, sibling.to_str().unwrap()).await,
        None
    );
    assert_eq!(resolve_and_validate_path(base_str, "missing").await, None);
    let expected = std::fs::canonicalize(&base).unwrap().join("inside");
    assert_eq!(
        resolve_and_validate_path(base_str, "inside").await,
        Some(expected.to_string_lossy().into_owned())
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&sibling, base.join("escape")).unwrap();
        assert_eq!(
            resolve_and_validate_path(base_str, "escape/outside").await,
            None
        );
    }
}

#[test]
fn containment_compares_components() {
    assert!(is_within_base(Path::new("/a/b"), Path::new("/a/b")));
    assert!(is_within_base(Path::new("/a/b"), Path::new("/a/b/c")));
    assert!(!is_within_base(Path::new("/a/b"), Path::new("/a/bc")));
}

#[tokio::test]
async fn concurrent_replacements_are_complete_and_leave_no_temporary_files() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("data");
    let (a, b) = tokio::join!(
        write_atomic(&path, b"first", false),
        write_atomic(&path, b"second", false)
    );
    a.unwrap();
    b.unwrap();
    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(contents == "first" || contents == "second");
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn failed_rename_cleans_temporary_file() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("directory");
    std::fs::create_dir(&path).unwrap();
    let error = write_atomic(&path, b"data", false).await.unwrap_err();
    assert_eq!(error.stage, AtomicWriteStage::Rename);
    assert_eq!(error.path, path);
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
    std::fs::remove_dir(&path).unwrap();
    write_atomic(&path, b"recovered", false).await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"recovered");
}

#[cfg(unix)]
#[tokio::test]
async fn credentials_are_owner_only_on_creation_and_replacement() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("credentials");
    for contents in [b"first".as_slice(), b"second".as_slice()] {
        write_atomic(&path, contents, true).await.unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
}
