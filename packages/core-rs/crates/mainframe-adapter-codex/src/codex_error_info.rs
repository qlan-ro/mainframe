//! Codex's `codexErrorInfo` read leniently, and the failure headlines it earns.
//! The schema mixes string variants, single-key object variants and a
//! catch-all, so the value stays a raw `Value` and anything unrecognised
//! counts as no metadata.

use serde_json::Value;

pub(crate) const STREAM_HEADLINE: &str = "OpenAI kept dropping the response and Codex gave up retrying. If this keeps happening in this chat, start a new chat or switch provider.";
pub(crate) const GENERIC_HEADLINE: &str = "Codex hit an error and could not finish this turn. If this keeps happening in this chat, start a new chat or switch provider.";
/// Codex's own text for `serverOverloaded`.
pub(crate) const CAPACITY: &str = "Selected model is at capacity. Please try a different model.";

const STREAM_TEXTS: [&str; 2] = [
    "stream closed before response.completed",
    "stream disconnected before completion",
];

/// The variants that change how a failure reads; every other variant is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexErrorKind {
    ServerOverloaded,
    Other,
    /// `responseStreamDisconnected` or `responseTooManyFailedAttempts`.
    StreamDropped,
}

fn kind_of(name: &str) -> Option<CodexErrorKind> {
    match name {
        "serverOverloaded" => Some(CodexErrorKind::ServerOverloaded),
        "other" => Some(CodexErrorKind::Other),
        "responseStreamDisconnected" | "responseTooManyFailedAttempts" => {
            Some(CodexErrorKind::StreamDropped)
        }
        _ => None,
    }
}

/// A bare string variant or a single-key object variant (whatever its inner
/// fields); anything else is unreadable.
pub(crate) fn classify(info: Option<&Value>) -> Option<CodexErrorKind> {
    match info? {
        Value::String(name) => kind_of(name),
        Value::Object(map) if map.len() == 1 => kind_of(map.keys().next()?),
        _ => None,
    }
}

fn is_stream_text(raw: &str) -> bool {
    STREAM_TEXTS.iter().any(|text| raw.contains(text))
}

/// `headline`, a blank line, then Codex's original message verbatim; or the
/// message untouched when nothing earns a headline.
pub(crate) fn describe(raw: String, kind: Option<CodexErrorKind>) -> String {
    let headline = if is_stream_text(&raw) || kind == Some(CodexErrorKind::StreamDropped) {
        STREAM_HEADLINE
    } else {
        match kind {
            Some(CodexErrorKind::ServerOverloaded) if raw.trim() == CAPACITY => return raw,
            Some(CodexErrorKind::ServerOverloaded) => CAPACITY,
            Some(CodexErrorKind::Other) => GENERIC_HEADLINE,
            _ => return raw,
        }
    };
    if raw.trim().is_empty() {
        return headline.to_string();
    }
    format!("{headline}\n\n{raw}")
}

#[cfg(test)]
#[path = "codex_error_info_tests.rs"]
mod tests;
