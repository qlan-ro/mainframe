//! `GET`/`PUT`/`DELETE /link` tests.

use axum::extract::Json;
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::link;
use crate::todos_github::run_test_support::{CREDENTIAL, OWNER, REPO};
use crate::todos_github::test_support;

use super::{qs, read, setup};

#[tokio::test]
async fn get_link_returns_400_when_project_id_missing() {
    let h = setup(FakeGitHub::default()).await;
    let (status, body) = read(link::get_link(test_support::state(&h), qs(&[])).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "projectId required" }));
}

#[tokio::test]
async fn get_link_returns_null_link_not_running_no_run() {
    let h = setup(FakeGitHub::default()).await;
    let (status, body) =
        read(link::get_link(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["link"], json!(null));
    assert_eq!(body["running"], json!(false));
    assert_eq!(body["latestRunId"], json!(null));
    assert!(body["workflowLabels"]["prefixes"].as_array().is_some());
    assert!(body["workflowLabels"]["labels"].as_array().is_some());
    assert!(body.get("success").is_none());
}

fn link_body() -> Value {
    json!({
        "projectId": "p1", "owner": OWNER, "repo": REPO,
        "remoteName": "origin", "credentialLabel": CREDENTIAL,
    })
}

#[tokio::test]
async fn put_link_creates_then_shows_up_on_get() {
    let h = setup(FakeGitHub::default()).await;
    let (status, body) =
        read(link::put_link(test_support::state(&h), Json(link_body())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["link"],
        json!({
            "projectId": "p1", "owner": OWNER, "repo": REPO,
            "remoteName": "origin", "credentialLabel": CREDENTIAL, "lastSyncedAt": null,
        })
    );

    let (_, get_body) =
        read(link::get_link(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(get_body["link"]["owner"], json!(OWNER));
}

#[tokio::test]
async fn put_link_twice_returns_409() {
    let h = setup(FakeGitHub::default()).await;
    read(link::put_link(test_support::state(&h), Json(link_body())).await).await;
    let (status, _) = read(link::put_link(test_support::state(&h), Json(link_body())).await).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn put_link_rejects_an_owner_that_is_not_a_valid_github_segment() {
    let h = setup(FakeGitHub::default()).await;
    let mut body = link_body();
    body["owner"] = json!("acme/../etc");
    let (status, body) = read(link::put_link(test_support::state(&h), Json(body)).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"],
        json!("owner and repo must be a valid GitHub owner/repo")
    );
}

#[tokio::test]
async fn put_link_rejects_a_repo_shaped_as_a_process_argument() {
    let h = setup(FakeGitHub::default()).await;
    let mut body = link_body();
    body["repo"] = json!("widgets; rm -rf /");
    let (status, body) = read(link::put_link(test_support::state(&h), Json(body)).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"],
        json!("owner and repo must be a valid GitHub owner/repo")
    );
}

#[tokio::test]
async fn put_link_rejects_non_object_body() {
    let h = setup(FakeGitHub::default()).await;
    let (status, body) =
        read(link::put_link(test_support::state(&h), Json(json!("not an object"))).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], json!("projectId required"));
}
