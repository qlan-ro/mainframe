use super::*;

async fn write_temp(content: &str) -> (tempfile::TempDir, Candidate) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("abc.jsonl");
    tokio::fs::write(&file, content).await.unwrap();
    let cand = Candidate {
        session_id: "abc".to_string(),
        file_path: file.to_string_lossy().to_string(),
        mtime_ms: 1000.0,
        size: 0,
    };
    (dir, cand)
}

#[tokio::test]
async fn uses_custom_title_over_ai_over_first_prompt() {
    let (_d, cand) = write_temp(
        &serde_json::json!({
            "type": "user",
            "cwd": "/p",
            "timestamp": "2026-01-01T00:00:00Z",
            "customTitle": "My Title",
            "aiTitle": "AI Title",
            "message": { "content": "Fix login" }
        })
        .to_string(),
    )
    .await;
    let s = enrich_session(&cand, "/p").await.unwrap();
    assert_eq!(s.title.as_deref(), Some("My Title"));
}

#[tokio::test]
async fn falls_back_to_ai_title_then_first_prompt() {
    let (_d1, c1) = write_temp(
        &serde_json::json!({
            "type": "user", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z",
            "aiTitle": "AI Title", "message": { "content": "Fix login" }
        })
        .to_string(),
    )
    .await;
    assert_eq!(
        enrich_session(&c1, "/p").await.unwrap().title.as_deref(),
        Some("AI Title")
    );

    let (_d2, c2) = write_temp(
        &serde_json::json!({
            "type": "user", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z",
            "message": { "content": "Fix login" }
        })
        .to_string(),
    )
    .await;
    let s = enrich_session(&c2, "/p").await.unwrap();
    assert_eq!(s.title.as_deref(), Some("Fix login"));
    assert_eq!(s.first_prompt.as_deref(), Some("Fix login"));
}

#[tokio::test]
async fn drops_sidechain_sessions() {
    let (_d, c) = write_temp(
        &serde_json::json!({ "type": "user", "isSidechain": true, "cwd": "/p", "message": { "content": "x" } })
            .to_string(),
    )
    .await;
    assert!(enrich_session(&c, "/p").await.is_none());
}

#[tokio::test]
async fn drops_team_sessions() {
    let (_d, c) = write_temp(
        &serde_json::json!({ "type": "user", "teamName": "acme", "cwd": "/p", "message": { "content": "x" } })
            .to_string(),
    )
    .await;
    assert!(enrich_session(&c, "/p").await.is_none());
}

#[tokio::test]
async fn drops_wrong_cwd_sessions() {
    let (_d, c) = write_temp(
        &serde_json::json!({ "type": "user", "cwd": "/p-web", "timestamp": "2026-01-01T00:00:00Z", "message": { "content": "x" } })
            .to_string(),
    )
    .await;
    assert!(enrich_session(&c, "/p").await.is_none());
}

#[tokio::test]
async fn keeps_empty_session_with_synthetic_title() {
    let (_d, c) = write_temp(
        &serde_json::json!({ "type": "system", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z" })
            .to_string(),
    )
    .await;
    let s = enrich_session(&c, "/p").await.unwrap();
    assert_eq!(s.title.as_deref(), Some(SYNTHETIC_TITLE));
}
