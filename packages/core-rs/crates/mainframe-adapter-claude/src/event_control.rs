use super::*;
pub(super) fn handle_control_request_event(event: &Value, sink: &dyn SessionSink) {
    let request = event.get("request");
    let is_can_use = request
        .and_then(|r| r.get("subtype"))
        .and_then(Value::as_str)
        == Some("can_use_tool");
    if let Some(request) = request.filter(|_| is_can_use) {
        let input = request
            .get("input")
            .and_then(Value::as_object)
            .map(|m| m.clone().into_iter().collect())
            .unwrap_or_default();
        let suggestions: Vec<ControlUpdate> = request
            .get("permission_suggestions")
            .and_then(|s| serde_json::from_value(s.clone()).ok())
            .unwrap_or_default();
        let perm_request = ControlRequest {
            request_id: event
                .get("request_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            tool_name: request
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            tool_use_id: request
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            input,
            suggestions,
            decision_reason: request
                .get("decision_reason")
                .and_then(Value::as_str)
                .map(str::to_string),
            options: None,
        };
        sink.on_permission(perm_request);
    } else {
        tracing::warn!(
            subtype = ?request.and_then(|r| r.get("subtype")),
            "Unhandled control_request subtype"
        );
    }
}
pub(super) fn handle_control_cancel_request_event(event: &Value, sink: &dyn SessionSink) {
    let request_id = event
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    if request_id.is_empty() {
        tracing::warn!("control_cancel_request with a missing or empty request_id, ignoring");
        return;
    }
    sink.on_permission_cancelled(request_id);
}
pub fn handle_control_response_event(
    session: &ClaudeSession,
    event: &Value,
    _sink: &dyn SessionSink,
) {
    let Some(response) = event.get("response") else {
        return;
    };
    let inner = response.get("response");
    if let Some(inner) = inner
        && inner.get("totalTokens").and_then(Value::as_i64).is_some()
        && inner.get("percentage").and_then(Value::as_f64).is_some()
    {
        let usage = ContextUsage {
            total_tokens: inner
                .get("totalTokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            max_tokens: inner.get("maxTokens").and_then(Value::as_i64).unwrap_or(0),
            percentage: inner
                .get("percentage")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        };
        _sink.on_context_usage(usage);
    }
    if let Some(request_id) = response.get("request_id").and_then(Value::as_str) {
        session.control.resolve(request_id, Some(response.clone()));
    }
}
