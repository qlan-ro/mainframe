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
#[path = "ws_schemas_tests.rs"]
mod tests;
