//! Turns a failed Codex turn's error into chat text. When the Responses API
//! rejects a request, Codex passes its JSON envelope through verbatim
//! (`{"type":"error","status":400,"error":{"type":…,"message":…}}`). Known
//! failures get an actionable message, any other envelope keeps OpenAI's own
//! message with its status, and plain-text errors pass through unchanged.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::chatgpt_subscription::{ChatgptSubscription, read_chatgpt_subscription};

/// Codex returns this for every model once the ChatGPT plan lapses, and for a
/// model the plan does not include.
const CHATGPT_ACCOUNT_REJECTION: &str = "when using Codex with a ChatGPT account";
const RELOGIN: &str = "`codex logout && codex login`";

#[derive(Deserialize)]
struct Envelope {
    status: Option<u16>,
    error: ApiError,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(rename = "type")]
    kind: Option<String>,
    code: Option<String>,
    message: Option<String>,
}

pub(crate) fn explain_turn_error(raw: String) -> String {
    explain(raw, read_chatgpt_subscription, Utc::now())
}

/// `subscription` is only called for a ChatGPT-account rejection.
pub(crate) fn explain(
    raw: String,
    subscription: impl FnOnce() -> Option<ChatgptSubscription>,
    now: DateTime<Utc>,
) -> String {
    let Ok(envelope) = serde_json::from_str::<Envelope>(raw.trim()) else {
        return raw;
    };
    let message = envelope
        .error
        .message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty());
    let headline = match message {
        Some(m) if m.contains(CHATGPT_ACCOUNT_REJECTION) => {
            Some(chatgpt_rejection(rejected_model(m), subscription(), now))
        }
        _ => known_failure(&envelope),
    };
    match (headline, message) {
        (Some(headline), Some(m)) => format!("{headline}\n\nOpenAI: {m}"),
        (Some(headline), None) => headline,
        (None, _) => fallback(&envelope, message),
    }
}

fn known_failure(envelope: &Envelope) -> Option<String> {
    let code = envelope.error.code.as_deref();
    let text = match (code, envelope.status) {
        (Some("context_length_exceeded"), _) => {
            "The conversation no longer fits the model's context window. Compact it or start a new chat.".to_string()
        }
        (Some("insufficient_quota"), _) => {
            "The OpenAI account Codex uses has run out of quota. Check its billing, then retry."
                .to_string()
        }
        (Some("model_not_found"), _) | (_, Some(404)) => {
            "OpenAI doesn't offer this model to your account. Pick another model in the composer."
                .to_string()
        }
        (_, Some(401)) => {
            format!("Codex's login was rejected. Run {RELOGIN} in a terminal, then retry.")
        }
        (_, Some(403)) => format!(
            "OpenAI refused this request for the signed-in account. Check your plan, or run {RELOGIN}."
        ),
        (_, Some(429)) => "OpenAI is rate-limiting Codex. Wait a moment, then retry.".to_string(),
        (_, Some(status)) if status >= 500 => {
            format!("OpenAI's service failed ({status}). Retry in a moment.")
        }
        _ => return None,
    };
    Some(text)
}

fn chatgpt_rejection(
    model: Option<&str>,
    subscription: Option<ChatgptSubscription>,
    now: DateTime<Utc>,
) -> String {
    let model = model.map_or_else(|| "this model".to_string(), |m| format!("`{m}`"));
    let plan = subscription
        .as_ref()
        .and_then(|s| s.plan_type.as_deref())
        .map_or_else(
            || "ChatGPT".to_string(),
            |p| format!("ChatGPT {}", plan_label(p)),
        );
    let ended = subscription
        .and_then(|s| s.active_until)
        .filter(|until| *until <= now);
    match ended {
        Some(until) => format!(
            "Your {plan} subscription ended on {}, so Codex can't use {model}. Renew the plan, then run {RELOGIN} so Codex picks it up.",
            until.format("%-d %b %Y")
        ),
        None => format!(
            "Your {plan} plan can't use {model} in Codex. Pick another model, or run {RELOGIN} if the plan changed recently."
        ),
    }
}

/// `The 'gpt-6-sol' model is not supported …` → `gpt-6-sol`.
fn rejected_model(message: &str) -> Option<&str> {
    let rest = message.split_once("The '")?.1;
    let model = rest.split_once("' model")?.0;
    (!model.is_empty()).then_some(model)
}

fn plan_label(plan: &str) -> String {
    match plan {
        "free" => "Free",
        "go" => "Go",
        "plus" => "Plus",
        "pro" => "Pro",
        "prolite" => "Pro Lite",
        "team" => "Team",
        "business" => "Business",
        "enterprise" => "Enterprise",
        "edu" => "Edu",
        other => other,
    }
    .to_string()
}

fn fallback(envelope: &Envelope, message: Option<&str>) -> String {
    let source = match (envelope.status, envelope.error.kind.as_deref()) {
        (Some(status), Some(kind)) => format!("OpenAI rejected the request ({status} {kind})"),
        (Some(status), None) => format!("OpenAI rejected the request ({status})"),
        (None, Some(kind)) => format!("OpenAI rejected the request ({kind})"),
        (None, None) => "OpenAI rejected the request".to_string(),
    };
    match message {
        Some(m) => format!("{source}: {m}"),
        None => format!("{source}."),
    }
}

#[cfg(test)]
#[path = "turn_error_tests.rs"]
mod tests;
