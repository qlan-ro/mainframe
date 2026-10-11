use mainframe_adapter_api::pr_detection::extract_pr_from_tool_result;
use mainframe_display::truncate_tool_content::truncate_tool_content;
#[test]
fn ingestion_pr_detection_runs_on_full_content_unaffected_by_display_truncation() {
    let url = "https://github.com/acme/repo/pull/4242";
    let filler = (0..3000)
        .map(|i| format!("noise line {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let huge = format!("{filler}\n{url}\n{filler}");
    assert!(!truncate_tool_content(&huge).content.contains("4242"));
    let result = extract_pr_from_tool_result(&huge);
    assert_eq!(result.map(|p| p.number), Some(4242));
}
