use super::*;

const SOL_REJECTED: &str = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."}}"#;

fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .unwrap()
        .with_timezone(&Utc)
}

fn subscription(plan: Option<&str>, until: Option<&str>) -> Option<ChatgptSubscription> {
    Some(ChatgptSubscription {
        plan_type: plan.map(str::to_string),
        active_until: until.map(at),
    })
}

fn no_subscription_lookup() -> Option<ChatgptSubscription> {
    panic!("subscription must only be read for a ChatGPT-account rejection")
}

#[test]
fn lapsed_subscription_names_the_end_date_and_the_relogin() {
    let text = explain(
        SOL_REJECTED.to_string(),
        || subscription(Some("prolite"), Some("2026-09-07T10:11:11+00:00")),
        at("2026-10-14T17:52:00Z"),
    );
    assert_eq!(
        text,
        "Your ChatGPT Pro Lite subscription ended on 7 Sep 2026, so Codex can't use `gpt-6-sol`. \
         Renew the plan, then run `codex logout && codex login` so Codex picks it up.\n\n\
         OpenAI: The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."
    );
}

#[test]
fn active_subscription_blames_the_plan_not_the_renewal() {
    let text = explain(
        SOL_REJECTED.to_string(),
        || subscription(Some("plus"), Some("2026-11-01T00:00:00Z")),
        at("2026-10-14T17:52:00Z"),
    );
    assert!(
        text.starts_with(
            "Your ChatGPT Plus plan can't use `gpt-6-sol` in Codex. Pick another model, \
             or run `codex logout && codex login` if the plan changed recently."
        ),
        "{text}"
    );
}

#[test]
fn unreadable_login_still_explains_the_rejection() {
    let text = explain(
        SOL_REJECTED.to_string(),
        || None,
        at("2026-10-14T17:52:00Z"),
    );
    assert!(
        text.starts_with("Your ChatGPT plan can't use `gpt-6-sol` in Codex."),
        "{text}"
    );
}

#[test]
fn rate_limit_gets_a_retry_hint() {
    let raw = r#"{"type":"error","status":429,"error":{"type":"rate_limit_error","message":"Slow down."}}"#;
    assert_eq!(
        explain(raw.to_string(), no_subscription_lookup, Utc::now()),
        "OpenAI is rate-limiting Codex. Wait a moment, then retry.\n\nOpenAI: Slow down."
    );
}

#[test]
fn context_length_code_wins_over_its_400_status() {
    let raw = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Too long."}}"#;
    assert!(
        explain(raw.to_string(), no_subscription_lookup, Utc::now())
            .starts_with("The conversation no longer fits the model's context window.")
    );
}

#[test]
fn server_error_reports_its_status() {
    let raw = r#"{"type":"error","status":503,"error":{"type":"server_error"}}"#;
    assert_eq!(
        explain(raw.to_string(), no_subscription_lookup, Utc::now()),
        "OpenAI's service failed (503). Retry in a moment."
    );
}

#[test]
fn unknown_envelope_falls_back_to_openai_message_and_status() {
    let raw = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Unsupported parameter: 'foo'."}}"#;
    assert_eq!(
        explain(raw.to_string(), no_subscription_lookup, Utc::now()),
        "OpenAI rejected the request (400 invalid_request_error): Unsupported parameter: 'foo'."
    );
}

#[test]
fn plain_text_error_passes_through() {
    let raw = "stream disconnected before completion";
    assert_eq!(
        explain(raw.to_string(), no_subscription_lookup, Utc::now()),
        raw
    );
}
