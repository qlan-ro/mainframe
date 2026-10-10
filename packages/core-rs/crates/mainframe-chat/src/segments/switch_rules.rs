//! When a chat may not switch provider, checked in the spec's refusal order.
//! The UI disables the provider tabs with the same copy.

use mainframe_types::adapter::AdapterInfo;
use mainframe_types::chat::{Chat, DisplayStatus, ProcessState};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SwitchError {
    #[error("Chat {0} not found")]
    NotFound(String),
    #[error("{0} isn't installed")]
    NotInstalled(String),
    #[error("{model} isn't a {name} model")]
    UnknownModel { model: String, name: String },
    #[error("Side chats keep their parent's provider")]
    SideChat,
    #[error("Temporary chats can't switch providers")]
    Temporary,
    #[error("Wait for the current turn to finish or interrupt it")]
    TurnInFlight,
    #[error("Send or cancel queued messages before switching providers")]
    Queued,
    #[error(
        "{0} is still running background agents or commands, and switching would end them. \
         Wait for them to finish, or press Stop, then switch."
    )]
    BackgroundWork(String),
    #[error("{0}")]
    Failed(String),
}

impl SwitchError {
    /// The HTTP status the route answers with.
    pub fn status(&self) -> u16 {
        match self {
            Self::NotFound(_) => 404,
            Self::NotInstalled(_) | Self::UnknownModel { .. } => 422,
            Self::Failed(_) => 500,
            _ => 409,
        }
    }
}

/// Everything the refusal checks read, gathered on fresh state.
pub struct SwitchCheck<'a> {
    /// The enriched chat (display status and background activity set).
    pub chat: &'a Chat,
    pub target_id: &'a str,
    pub target: Option<&'a AdapterInfo>,
    pub model: Option<&'a str>,
    pub queued: usize,
    /// The current provider's display name, for the background-work copy.
    pub from_name: &'a str,
}

/// `None` and `"default"` both mean "the adapter's default model".
pub(crate) fn is_default_model(model: Option<&str>) -> bool {
    model.is_none_or(|m| m.is_empty() || m == "default")
}

pub fn check_switch_allowed(c: &SwitchCheck<'_>) -> Result<(), SwitchError> {
    let target = c.target.filter(|t| t.installed).ok_or_else(|| {
        SwitchError::NotInstalled(c.target.map_or(c.target_id, |t| &t.name).to_string())
    })?;
    if let Some(model) = c.model.filter(|m| !is_default_model(Some(m)))
        && !target.models.iter().any(|m| m.id == model)
    {
        return Err(SwitchError::UnknownModel {
            model: model.to_string(),
            name: target.name.clone(),
        });
    }
    if c.chat.temporary && c.chat.parent_chat_id.as_ref().is_some_and(Option::is_some) {
        return Err(SwitchError::SideChat);
    }
    if c.chat.temporary {
        return Err(SwitchError::Temporary);
    }
    let working = c.chat.process_state == Some(Some(ProcessState::Working));
    let waiting = c.chat.display_status == Some(DisplayStatus::Waiting);
    if working || waiting {
        return Err(SwitchError::TurnInFlight);
    }
    if c.queued > 0 {
        return Err(SwitchError::Queued);
    }
    if c.chat
        .background_activity
        .as_ref()
        .is_some_and(|a| a.total > 0)
    {
        return Err(SwitchError::BackgroundWork(c.from_name.to_string()));
    }
    Ok(())
}
