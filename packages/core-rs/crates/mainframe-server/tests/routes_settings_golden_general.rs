//! Golden wire tests for the general settings routes: the exact response bytes
//! of GET and of every PUT rejection, plus the exact `settings` rows a PUT leaves
//! behind. Captured from the pre-refactor routes so key names, defaults, enum
//! spellings and error texts cannot drift.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::settings_http::{OK_EMPTY, expected_rows, get_text, put_text, rows, set_setting};
use support::spawn_test_server;

// ── GET /api/settings/general ────────────────────────────────────────────────

#[tokio::test]
async fn general_get_empty_body_is_the_defaults() {
    let server = spawn_test_server(None).await;
    let (status, body) = get_text(&server, "/api/settings/general").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        concat!(
            r#"{"data":{"defaultAdapterId":null,"#,
            r#""notifications":{"chat":{"attentionRequest":true,"sessionError":true,"taskComplete":true},"#,
            r#""other":{"plugin":true},"permission":{"planApproval":true,"toolRequest":true,"userQuestion":true}},"#,
            r#""updateChannel":"stable","worktreeDir":".worktrees"},"success":true}"#
        )
    );
}

#[tokio::test]
async fn general_get_overlays_stored_values_and_passes_unknown_keys_through() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "worktreeDir", "trees").await;
    set_setting(&server, "general", "updateChannel", "prerelease").await;
    set_setting(&server, "general", "defaultAdapterId", "codex").await;
    set_setting(&server, "general", "titleGeneration.disabled", "true").await;
    set_setting(
        &server,
        "general",
        "notifications",
        r#"{"chat":{"taskComplete":false},"permission":{"userQuestion":false},"other":{"plugin":false}}"#,
    )
    .await;
    let (status, body) = get_text(&server, "/api/settings/general").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        concat!(
            r#"{"data":{"defaultAdapterId":"codex","#,
            r#""notifications":{"chat":{"attentionRequest":true,"sessionError":true,"taskComplete":false},"#,
            r#""other":{"plugin":false},"permission":{"planApproval":true,"toolRequest":true,"userQuestion":false}},"#,
            r#""titleGeneration.disabled":"true","updateChannel":"prerelease","worktreeDir":"trees"},"success":true}"#
        )
    );
}

#[tokio::test]
async fn general_get_salvages_each_notification_group_independently() {
    let server = spawn_test_server(None).await;
    // `chat` has an ill-typed known key → that group falls back to defaults;
    // `permission` is valid and unknown keys are ignored; `other` is not an object.
    set_setting(
        &server,
        "general",
        "notifications",
        r#"{"chat":{"taskComplete":"no","sessionError":false},"permission":{"toolRequest":false,"extra":1},"other":7}"#,
    )
    .await;
    let (_, body) = get_text(&server, "/api/settings/general").await;
    let data: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        data["data"]["notifications"],
        json!({
            "chat": { "taskComplete": true, "sessionError": true, "attentionRequest": true },
            "permission": { "toolRequest": false, "userQuestion": true, "planApproval": true },
            "other": { "plugin": true }
        })
    );
}

// ── PUT /api/settings/general ────────────────────────────────────────────────

#[tokio::test]
async fn general_put_rejections_have_exact_error_texts() {
    let server = spawn_test_server(None).await;
    let cases = [
        (
            json!([1]),
            r#"{"error":"Invalid request body","success":false}"#,
        ),
        (
            json!({ "worktreeDir": "" }),
            r#"{"error":"Too small: expected string to have >=1 characters, Must be a simple directory name","success":false}"#,
        ),
        (
            json!({ "worktreeDir": "a/b" }),
            r#"{"error":"Must be a simple directory name","success":false}"#,
        ),
        (
            json!({ "updateChannel": "beta" }),
            r#"{"error":"Invalid update channel","success":false}"#,
        ),
        (
            json!({ "updateChannel": "" }),
            r#"{"error":"Invalid update channel","success":false}"#,
        ),
        (
            json!({ "defaultAdapterId": "../x" }),
            r#"{"error":"Invalid adapter id","success":false}"#,
        ),
        (
            json!({ "notifications": { "permission": { "toolRequest": 1 } } }),
            r#"{"error":"Invalid request body","success":false}"#,
        ),
    ];
    for (body, expected) in cases {
        let (status, text) = put_text(&server, "/api/settings/general", body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(text, expected, "{body}");
    }
    assert_eq!(rows(&server, "general").await, expected_rows(&[]));
}

#[tokio::test]
async fn general_put_writes_the_exact_rows() {
    let server = spawn_test_server(None).await;
    let patch = json!({
        "worktreeDir": "wt",
        "updateChannel": "prerelease",
        "defaultAdapterId": "claude",
        "notifications": { "chat": { "sessionError": false }, "other": { "plugin": false } }
    });
    assert_eq!(
        put_text(&server, "/api/settings/general", patch).await,
        (StatusCode::OK, OK_EMPTY.to_string())
    );
    assert_eq!(
        rows(&server, "general").await,
        expected_rows(&[
            ("defaultAdapterId", "claude"),
            (
                "notifications",
                r#"{"chat":{"taskComplete":true,"sessionError":false,"attentionRequest":true},"permission":{"toolRequest":true,"userQuestion":true,"planApproval":true},"other":{"plugin":false}}"#
            ),
            ("updateChannel", "prerelease"),
            ("worktreeDir", "wt"),
        ])
    );

    // Writing the defaults back deletes the rows; explicit null clears the adapter.
    let reset =
        json!({ "worktreeDir": ".worktrees", "updateChannel": "stable", "defaultAdapterId": null });
    assert_eq!(
        put_text(&server, "/api/settings/general", reset).await,
        (StatusCode::OK, OK_EMPTY.to_string())
    );
    assert_eq!(
        rows(&server, "general").await,
        expected_rows(&[(
            "notifications",
            r#"{"chat":{"taskComplete":true,"sessionError":false,"attentionRequest":true},"permission":{"toolRequest":true,"userQuestion":true,"planApproval":true},"other":{"plugin":false}}"#
        )])
    );
}
