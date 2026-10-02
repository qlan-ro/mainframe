use super::*;

/// The callback surface a live session drives (mirrors the TS `SessionSink`).
/// Every method is synchronous `void` in TS; kept synchronous here (see the
/// module doc). `Send + Sync` so the session's stdout reader task can own an
/// `Arc<dyn SessionSink>`.
pub trait SessionSink: Send + Sync {
    fn on_message_with_presentation(
        &self,
        content: Vec<MessageContent>,
        metadata: Option<MessageMetadata>,
        _presentation: mainframe_types::transcript_presentation::TranscriptPresentation,
    ) {
        self.on_message(content, metadata);
    }

    fn on_message_partial_with_presentation(
        &self,
        api_message_id: &str,
        content: Vec<MessageContent>,
        _presentation: mainframe_types::transcript_presentation::TranscriptPresentation,
    ) {
        self.on_message_partial(api_message_id, content);
    }

    fn on_presentation_update(
        &self,
        _presentation: mainframe_types::transcript_presentation::PresentationUpdate,
    ) {
    }

    fn on_init(&self, session_id: &str);
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>);
    /// `vendor_id` mirrors `on_message`'s `MessageMetadata::vendor_id` — the
    /// adapter's own stable id for this tool-result entry, used as the
    /// `ChatMessage.id` in place of a minted nanoid (todo #350 group B).
    fn on_tool_result(&self, content: Vec<MessageContent>, vendor_id: Option<String>);
    fn on_permission(&self, request: ControlRequest);
    /// The CLI withdrew a control request it already sent
    /// (`control_cancel_request`). Implementations remove the named pending
    /// permission and must never treat it as an answer. Default no-op: adapters
    /// whose CLI has no cancel frame need not implement it.
    fn on_permission_cancelled(&self, _request_id: &str) {}
    fn on_result(&self, data: SessionResult);
    fn on_exit(&self, code: Option<i32>);
    fn on_error(&self, error: AdapterError);
    /// `vendor_id` is the adapter's stable id for the compaction transcript
    /// entry (Claude's JSONL `uuid`, Codex's `contextCompaction` item id) —
    /// `None` only for a path with no id available (Codex's deprecated
    /// `thread/compacted` notification). Threaded through so the pill's live
    /// id matches what history reconstruction would assign it (T15, R3.14).
    fn on_compact(&self, vendor_id: Option<&str>);
    fn on_compact_start(&self);
    fn on_context_usage(&self, usage: ContextUsage);
    fn on_plan_file(&self, file_path: &str);
    fn on_skill_file(&self, entry: SkillFileEntry);
    fn on_queued_processed(&self, uuid: &str);
    fn on_todo_update(&self, todos: Vec<TodoItem>);
    fn on_pr_detected(&self, pr: DetectedPr);
    /// CLI-synthesized feedback text (e.g. unknown-command errors).
    fn on_cli_message(&self, text: &str);
    /// A skill was loaded via slash-command; render a collapsible card.
    fn on_skill_loaded(&self, entry: LoadedSkill);
    /// Inline content blocks from a subagent stream event; each block's
    /// `parentToolUseId` must already equal `parent_tool_use_id`. Implementations
    /// no-op silently if it matches no known tool_use block.
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>);
    /// Non-fatal advisory (`onTrustRequired?`) — optional in TS, default no-op.
    fn on_trust_required(&self, _project_path: &str) {}
    /// Account-wide provider plan quota (`onProviderQuota?`) — optional in TS,
    /// default no-op; no chatId, mirrors `on_context_usage`.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}
    /// Claude's `PushNotification` tool call, forwarded raw; the sink owns
    /// trimming, truncation and dedupe (todo #293). Default no-op: adapters
    /// with no such tool need not implement it.
    fn on_attention_request(&self, _message: &str) {}
    /// The CLI retried an API call after a transient error (Claude's
    /// `system`/`api_error` transcript entry — see
    /// `docs/research/adapters/claude/CLAUDE-JSONL-SCHEMA.md`'s `api_error`
    /// section; todo #350 group D task 11). `reason` is the adapter's raw
    /// error text, not a categorized taxonomy. Default no-op: adapters with
    /// no retry-reporting event need not implement it, and today's daemon
    /// drops it exactly as before (fact 1) until a sink overrides this.
    fn on_api_retry(&self, _attempt: i64, _reason: Option<String>) {}
    /// The in-flight assistant message's partial content, re-sent accumulated
    /// on every call (Claude's `--include-partial-messages` stream deltas,
    /// todo #350: AGENT-SDK-PARITY B4). `api_message_id` is the provider
    /// message id (`message_start`'s `message.id`) — the one vendor identifier
    /// known before the block completes, and the id `on_message` will carry as
    /// `vendor_id` for that message's first completed block, so a sink can
    /// anchor partial content to the item the completed message becomes.
    /// Default no-op: adapters without partial streaming need not implement it.
    fn on_message_partial(&self, _api_message_id: &str, _content: Vec<MessageContent>) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    struct LegacySink(std::sync::Mutex<Vec<&'static str>>);
    impl SessionSink for LegacySink {
        fn on_init(&self, _session_id: &str) {}
        fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
            self.0.lock().unwrap().push("message");
        }
        fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
        fn on_permission(&self, _request: ControlRequest) {}
        fn on_result(&self, _data: SessionResult) {}
        fn on_exit(&self, _code: Option<i32>) {}
        fn on_error(&self, _error: AdapterError) {}
        fn on_compact(&self, _vendor_id: Option<&str>) {}
        fn on_compact_start(&self) {}
        fn on_context_usage(&self, _usage: ContextUsage) {}
        fn on_plan_file(&self, _file_path: &str) {}
        fn on_skill_file(&self, _entry: SkillFileEntry) {}
        fn on_queued_processed(&self, _uuid: &str) {}
        fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
        fn on_pr_detected(&self, _pr: DetectedPr) {}
        fn on_cli_message(&self, _text: &str) {}
        fn on_skill_loaded(&self, _entry: LoadedSkill) {}
        fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
        fn on_message_partial(&self, _id: &str, _content: Vec<MessageContent>) {
            self.0.lock().unwrap().push("partial");
        }
    }
    #[test]
    fn contextual_defaults_delegate_to_old_adapter_callbacks() {
        use mainframe_types::transcript_presentation::*;
        let sink = LegacySink(std::sync::Mutex::new(Vec::new()));
        let presentation = TranscriptPresentation {
            version: 1,
            provider: "legacy".into(),
            turn_id: "t".into(),
            parent_tool_use_id: None,
            phase: None,
            state: PresentationState::Unknown,
            final_eligible: false,
            timing: None,
        };
        sink.on_message_with_presentation(Vec::new(), None, presentation.clone());
        sink.on_message_partial_with_presentation("id", Vec::new(), presentation.clone());
        sink.on_presentation_update(PresentationUpdate {
            presentation,
            source_message_ids: None,
        });
        assert_eq!(*sink.0.lock().unwrap(), ["message", "partial"]);
    }
}
