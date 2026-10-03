//! The per-chat projection slot (todo #376): a [`DisplayProjector`] plus its
//! [`RawChanges`] journal, kept alongside the raw cache like `tool_timings`.
//! Every cache mutation records into the journal (see the table in the plan's
//! "Journal and lifecycle" section); every removal path drops the slot
//! entirely, so the next projection call rebuilds from scratch and emits a
//! `Full` delta.

use mainframe_display::{DisplayDelta, DisplayProjector, ProjectionInput, RawChange, RawChanges};
use mainframe_types::display::{DisplayMessage, ToolCategories};

use super::*;

pub(crate) struct ProjectionSlot {
    projector: Box<dyn DisplayProjector>,
    journal: RawChanges,
    /// A delta a resume snapshot produced but did not emit (todo #382): the
    /// next live emission merges it in first, so a connection that never saw
    /// the snapshot's state still catches up. `None` once a live emission has
    /// consumed it.
    pending: Option<DisplayDelta>,
}

impl MessageCache {
    /// Record one raw-cache mutation into `chat_id`'s journal, when it has a
    /// live projection slot. A chat with no slot yet (never projected, or
    /// just dropped) has nothing to journal — its next projection call starts
    /// fresh and rebuilds from the raw cache directly.
    pub(crate) fn record_change(&mut self, chat_id: &str, change: RawChange) {
        if let Some(slot) = self.projections.get_mut(chat_id) {
            slot.journal.push(change);
        }
    }

    /// Drop `chat_id`'s projection slot. Called by every mutation path the
    /// plan's table marks as a full-rebuild trigger (`set`, `set_and_snapshot`,
    /// `delete`, `release`, eviction).
    pub(crate) fn drop_projection(&mut self, chat_id: &str) {
        self.projections.remove(chat_id);
    }

    /// Bring `chat_id`'s projection current: drain its journal, run the
    /// projector over the raw cache plus `overlay`, and return the resulting
    /// delta. Creates a fresh slot via `make_projector` when none exists yet
    /// (first call, or one dropped by a lifecycle mutation) — a fresh
    /// projector always emits `Full` on its first `project` call.
    fn advance_projection(
        &mut self,
        chat_id: &str,
        overlay: Option<&ChatMessage>,
        categories: Option<&ToolCategories>,
        make_projector: impl FnOnce() -> Box<dyn DisplayProjector>,
    ) -> DisplayDelta {
        let raw: &[ChatMessage] = self.cache.get(chat_id).map(Vec::as_slice).unwrap_or(&[]);
        let slot = self
            .projections
            .entry(chat_id.to_string())
            .or_insert_with(|| ProjectionSlot {
                projector: make_projector(),
                journal: RawChanges::new(),
                pending: None,
            });
        let changes = std::mem::replace(&mut slot.journal, RawChanges::new());
        slot.projector.project(ProjectionInput {
            raw,
            changes,
            overlay,
            categories,
        })
    }

    /// The live-emission step (`emit_display_for`): advance the projection and
    /// fold in any delta a resume snapshot stashed since the last emission —
    /// the pending delta is older, so it merges as the base with this call's
    /// delta on top.
    pub fn project_display(
        &mut self,
        chat_id: &str,
        overlay: Option<&ChatMessage>,
        categories: Option<&ToolCategories>,
        make_projector: impl FnOnce() -> Box<dyn DisplayProjector>,
    ) -> DisplayDelta {
        let delta = self.advance_projection(chat_id, overlay, categories, make_projector);
        let pending = self
            .projections
            .get_mut(chat_id)
            .and_then(|slot| slot.pending.take());
        match pending {
            Some(pending) => pending.merge(delta),
            None => delta,
        }
    }

    /// The resume-snapshot step (`get_resume_snapshot`): advance the
    /// projection the exact same way the live path does, but never notify.
    /// Any non-empty delta this produces becomes (or extends) the slot's
    /// pending delta, so the next live emission carries it forward; the
    /// snapshot's materialized list is returned to the caller.
    pub fn display_snapshot(
        &mut self,
        chat_id: &str,
        overlay: Option<&ChatMessage>,
        categories: Option<&ToolCategories>,
        make_projector: impl FnOnce() -> Box<dyn DisplayProjector>,
    ) -> Vec<DisplayMessage> {
        let delta = self.advance_projection(chat_id, overlay, categories, make_projector);
        let materialized = delta.snapshot.materialize();
        if let Some(slot) = self.projections.get_mut(chat_id) {
            slot.pending = Some(match slot.pending.take() {
                Some(pending) => pending.merge(delta),
                None => delta,
            });
        }
        materialized
    }
}

#[cfg(test)]
mod tests;
