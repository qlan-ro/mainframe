use super::*;

fn auth_json(claims: &serde_json::Value) -> String {
    let payload = URL_SAFE_NO_PAD.encode(claims.to_string());
    serde_json::json!({
        "auth_mode": "chatgpt",
        "tokens": { "id_token": format!("header.{payload}.signature") }
    })
    .to_string()
}

#[test]
fn reads_plan_and_subscription_end_from_the_id_token() {
    let raw = auth_json(&serde_json::json!({
        "https://api.openai.com/auth": {
            "chatgpt_plan_type": "prolite",
            "chatgpt_subscription_active_until": "2026-09-07T10:11:11+00:00"
        }
    }));
    let subscription = parse_auth_file(&raw).unwrap();
    assert_eq!(subscription.plan_type.as_deref(), Some("prolite"));
    assert_eq!(
        subscription.active_until.unwrap().to_rfc3339(),
        "2026-09-07T10:11:11+00:00"
    );
}

#[test]
fn missing_subscription_end_is_unknown_not_an_error() {
    let raw = auth_json(&serde_json::json!({
        "https://api.openai.com/auth": { "chatgpt_plan_type": "plus" }
    }));
    let subscription = parse_auth_file(&raw).unwrap();
    assert_eq!(subscription.plan_type.as_deref(), Some("plus"));
    assert_eq!(subscription.active_until, None);
}

#[test]
fn api_key_login_without_an_id_token_is_rejected() {
    let raw = r#"{"auth_mode":"apikey","OPENAI_API_KEY":"sk-test","tokens":null}"#;
    assert_eq!(parse_auth_file(raw), Err("auth.json has no id_token"));
}

#[test]
fn malformed_token_is_rejected() {
    let raw = r#"{"tokens":{"id_token":"not-a-jwt"}}"#;
    assert_eq!(parse_auth_file(raw), Err("id_token is not a JWT"));
}
