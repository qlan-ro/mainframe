//! Handoff delivery on the first send of a segment: resolve an earlier
//! pending row from the native transcript, plan coverage (falling back to a
//! fresh native session when a delta would not fit), build the block from the
//! composed history, and record it as pending before the send. The turn's
//! result marks it delivered (`event_handler/sink_result.rs`).
use super::*;

use std::collections::HashSet;

use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, NativeSessionRecord, SegmentLayout, SegmentRecord,
};

use crate::handoff::budget::{BudgetInput, handoff_budget, native_used};
use crate::handoff::plan::{Coverage, full_coverage, needs_fresh_fallback, plan_coverage};
use crate::handoff::{BuiltHandoff, HandoffIdentity, SpanInput, build_handoff};
use crate::segments::SegmentStore;
use crate::segments::divider::{divider_id, is_divider, refresh_divider};

/// The outgoing message's size, for the budget. Attachments are priced at
/// the image allowance: the conservative choice before they are processed.
pub(super) struct OutgoingSize {
    pub text_bytes: u64,
    pub attachments: u64,
}

struct Planned {
    layout: SegmentLayout,
    coverage: Coverage,
    budget: u64,
    fell_back: bool,
}

impl ChatManager {
    /// The block to prepend to this send, or `None` when the active segment
    /// needs no handoff (first segment, context reset, already delivered).
    ///
    /// Held for the whole check-then-insert below (`resolve_live_handoff`
    /// through `insert_pending_handoff`): two sends for the same chat that
    /// both reach this function around the same time (the outbox's idle
    /// flush racing an independent new message, say) would otherwise both
    /// see no live handoff yet and both build and record one.
    pub(super) async fn prepare_handoff(
        &self,
        chat_id: &str,
        size: OutgoingSize,
    ) -> Result<Option<String>, SendError> {
        let _guard = self.handoff_locks.acquire(chat_id).await;
        let Some(store) = self.deps.segment_store() else {
            return Ok(None);
        };
        let Some(layout) = store
            .layout(chat_id)
            .filter(SegmentLayout::is_multi_segment)
        else {
            return Ok(None);
        };
        let Some(active) = layout.active().cloned() else {
            return Ok(None);
        };
        if self
            .resolve_live_handoff(store, chat_id, &layout, &active)
            .await
        {
            return Ok(None);
        }
        let Some(chat) = self.get_chat(chat_id) else {
            return Ok(None);
        };
        let Some(planned) = self
            .plan_handoff(store, &chat, layout, &active, &size)
            .await?
        else {
            return Ok(None);
        };
        self.build_and_record(store, &chat, &active, planned)
            .await
            .map(Some)
    }

    async fn plan_handoff(
        &self,
        store: &dyn SegmentStore,
        chat: &Chat,
        layout: SegmentLayout,
        active: &SegmentRecord,
        size: &OutgoingSize,
    ) -> Result<Option<Planned>, SendError> {
        let Some(native) = layout.native(&active.native_session_ref).cloned() else {
            return Ok(None);
        };
        let present = self.transcript_present(chat, &native).await;
        let Some(coverage) = plan_coverage(&layout, active, present) else {
            return Ok(None);
        };
        let budget = self.budget_for(chat, &native, size);
        if !needs_fresh_fallback(&coverage, budget) {
            return Ok(Some(Planned {
                layout,
                coverage,
                budget,
                fell_back: false,
            }));
        }
        let layout = store.replace_active_native(&chat.id).map_err(SendError)?;
        if let (Some(cell), Some(fresh)) =
            (self.get_active(&chat.id), self.deps.chats_get(&chat.id))
        {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat = fresh;
        }
        let fresh_native = NativeSessionRecord {
            adapter_id: native.adapter_id.clone(),
            ..Default::default()
        };
        let budget = self.budget_for(chat, &fresh_native, size);
        let coverage = full_coverage(&layout, active);
        Ok(Some(Planned {
            layout,
            coverage,
            budget,
            fell_back: true,
        }))
    }

    fn budget_for(&self, chat: &Chat, native: &NativeSessionRecord, size: &OutgoingSize) -> u64 {
        let model = chat.model.clone();
        let model_window = self.deps.adapter_info(&native.adapter_id).and_then(|info| {
            let found = info
                .models
                .iter()
                .find(|m| Some(&m.id) == model.as_ref())
                .or_else(|| info.models.iter().find(|m| m.is_default == Some(true)));
            found
                .and_then(|m| m.context_window)
                .map(|w| w.max(0) as u64)
        });
        handoff_budget(&BudgetInput {
            model_window,
            native_max: native.last_context_max_tokens,
            native_used: native_used(
                native.last_context_total_tokens,
                native.last_context_tokens_input,
                0,
            ),
            user_text_bytes: size.text_bytes,
            images: size.attachments,
            files: 0,
        })
    }

    async fn build_and_record(
        &self,
        store: &dyn SegmentStore,
        chat: &Chat,
        active: &SegmentRecord,
        planned: Planned,
    ) -> Result<String, SendError> {
        let identity = HandoffIdentity {
            segment_marker: active
                .start_marker
                .clone()
                .unwrap_or_else(|| active.id.clone()),
            handoff_id: format!("ho_{}", nanoid::nanoid!()),
            strategy: planned.coverage.strategy,
            title: chat.title.clone().unwrap_or_default(),
            chat_id: chat.id.clone(),
            chat_read_available: self.deps.orchestration_mcp_attached(&chat.id),
        };
        let built = self.build_block(chat, &identity, &planned).await?;
        let record = handoff_record(&identity, active, &planned, &built);
        store
            .insert_pending_handoff(&record, &identity.segment_marker)
            .map_err(SendError)?;
        let name_of = |id: &str| self.deps.adapter_fork_info(id).name;
        if refresh_divider(&self.messages, store, &chat.id, &active.id, &name_of) {
            self.event_handler.emit_display(&chat.id);
        }
        Ok(built.block)
    }

    /// Maps the composed history (split at its dividers) and builds the block.
    async fn build_block(
        &self,
        chat: &Chat,
        identity: &HandoffIdentity,
        planned: &Planned,
    ) -> Result<BuiltHandoff, SendError> {
        let composed = self.get_messages(&chat.id).await;
        let segments = &planned.layout.segments;
        let names: Vec<String> = segments
            .iter()
            .map(|s| self.adapter_name_of(&planned.layout, s))
            .collect();
        let slices = split_by_segment(&composed, &planned.layout);
        let spans: Vec<SpanInput<'_>> = segments
            .iter()
            .zip(&names)
            .zip(&slices)
            .map(|((segment, name), slice)| SpanInput {
                provider: name,
                messages: slice,
                covered: planned.coverage.ordinals.contains(&segment.ordinal),
            })
            .collect();
        let subagents: HashSet<String> = self
            .deps
            .get_tool_categories(&chat.id)
            .map(|c| c.subagent)
            .unwrap_or_default();
        build_handoff(identity, &spans, &subagents, planned.budget).map_err(|_| {
            let to_name = self.deps.adapter_fork_info(&chat.adapter_id).name;
            SendError(format!(
                "This message is too large to send with {to_name}'s context handoff. Shorten it or remove attachments."
            ))
        })
    }

    fn adapter_name_of(&self, layout: &SegmentLayout, segment: &SegmentRecord) -> String {
        let adapter = layout
            .native(&segment.native_session_ref)
            .map(|n| n.adapter_id.clone())
            .unwrap_or_default();
        self.deps.adapter_fork_info(&adapter).name
    }
}

/// The composed history cut at its dividers, one slice per segment in
/// ordinal order (dividers excluded). A segment whose divider is missing
/// from the cache gets an empty slice.
fn split_by_segment(messages: &[ChatMessage], layout: &SegmentLayout) -> Vec<Vec<ChatMessage>> {
    let mut slices: Vec<Vec<ChatMessage>> = vec![Vec::new(); layout.segments.len()];
    let mut current = 0usize;
    for message in messages {
        if is_divider(message) {
            if let Some(index) = layout
                .segments
                .iter()
                .position(|s| divider_id(&s.id) == message.id)
            {
                current = index;
            }
            continue;
        }
        if let Some(slice) = slices.get_mut(current) {
            slice.push(message.clone());
        }
    }
    slices
}

fn handoff_record(
    identity: &HandoffIdentity,
    active: &SegmentRecord,
    planned: &Planned,
    built: &BuiltHandoff,
) -> HandoffRecord {
    HandoffRecord {
        id: identity.handoff_id.clone(),
        chat_id: identity.chat_id.clone(),
        target_segment_id: active.id.clone(),
        strategy: planned.coverage.strategy,
        covered_from_ordinal: planned.coverage.from_ordinal(),
        covered_to_ordinal: planned.coverage.to_ordinal(),
        item_count: built.item_count,
        omitted_count: built.omitted_count,
        budget_bytes: planned.budget,
        used_bytes: built.used_bytes,
        fell_back_to_fresh: planned.fell_back,
        status: HandoffStatus::Pending,
        created_at: now_iso8601(),
        delivered_at: None,
    }
}
