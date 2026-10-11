//! The wire shape of `ClientEvent` lives in `mainframe_types::events`; serde
//! deserialization enforces the discriminated-union shape and required fields.
//! Refinements such as min-length strings have no serde analogue, so they live
//! here as an explicit `validate()`.

use mainframe_types::events::ClientEvent;
use mainframe_types::validation::RefinementError;

/// The failure modes an inbound WS message can hit: unparseable JSON
/// (`Invalid JSON`) vs. a shape or refinement failure (`Invalid message: …`).
/// The text is the `error` the client receives in a `{ type: "error", error }`
/// frame.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ClientEventError {
    #[error("Invalid JSON")]
    InvalidJson,
    /// The frame is JSON but not a `ClientEvent`; carries serde's reason.
    #[error("Invalid message: {0}")]
    Invalid(String),
    #[error("Invalid message: {0}")]
    Refinement(#[from] RefinementError),
}

/// Parse a raw WS text frame into a validated `ClientEvent`, mirroring
/// `JSON.parse` → `ClientEventSchema.safeParse`.
pub(crate) fn parse_client_event(raw: &str) -> Result<ClientEvent, ClientEventError> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| ClientEventError::InvalidJson)?;
    let event: ClientEvent =
        serde_json::from_value(value).map_err(|e| ClientEventError::Invalid(e.to_string()))?;
    validate(&event)?;
    Ok(event)
}

/// The validation refinements. Field presence/typing is already guaranteed by serde;
/// this adds the min-length, content-or-attachments, and identifier-charset rules.
fn validate(event: &ClientEvent) -> Result<(), RefinementError> {
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

fn non_empty(value: &str, field: &'static str) -> Result<(), RefinementError> {
    if value.is_empty() {
        Err(RefinementError::Empty(field))
    } else {
        Ok(())
    }
}

fn opt_non_empty(value: Option<&str>, field: &'static str) -> Result<(), RefinementError> {
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
        let err = parse_client_event(r#"{"type":"subscribe","chatId":""}"#).unwrap_err();
        assert_eq!(err.to_string(), "Invalid message: chatId must be non-empty");
        assert_eq!(ClientEventError::InvalidJson.to_string(), "Invalid JSON");
    }

    #[test]
    fn rejects_subscribe_file_with_empty_path() {
        let err = parse_client_event(r#"{"type":"subscribe:file","path":""}"#).unwrap_err();
        assert_eq!(err.to_string(), "Invalid message: path must be non-empty");
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
