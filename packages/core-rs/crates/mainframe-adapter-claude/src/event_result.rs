use super::*;
pub(super) fn handle_result_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    session
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .presentation
        .finish(event, sink);
    surface_command_error(event, sink);
    let last_usage = {
        let mut st = session.state.lock().unwrap_or_else(|e| e.into_inner());
        st.partial.clear();
        st.last_assistant_usage.take()
    };
    let (context_tokens, usage, tokens_input, tokens_output) = result_usage(last_usage, event);
    session.clear_interrupt_timer();

    tracing::debug!(
        session_id = %session.id,
        subtype = ?event.get("subtype"),
        "handling result event for parent session"
    );

    sink.on_result(SessionResult {
        total_cost_usd: Some(
            event
                .get("total_cost_usd")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
        usage: usage.as_ref().map(|u| MessageUsage {
            input_tokens: Some(tokens_input),
            output_tokens: Some(tokens_output),
            cache_creation_input_tokens: u.cache_creation_input_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
        }),
        context_tokens,
        subtype: event
            .get("subtype")
            .and_then(Value::as_str)
            .map(str::to_string),
        result: None,
        is_error: event.get("is_error").and_then(Value::as_bool),
    });
    session.request_context_usage();
}

fn result_usage(
    last_usage: Option<MessageUsage>,
    event: &Value,
) -> (Option<i64>, Option<MessageUsage>, i64, i64) {
    let context_tokens: Option<i64> = last_usage.as_ref().map(|u| {
        u.input_tokens.unwrap_or(0)
            + u.cache_creation_input_tokens.unwrap_or(0)
            + u.cache_read_input_tokens.unwrap_or(0)
    });
    let usage: Option<MessageUsage> = last_usage.or_else(|| {
        event
            .get("usage")
            .and_then(|u| serde_json::from_value::<MessageUsage>(u.clone()).ok())
    });
    let tokens_input = usage
        .as_ref()
        .map(|u| {
            u.input_tokens.unwrap_or(0)
                + u.cache_creation_input_tokens.unwrap_or(0)
                + u.cache_read_input_tokens.unwrap_or(0)
        })
        .unwrap_or(0);
    let tokens_output = usage.as_ref().and_then(|u| u.output_tokens).unwrap_or(0);
    (context_tokens, usage, tokens_input, tokens_output)
}

fn surface_command_error(event: &Value, sink: &dyn SessionSink) {
    let result_text = event
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !result_text.is_empty() {
        let lower = result_text.to_lowercase();
        if lower.starts_with("unknown command:") || lower.starts_with("unknown skill:") {
            sink.on_cli_message(result_text);
        }
    }
}
