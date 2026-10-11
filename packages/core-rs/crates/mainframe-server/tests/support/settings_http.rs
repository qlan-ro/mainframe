//! HTTP and row helpers shared by the settings-route golden tests.

use std::collections::BTreeMap;

use reqwest::StatusCode;
use serde_json::Value;

use super::TestServer;

pub async fn set_setting(server: &TestServer, category: &str, key: &str, value: &str) {
    let (c, k, v) = (category.to_string(), key.to_string(), value.to_string());
    server
        .ctx
        .db
        .call(move |db| db.settings.set(&c, &k, &v))
        .await
        .unwrap();
}

/// Every stored row of `category`, sorted by key.
pub async fn rows(server: &TestServer, category: &str) -> BTreeMap<String, String> {
    let c = category.to_string();
    let rows = server
        .ctx
        .db
        .call(move |db| db.settings.get_by_category(&c))
        .await
        .unwrap();
    rows.into_iter().collect()
}

pub fn expected_rows(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

pub async fn get_text(server: &TestServer, path: &str) -> (StatusCode, String) {
    let resp = reqwest::get(server.http_url(path)).await.unwrap();
    (resp.status(), resp.text().await.unwrap())
}

pub async fn put_text(server: &TestServer, path: &str, body: Value) -> (StatusCode, String) {
    let resp = reqwest::Client::new()
        .put(server.http_url(path))
        .json(&body)
        .send()
        .await
        .unwrap();
    (resp.status(), resp.text().await.unwrap())
}

pub const OK_EMPTY: &str = r#"{"success":true}"#;
