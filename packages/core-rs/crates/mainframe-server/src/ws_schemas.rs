//! Ported from `src/server/ws-schemas.ts`.
//!
//! The wire shape of `ClientEvent` lives in `mainframe_types::events`; serde
//! deserialization enforces the discriminated-union shape and required fields.
//! The Zod *refinements* (min-length strings) have no serde analogue, so they
//! live here as an explicit `validate()` — the §3.1 idiom.

use mainframe_types::events::ClientEvent;

/// The two failure modes `websocket.ts`'s `ws.on('message')` distinguishes: a
/// `JSON.parse` throw (`Invalid JSON`) vs. a `safeParse` failure (`Invalid
/// message: …`). Both are emitted to the client as `{ type: "error", error }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientEventError {
    InvalidJson,
    Invalid(String),
}

impl ClientEventError {
    /// The `error` string sent in the `error` frame.
    pub fn message(&self) -> String {
        match self {
            ClientEventError::InvalidJson => "Invalid JSON".to_string(),
            ClientEventError::Invalid(reason) => format!("Invalid message: {reason}"),
        }
    }
}

/// Parse a raw WS text frame into a validated `ClientEvent`, mirroring
/// `JSON.parse` → `ClientEventSchema.safeParse`.
pub fn parse_client_event(raw: &str) -> Result<ClientEvent, ClientEventError> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| ClientEventError::InvalidJson)?;
    let event: ClientEvent =
        serde_json::from_value(value).map_err(|e| ClientEventError::Invalid(e.to_string()))?;
    validate(&event).map_err(ClientEventError::Invalid)?;
    Ok(event)
}

/// The Zod refinements. Field presence/typing is already guaranteed by serde;
/// this adds the min-length, content-or-attachments, and identifier-charset rules.
fn validate(event: &ClientEvent) -> Result<(), String> {
    match event {
        ClientEvent::Subscribe { chat_id } | ClientEvent::Unsubscribe { chat_id } => {
            non_empty(chat_id, "chatId")
        }
        ClientEvent::SubscribeFile {
            path,
            project_id,
            chat_id,
        }
        | ClientEvent::UnsubscribeFile {
            path,
            project_id,
            chat_id,
        } => {
            non_empty(path, "path")?;
            opt_non_empty(project_id.as_deref(), "projectId")?;
            opt_non_empty(chat_id.as_deref(), "chatId")
        }
    }
}

fn non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() {
        Err(format!("{field} must be non-empty"))
    } else {
        Ok(())
    }
}

fn opt_non_empty(value: Option<&str>, field: &str) -> Result<(), String> {
    match value {
        Some(v) => non_empty(v, field),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_subscribe() {
        let event = parse_client_event(r#"{"type":"subscribe","chatId":"c1"}"#).unwrap();
        assert!(matches!(event, ClientEvent::Subscribe { chat_id } if chat_id == "c1"));
    }

    #[test]
    fn rejects_non_json() {
        assert_eq!(
            parse_client_event("not json{"),
            Err(ClientEventError::InvalidJson)
        );
    }

    #[test]
    fn rejects_unknown_type() {
        assert!(matches!(
            parse_client_event(r#"{"type":"bogus"}"#),
            Err(ClientEventError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_empty_chat_id() {
        assert!(matches!(
            parse_client_event(r#"{"type":"subscribe","chatId":""}"#),
            Err(ClientEventError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_subscribe_file_with_empty_path() {
        assert!(matches!(
            parse_client_event(r#"{"type":"subscribe:file","path":""}"#),
            Err(ClientEventError::Invalid(_))
        ));
    }

    #[test]
    fn accepts_relative_subscribe_file_with_project_id() {
        let event =
            parse_client_event(r#"{"type":"subscribe:file","path":"src/a.ts","projectId":"p1"}"#)
                .unwrap();
        assert!(matches!(event, ClientEvent::SubscribeFile { .. }));
    }

    #[test]
    fn rejects_the_retired_message_send_frame() {
        // The legacy chat dialect is gone: `message.send` now fails the union
        // parse like any unknown type (prompts ride `/acp/{profile}`).
        assert!(matches!(
            parse_client_event(r#"{"type":"message.send","chatId":"c1","content":"hi"}"#),
            Err(ClientEventError::Invalid(_))
        ));
    }
}

// PORT STATUS: src/server/ws-schemas.ts (ClientEventSchema + refinements)
// confidence: high
// todos: 0
// notes: shape enforced by `serde_json::from_value::<ClientEvent>` (the type in
// mainframe_types::events); the Zod `.min(1)` refinements are the explicit
// `validate()` fn (§3.1). Error strings are best-effort (the wire contract
// freezes only `{type:'error', error:<reason>}`, not the reason text). The
// message.send/permission.respond arms died with the legacy chat dialect
// (todo #350) — the command-name identifier rule now lives on the facade's
// prompt path.
