#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;

use reqwest::StatusCode;
use serde_json::Value;

#[tokio::test]
async fn failed_storage_reads_return_server_errors_instead_of_empty_or_missing_chats() {
    let server = support::spawn_test_server(None).await;
    server
        .ctx
        .core
        .db
        .call(|db| {
            db.connection().execute_batch("DROP TABLE chats")?;
            Ok(())
        })
        .await
        .unwrap();
    let client = reqwest::Client::new();
    for path in ["/api/chats", "/api/chats/missing"] {
        let response = client
            .get(format!("http://{}{path}", server.addr))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "{path}"
        );
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "Internal server error");
        assert!(body.get("data").is_none());
    }
}
