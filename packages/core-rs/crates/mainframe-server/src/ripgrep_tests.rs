//! Exercises the real `ignore`/`grep-searcher` walk against tempdir fixtures —
//! no shelled-out `rg`, no mocked filesystem. Doubles as the parity oracle the
//! old `rg --json` parse tests used to be: `finds_match_with_line_column_and_text`
//! reproduces the exact file/line/column/text the deleted
//! `parses_match_events_into_results` test asserted.

use super::*;

#[tokio::test]
async fn finds_match_with_line_column_and_text() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "foo\nbar\nhello world\n").unwrap();

    let results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "world",
        &RipgrepOptions::default(),
    )
    .await;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].file, "a.txt");
    assert_eq!(results[0].line, 3);
    assert_eq!(results[0].column, 7);
    assert_eq!(results[0].text, "hello world");
}

#[tokio::test]
async fn matches_case_insensitively() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "HELLO\n").unwrap();

    let results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "hello",
        &RipgrepOptions::default(),
    )
    .await;

    assert_eq!(results.len(), 1);
}

#[tokio::test]
async fn honors_max_results_across_files() {
    let tmp = tempfile::tempdir().unwrap();
    for i in 0..5 {
        std::fs::write(tmp.path().join(format!("f{i}.txt")), "needle\n").unwrap();
    }

    let results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "needle",
        &RipgrepOptions {
            max_results: Some(2),
            ..Default::default()
        },
    )
    .await;

    assert_eq!(results.len(), 2);
}

#[tokio::test]
async fn caps_matches_per_file() {
    let tmp = tempfile::tempdir().unwrap();
    let content = "needle\n".repeat(60);
    std::fs::write(tmp.path().join("many.txt"), content).unwrap();

    let results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "needle",
        &RipgrepOptions {
            max_results: Some(1000),
            ..Default::default()
        },
    )
    .await;

    assert_eq!(results.len(), 50);
}

#[tokio::test]
async fn respects_gitignore_unless_include_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
    std::fs::write(tmp.path().join("ignored.txt"), "needle\n").unwrap();
    std::fs::write(tmp.path().join("normal.txt"), "needle\n").unwrap();

    let default_results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "needle",
        &RipgrepOptions::default(),
    )
    .await;
    assert_eq!(default_results.len(), 1);
    assert_eq!(default_results[0].file, "normal.txt");

    let all_results = search_with_ripgrep(
        &tmp.path().to_string_lossy(),
        "needle",
        &RipgrepOptions {
            include_ignored: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(all_results.len(), 2);
}

#[tokio::test]
async fn list_files_default_skips_gitignored_and_hidden() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
    std::fs::write(tmp.path().join("ignored.txt"), "x").unwrap();
    std::fs::write(tmp.path().join(".hidden"), "x").unwrap();
    std::fs::write(tmp.path().join("visible.txt"), "x").unwrap();

    let files =
        list_files_with_ripgrep(&tmp.path().to_string_lossy(), &ListFilesOptions::default()).await;

    assert_eq!(files, vec!["visible.txt".to_string()]);
}

#[tokio::test]
async fn list_files_include_ignored_surfaces_everything() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
    std::fs::write(tmp.path().join("ignored.txt"), "x").unwrap();
    std::fs::write(tmp.path().join(".hidden"), "x").unwrap();
    std::fs::write(tmp.path().join("visible.txt"), "x").unwrap();

    let mut files = list_files_with_ripgrep(
        &tmp.path().to_string_lossy(),
        &ListFilesOptions {
            include_ignored: true,
            ..Default::default()
        },
    )
    .await;
    files.sort();

    assert_eq!(
        files,
        vec![".gitignore", ".hidden", "ignored.txt", "visible.txt"]
    );
}

#[tokio::test]
async fn list_files_builtin_ignore_only_surfaces_gitignored_but_skips_ignored_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".gitignore"), "*\n").unwrap();
    std::fs::write(tmp.path().join(".env"), "x").unwrap();
    std::fs::create_dir_all(tmp.path().join("node_modules")).unwrap();
    std::fs::write(tmp.path().join("node_modules/dep.js"), "x").unwrap();

    let files = list_files_with_ripgrep(
        &tmp.path().to_string_lossy(),
        &ListFilesOptions {
            use_builtin_ignore_only: true,
            ..Default::default()
        },
    )
    .await;

    assert!(files.contains(&".env".to_string()));
    assert!(!files.iter().any(|f| f.contains("node_modules")));
}

#[test]
fn parses_max_file_size_suffixes() {
    assert_eq!(parse_max_file_size("1M"), Some(1024 * 1024));
    assert_eq!(parse_max_file_size("512K"), Some(512 * 1024));
    assert_eq!(parse_max_file_size("100"), Some(100));
    assert_eq!(parse_max_file_size("bogus"), None);
}
