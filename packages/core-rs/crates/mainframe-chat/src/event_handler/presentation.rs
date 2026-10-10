use super::*;
use mainframe_types::transcript_presentation::{
    PRESENTATION_CONTEXT_KEY, PresentationState, PresentationUpdate, TranscriptPresentation,
};

pub(super) fn apply_update(current: &mut TranscriptPresentation, update: &TranscriptPresentation) {
    if !update.is_valid()
        || !current.same_turn(update)
        || current.state == PresentationState::Invalid
    {
        return;
    }
    current.state = update.state;
    if update.timing.is_some() {
        current.timing = update.timing.clone();
    }
}

/// Apply `update` to one cached message's presentation context. Returns
/// whether the stored value actually changed, so `MessageCache::update_in_place`
/// journals only real edits for the display projector.
fn update_message_presentation(message: &mut ChatMessage, update: &PresentationUpdate) -> bool {
    let presentation = &update.presentation;
    if update
        .source_message_ids
        .as_ref()
        .is_some_and(|ids| !ids.contains(&message.id))
    {
        return false;
    }
    let Some(value) = message
        .metadata
        .as_mut()
        .and_then(|meta| meta.get_mut(PRESENTATION_CONTEXT_KEY))
    else {
        return false;
    };
    let Ok(mut current) = serde_json::from_value::<TranscriptPresentation>(value.clone()) else {
        return false;
    };
    let eligible = current.same_turn(presentation) && current.state != PresentationState::Invalid;
    apply_update(&mut current, presentation);
    if eligible && update.source_message_ids.is_some() {
        current.phase = presentation.phase;
        current.final_eligible = presentation.final_eligible;
    }
    match serde_json::to_value(current) {
        Ok(updated) if updated != *value => {
            *value = updated;
            true
        }
        _ => false,
    }
}

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn partial_with_presentation(
        &self,
        id: &str,
        content: Vec<MessageContent>,
        presentation: TranscriptPresentation,
    ) {
        // Child completions remain available; the existing overlay slot belongs to the parent.
        if presentation.parent_tool_use_id.is_some() {
            return;
        }
        if !presentation.is_valid() {
            self.handle_message_partial(id, content);
            return;
        }
        let content = self.clean_content(content);
        self.partial_overlays.insert_with_presentation(
            &self.chat_id,
            self.session_key(),
            id,
            content,
            Some(presentation),
        );
        self.emit_display();
    }

    pub(super) fn update_presentation(&self, update: PresentationUpdate) {
        let presentation = &update.presentation;
        if !presentation.is_valid() {
            return;
        }
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .update_in_place(&self.chat_id, |message| {
                update_message_presentation(message, &update)
            });
        self.partial_overlays
            .update_presentation(&self.chat_id, self.session_key(), &update);
        self.emit_display();
    }
}
