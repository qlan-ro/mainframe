use super::*;
use tokio::io::AsyncWriteExt;

#[derive(Default)]
struct ErrorSink(Mutex<Vec<String>>);

impl SessionSink for ErrorSink {
    mainframe_adapter_api::forward_session_sink!(
        on_init,
        on_message,
        on_tool_result,
        on_permission,
        on_result,
        on_exit,
        on_compact,
        on_compact_start,
        on_context_usage,
        on_plan_file,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );

    fn on_error(&self, error: AdapterError) {
        self.0.lock().unwrap().push(error.to_string());
    }
}

#[tokio::test]
async fn stderr_frames_split_diagnostics_and_preserves_a_final_error() {
    let s = session();
    let sink = Arc::new(ErrorSink::default());
    let (mut writer, reader) = tokio::io::duplex(1);
    let pump = s.start_stderr(Some(reader), sink.clone()).unwrap();
    writer.write_all(concat!(
        "[claude-code:unrecognized_model] {\"model\":\"gpt-6-astra\",\"query_source\":\"compact\"}\r\n",
        "⚠ claude.ai connectors are disabled because ANTHROPIC_AUTH_TOKEN is set\n",
        "Warning: diagnostic\n",
        "API Error: request failed"
    ).as_bytes()).await.unwrap();
    drop(writer);
    tokio::time::timeout(Duration::from_secs(2), pump)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(*sink.0.lock().unwrap(), ["API Error: request failed"]);
}

#[tokio::test]
async fn stderr_does_not_hide_an_error_in_the_same_read_as_a_warning() {
    let s = session();
    let sink = Arc::new(ErrorSink::default());
    let input: &[u8] = b"Warning: advisory\nFatalError: process failed\n";
    s.start_stderr(Some(input), sink.clone())
        .unwrap()
        .await
        .unwrap();
    assert_eq!(*sink.0.lock().unwrap(), ["FatalError: process failed"]);
}
