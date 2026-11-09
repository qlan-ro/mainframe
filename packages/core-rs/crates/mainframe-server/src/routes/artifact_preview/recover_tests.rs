use super::*;
use axum::http::StatusCode;
use std::fs::File;
use std::path::PathBuf;
use std::time::Duration;

fn cached_version(data_dir: &FsPath, slug: &str, version: &str, age: Duration) -> PathBuf {
    let dir = cache::cache_root(data_dir).join(slug).join(version);
    std::fs::create_dir_all(&dir).expect("mkdir");
    std::fs::write(dir.join(META_FILE), "{}").expect("write");
    File::open(dir.join(META_FILE))
        .expect("open")
        .set_modified(SystemTime::now() - age)
        .expect("set modified");
    dir
}

fn location(response: &Response) -> Option<&str> {
    response
        .headers()
        .get("location")
        .and_then(|value| value.to_str().ok())
}

fn ready(version: &str) -> Result<Option<ReadyPreview>, AdapterError> {
    Ok(Some(ReadyPreview {
        version: version.to_string(),
        title: "T".to_string(),
    }))
}

fn unavailable() -> Response {
    StatusCode::GONE.into_response()
}

#[tokio::test]
async fn a_stale_tab_moves_to_the_newest_cached_version_without_downloading() {
    let dir = tempfile::tempdir().expect("tempdir");
    cached_version(dir.path(), "abc", "old", Duration::from_secs(3_600));
    cached_version(dir.path(), "abc", "new", Duration::from_secs(60));

    let response = missing_version(
        dir.path(),
        "abc",
        "index",
        || async { panic!("no download") },
        unavailable,
    )
    .await;

    assert_eq!(
        location(&response),
        Some("/api/artifact-preview/abc/new/index")
    );
}

#[tokio::test]
async fn a_tab_with_nothing_cached_downloads_the_current_version() {
    let dir = tempfile::tempdir().expect("tempdir");

    let response = missing_version(
        dir.path(),
        "abc",
        "index",
        || async { ready("v2") },
        unavailable,
    )
    .await;

    assert_eq!(
        location(&response),
        Some("/api/artifact-preview/abc/v2/index")
    );
}

#[tokio::test]
async fn only_the_page_itself_may_start_a_download() {
    let dir = tempfile::tempdir().expect("tempdir");

    let response = missing_version(
        dir.path(),
        "abc",
        "project/Main.dc.html",
        || async { panic!("a board file must not download") },
        unavailable,
    )
    .await;

    assert_eq!(response.status(), StatusCode::GONE);
}

#[tokio::test]
async fn an_artifact_that_cannot_come_back_says_so() {
    let dir = tempfile::tempdir().expect("tempdir");
    let deleted = missing_version(
        dir.path(),
        "abc",
        "index",
        || async { Err(AdapterError::Message("artifact not found".to_string())) },
        unavailable,
    )
    .await;
    let docs = missing_version(
        dir.path(),
        "abc",
        "index",
        || async { Ok(None) },
        unavailable,
    )
    .await;

    assert_eq!(deleted.status(), StatusCode::GONE);
    assert_eq!(docs.status(), StatusCode::GONE);
}

#[test]
fn the_fallback_page_links_to_the_artifact_on_claude_ai() {
    let page = unavailable_page("abc");
    assert!(page.contains(r#"href="https://claude.ai/artifact/abc""#));
    assert!(page.contains(r#"target="_blank""#));
}
