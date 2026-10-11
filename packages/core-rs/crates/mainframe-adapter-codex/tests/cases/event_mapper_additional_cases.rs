#[test]
fn hook_prompt_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "hook_1",
            "type": "hookPrompt",
            "fragments": [{ "text": "run lint", "hookRunId": "run_1" }],
        }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}
