//! Golden wire tests for the provider settings routes: the exact rows a PUT
//! writes or clears, the single rejection text for every out-of-enum value, and
//! the exact GET body. Captured from the pre-refactor routes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::settings_http::{OK_EMPTY, expected_rows, get_text, put_text, rows, set_setting};
use support::spawn_test_server;

// ── PUT /api/settings/providers/{id} ─────────────────────────────────────────

#[tokio::test]
async fn provider_put_writes_every_field_under_its_wire_key() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "claude.skipPermissions", "true").await;
    let patch = json!({
        "defaultModel": "opus",
        "defaultMode": "acceptEdits",
        "defaultPlanMode": "true",
        "executablePath": "/opt/claude",
        "systemPrompt": "be brief",
        "defaultEffort": "high",
        "defaultFast": "false",
        "defaultUltracode": "true",
        "defaultAdaptiveThinking": "false",
        "personality": "pragmatic",
        "reasoningSummary": "concise",
        "cliproxySmallFastModel": "mini"
    });
    assert_eq!(
        put_text(&server, "/api/settings/providers/claude", patch).await,
        (StatusCode::OK, OK_EMPTY.to_string())
    );
    assert_eq!(
        rows(&server, "provider").await,
        expected_rows(&[
            ("claude.cliproxySmallFastModel", "mini"),
            ("claude.defaultAdaptiveThinking", "false"),
            ("claude.defaultEffort", "high"),
            ("claude.defaultFast", "false"),
            ("claude.defaultMode", "acceptEdits"),
            ("claude.defaultModel", "opus"),
            ("claude.defaultPlanMode", "true"),
            ("claude.defaultUltracode", "true"),
            ("claude.executablePath", "/opt/claude"),
            ("claude.personality", "pragmatic"),
            ("claude.reasoningSummary", "concise"),
            ("claude.systemPrompt", "be brief"),
        ])
    );
}

#[tokio::test]
async fn provider_put_empty_string_clears_every_field() {
    let server = spawn_test_server(None).await;
    for field in [
        "defaultModel",
        "defaultMode",
        "executablePath",
        "systemPrompt",
        "defaultEffort",
        "defaultFast",
        "defaultUltracode",
        "defaultAdaptiveThinking",
        "personality",
        "reasoningSummary",
        "cliproxySmallFastModel",
    ] {
        set_setting(&server, "provider", &format!("codex.{field}"), "x").await;
    }
    set_setting(&server, "provider", "codex.defaultPlanMode", "true").await;
    set_setting(&server, "provider", "codex.titleBinary", "kept").await;
    let patch = json!({
        "defaultModel": "",
        "executablePath": "",
        "systemPrompt": "",
        "defaultEffort": "",
        "defaultFast": "",
        "defaultUltracode": "",
        "defaultAdaptiveThinking": "",
        "personality": "",
        "reasoningSummary": "",
        "cliproxySmallFastModel": ""
    });
    assert_eq!(
        put_text(&server, "/api/settings/providers/codex", patch).await,
        (StatusCode::OK, OK_EMPTY.to_string())
    );
    assert_eq!(
        rows(&server, "provider").await,
        expected_rows(&[
            ("codex.defaultMode", "x"),
            ("codex.defaultPlanMode", "true"),
            ("codex.titleBinary", "kept"),
        ])
    );
}

#[tokio::test]
async fn provider_put_rejects_every_out_of_enum_value_with_one_text() {
    let server = spawn_test_server(None).await;
    let rejected = [
        json!({ "defaultMode": "plan" }),
        json!({ "defaultMode": "" }),
        json!({ "defaultPlanMode": "" }),
        json!({ "defaultPlanMode": "yes" }),
        json!({ "defaultEffort": "extreme" }),
        json!({ "defaultFast": "TRUE" }),
        json!({ "defaultUltracode": "1" }),
        json!({ "defaultAdaptiveThinking": "on" }),
        json!({ "personality": "grumpy" }),
        json!({ "reasoningSummary": "verbose" }),
    ];
    for body in rejected {
        let (status, text) =
            put_text(&server, "/api/settings/providers/claude", body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(
            text, r#"{"error":"Invalid provider setting","success":false}"#,
            "{body}"
        );
    }
    let (status, text) = put_text(
        &server,
        "/api/settings/providers/claude",
        json!({ "defaultModel": 5 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(text, r#"{"error":"Invalid request body","success":false}"#);
    assert_eq!(rows(&server, "provider").await, expected_rows(&[]));
}

#[tokio::test]
async fn provider_put_accepts_every_enum_spelling() {
    let server = spawn_test_server(None).await;
    let accepted = [
        json!({ "defaultMode": "default" }),
        json!({ "defaultMode": "acceptEdits" }),
        json!({ "defaultMode": "auto" }),
        json!({ "defaultMode": "yolo" }),
        json!({ "defaultPlanMode": "false" }),
        json!({ "defaultEffort": "low" }),
        json!({ "defaultEffort": "medium" }),
        json!({ "defaultEffort": "max" }),
        json!({ "defaultFast": "true" }),
        json!({ "personality": "none" }),
        json!({ "personality": "friendly" }),
        json!({ "reasoningSummary": "auto" }),
        json!({ "reasoningSummary": "detailed" }),
        json!({ "reasoningSummary": "none" }),
    ];
    for body in accepted {
        let (status, text) =
            put_text(&server, "/api/settings/providers/claude", body.clone()).await;
        assert_eq!(
            (status, text.as_str()),
            (StatusCode::OK, OK_EMPTY),
            "{body}"
        );
    }
}

// ── GET /api/settings/providers ──────────────────────────────────────────────

#[tokio::test]
async fn providers_get_body_is_grouped_normalized_and_resolved() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "ghosta.defaultModel", "opus").await;
    set_setting(&server, "provider", "ghosta.skipPermissions", "true").await;
    set_setting(&server, "provider", "ghosta.titleBinary", "tb").await;
    set_setting(
        &server,
        "provider",
        "ghosta.executablePath",
        "/nonexistent/ghosta",
    )
    .await;
    set_setting(&server, "provider", "ghostb.defaultModel", "default").await;
    set_setting(&server, "provider", "ghostb.defaultMode", "auto").await;
    set_setting(&server, "provider", "ghostb.skipPermissions", "true").await;
    set_setting(&server, "provider", "nodot", "ignored").await;
    let (status, body) = get_text(&server, "/api/settings/providers").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        concat!(
            r#"{"data":{"ghosta":{"defaultMode":"yolo","defaultModel":"opus","executablePath":"/nonexistent/ghosta","#,
            r#""resolvedExecutable":{"path":"/nonexistent/ghosta","source":"config","valid":false},"titleBinary":"tb"},"#,
            r#""ghostb":{"defaultMode":"auto","defaultModel":"default","resolvedExecutable":{"path":"ghostb","source":"fallback","valid":false}}},"#,
            r#""success":true}"#
        )
    );
}
