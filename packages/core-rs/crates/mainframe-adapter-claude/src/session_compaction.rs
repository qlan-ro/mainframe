use super::*;
use mainframe_adapter_api::idle_compaction::*;

impl ClaudeSession {
    pub(crate) fn is_retired_maintenance_event(&self, event: &Value) -> bool {
        event
            .get("uuid")
            .and_then(Value::as_str)
            .is_some_and(|id| self.maintenance_ids.lock_recover().contains(id))
    }
    pub(super) async fn compact_idle(
        &self,
        request: NativeCompactionRequest,
    ) -> Result<CompactionMetadata, AdapterError> {
        if !self.is_spawned() || request.session_generation != self.id {
            return Err(AdapterError::NotSpawned(self.id.clone()));
        }
        let receiver = self.maintenance.begin(request.clone())?;
        self.maintenance_ids
            .lock_recover()
            .insert(request.command_uuid.clone());
        if let Err(error) = self.write_command("compact", "", Some(&request.command_uuid), true) {
            self.maintenance.finish(false);
            return Err(error);
        }
        self.maintenance
            .wait(receiver, CLAUDE_COMPACTION_TIMEOUT_MS)
            .await
    }
    pub(crate) fn handle_maintenance_event(&self, event: &Value, sink: &dyn SessionSink) -> bool {
        if !self.maintenance.suppressing() {
            return self.is_retired_maintenance_event(event);
        }
        let ty = event.get("type").and_then(Value::as_str);
        let subtype = event.get("subtype").and_then(Value::as_str);
        let request = self.maintenance.request();
        if ty == Some("system")
            && subtype == Some("compact_boundary")
            && let Some(request) = &request
        {
            let vendor_id = event.get("uuid").and_then(Value::as_str);
            if let Some(id) = vendor_id {
                self.maintenance_ids.lock_recover().insert(id.to_owned());
            }
            let mut metadata = request.metadata(vendor_id);
            metadata.before_tokens = event
                .pointer("/compact_metadata/pre_tokens")
                .and_then(Value::as_u64);
            metadata.after_tokens = event
                .pointer("/compact_metadata/post_tokens")
                .and_then(Value::as_u64);
            if self.maintenance.record(metadata.clone()) {
                sink.on_compact_with_metadata(metadata);
            }
        }
        if ty == Some("result") && event.get("parent_tool_use_id").is_none_or(Value::is_null) {
            let success = event.get("is_error").and_then(Value::as_bool) != Some(true)
                && subtype == Some("success");
            self.maintenance.finish(success);
            if let Some(request) = request {
                sink.on_maintenance_result(request, maintenance_result(subtype, success));
            }
        }
        !matches!(ty, Some("control_response" | "rate_limit_event"))
    }
}

fn maintenance_result(
    subtype: Option<&str>,
    success: bool,
) -> mainframe_types::adapter::SessionResult {
    mainframe_types::adapter::SessionResult {
        subtype: subtype.map(str::to_owned),
        is_error: Some(!success),
        total_cost_usd: None,
        usage: None,
        context_tokens: None,
        result: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::tests::{session, spawned_with_stdin};
    use mainframe_adapter_api::test_support::RecordingSink;
    fn request(session: &ClaudeSession) -> NativeCompactionRequest {
        NativeCompactionRequest {
            id: "idle-compact:chat:run".into(),
            session_generation: session.id.clone(),
            origin: CompactionOrigin::Idle,
            command_uuid: "00000000-0000-4000-8000-000000000001".into(),
        }
    }
    fn emit(session: &ClaudeSession, event: Value, sink: &dyn SessionSink) {
        let mut bytes = serde_json::to_vec(&event).unwrap();
        bytes.push(b'\n');
        crate::events::handle_stdout(session, &bytes, sink);
    }
    #[tokio::test]
    async fn native_command_has_uuid_and_suppresses_activity_until_terminal_result() {
        let session = session();
        let mut stdin = spawned_with_stdin(&session);
        let before = session.last_activity_at();
        let sink = RecordingSink::default();
        let req = request(&session);
        let future = session.compact_idle(req.clone());
        tokio::pin!(future);
        tokio::select! { result=&mut future => panic!("premature result {result:?}"), bytes=stdin.recv() => {
            let payload:Value=serde_json::from_slice(&bytes.unwrap()).unwrap();
            assert_eq!(payload["uuid"], req.command_uuid);
            assert!(payload["message"]["content"][0]["text"].as_str().unwrap().contains("<command-name>/compact</command-name>"));
        }}
        emit(
            &session,
            json!({"type":"user","uuid":req.command_uuid,"message":{"content":"internal echo"}}),
            &sink,
        );
        emit(
            &session,
            json!({"type":"system","subtype":"compact_boundary","uuid":"boundary","compact_metadata":{"pre_tokens":22000,"post_tokens":2000}}),
            &sink,
        );
        assert_eq!(session.last_activity_at(), before);
        assert!(!session.maintenance.ready());
        emit(
            &session,
            json!({"type":"result","subtype":"success","is_error":false}),
            &sink,
        );
        let metadata = future.await.unwrap();
        assert_eq!(metadata.before_tokens, Some(22000));
        assert_eq!(metadata.after_tokens, Some(2000));
        assert_eq!(metadata.command_uuid, Some(req.command_uuid));
        assert_eq!(sink.compactions.lock().unwrap().len(), 1);
        assert_eq!(sink.maintenance_results.lock().unwrap().len(), 1);
        assert!(session.maintenance.ready());
        assert_eq!(session.last_activity_at(), before);
    }
    #[tokio::test]
    async fn real_stdin_activity_is_retained_during_maintenance() {
        let session = session();
        let _stdin = spawned_with_stdin(&session);
        session.shared.last_activity_ms.store(1, Ordering::SeqCst);
        let _rx = session.maintenance.begin(request(&session)).unwrap();
        session.write_stdin("real user input".into()).unwrap();
        let real = session.last_activity_at();
        assert!(real > 1);
        session.maintenance.finish(false);
        assert_eq!(session.last_activity_at(), real);
    }
}

#[cfg(test)]
mod failure_tests {
    use super::*;
    use crate::session::tests::{session, spawned_with_stdin};
    use mainframe_adapter_api::test_support::RecordingSink;
    fn request(session: &ClaudeSession) -> NativeCompactionRequest {
        NativeCompactionRequest {
            id: "idle:test".into(),
            session_generation: session.id.clone(),
            origin: CompactionOrigin::Idle,
            command_uuid: "command".into(),
        }
    }
    #[tokio::test]
    async fn failed_dispatch_and_stale_generation_do_not_leave_provider_busy() {
        let session = session();
        assert!(session.compact_idle(request(&session)).await.is_err());
        let mut stdin = spawned_with_stdin(&session);
        let mut stale = request(&session);
        stale.session_generation = "old".into();
        assert!(session.compact_idle(stale).await.is_err());
        assert!(stdin.try_recv().is_err());
        session.set_stdin_for_test(None);
        assert!(session.compact_idle(request(&session)).await.is_err());
        assert!(session.ready_for_input());
    }
    #[tokio::test]
    async fn late_internal_echo_and_boundary_do_not_touch_activity_or_emit_again() {
        let session = session();
        let sink = RecordingSink::default();
        session
            .maintenance_ids
            .lock()
            .unwrap()
            .insert("internal".into());
        session.shared.last_activity_ms.store(42, Ordering::SeqCst);
        for event in [
            json!({"type":"user","uuid":"internal","message":{"content":"echo"}}),
            json!({"type":"system","subtype":"compact_boundary","uuid":"internal"}),
        ] {
            let mut bytes = serde_json::to_vec(&event).unwrap();
            bytes.push(b'\n');
            crate::events::handle_stdout(&session, &bytes, &sink);
        }
        assert_eq!(session.last_activity_at(), 42);
        assert!(sink.compactions.lock().unwrap().is_empty());
    }
}
