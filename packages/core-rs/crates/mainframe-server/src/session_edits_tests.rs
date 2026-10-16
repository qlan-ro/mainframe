use super::*;
use mainframe_types::chat::ChatMessageType;
use mainframe_types::content::ToolResultImage;
use serde_json::json;

fn tool_use(id: &str, name: &str, file_path: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input: HashMap::from([("file_path".to_string(), json!(file_path))]),
        parent_tool_use_id: None,
    })
}

struct ToolResultSpec<'a> {
    id: &'a str,
    is_error: bool,
    original: Option<&'a str>,
    modified: Option<&'a str>,
    patch: Option<Vec<DiffHunk>>,
}

impl<'a> ToolResultSpec<'a> {
    fn ok(id: &'a str) -> Self {
        Self {
            id,
            is_error: false,
            original: None,
            modified: None,
            patch: None,
        }
    }
}

fn tool_result(r: ToolResultSpec<'_>) -> MessageContent {
    let images: Vec<ToolResultImage> = Vec::new();
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: r.id.to_string(),
        content: "ok".to_string(),
        is_error: r.is_error,
        structured_patch: r.patch,
        original_file: r.original.map(String::from),
        modified_file: r.modified.map(String::from),
        images,
        parent_tool_use_id: None,
    })
}

fn message(content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: "m".to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::Assistant,
        content,
        timestamp: "t".to_string(),
        metadata: None,
    }
}

fn hunk(old_start: i64, new_start: i64, lines: &[&str]) -> DiffHunk {
    let old_lines = lines.iter().filter(|l| !l.starts_with('+')).count() as i64;
    let new_lines = lines.iter().filter(|l| !l.starts_with('-')).count() as i64;
    DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: lines.iter().map(|l| l.to_string()).collect(),
    }
}

// ── file_edits ───────────────────────────────────────────────────────────────

#[test]
fn file_edits_groups_successful_edits_by_relative_path_in_first_touch_order() {
    let messages = vec![
        message(vec![
            tool_use("1", "Write", "/repo/src/b.ts"),
            tool_use("2", "Edit", "/repo/src/a.ts"),
            tool_use("3", "Read", "/repo/src/c.ts"),
            tool_use("4", "Edit", "/elsewhere/x.ts"),
            tool_use("5", "Edit", "/repo/src/b.ts"),
            tool_use("6", "Edit", "/repo/src/failed.ts"),
        ]),
        message(vec![
            tool_result(ToolResultSpec::ok("1")),
            tool_result(ToolResultSpec::ok("2")),
            tool_result(ToolResultSpec::ok("3")),
            tool_result(ToolResultSpec::ok("4")),
            tool_result(ToolResultSpec::ok("5")),
            tool_result(ToolResultSpec {
                is_error: true,
                ..ToolResultSpec::ok("6")
            }),
        ]),
    ];
    let edits = file_edits(&messages, "/repo");
    let summary: Vec<(&str, usize)> = edits.iter().map(|(p, e)| (p.as_str(), e.len())).collect();
    assert_eq!(summary, [("src/b.ts", 2), ("src/a.ts", 1)]);
    assert!(edits[0].1[0].is_write);
    assert!(!edits[0].1[1].is_write);
}

#[test]
fn file_edits_skips_a_tool_call_with_no_result_yet() {
    let messages = vec![message(vec![tool_use("1", "Edit", "/repo/a.ts")])];
    assert!(file_edits(&messages, "/repo").is_empty());
}

// ── reconstruct ──────────────────────────────────────────────────────────────

fn edit<'a>(
    is_write: bool,
    original: Option<&'a str>,
    modified: Option<&'a str>,
    patch: Option<&'a [DiffHunk]>,
) -> FileEdit<'a> {
    FileEdit {
        is_write,
        original_file: original,
        modified_file: modified,
        patch,
    }
}

#[test]
fn reconstruct_reads_recorded_originals_and_ignores_later_hand_edits() {
    let edits = [
        edit(false, Some("v1\n"), Some("v2\n"), None),
        edit(false, Some("v2\n"), Some("v3\n"), None),
    ];
    assert_eq!(
        reconstruct(&edits, Some("v3 plus a hand edit\n")),
        Some(("v1\n".to_string(), "v3\n".to_string()))
    );
}

#[test]
fn reconstruct_treats_a_write_with_no_original_as_a_new_file() {
    let edits = [edit(true, None, Some("fresh\n"), None)];
    assert_eq!(
        reconstruct(&edits, Some("fresh\n")),
        Some((String::new(), "fresh\n".to_string()))
    );
}

#[test]
fn reconstruct_reverses_patch_only_edits_from_the_working_file() {
    // Codex: no recorded contents, only hunks.
    let first = [hunk(2, 2, &[" b", "-c", "+C"])];
    let second = [hunk(1, 1, &["-a", "+A", " b"])];
    let edits = [
        edit(false, None, None, Some(&first)),
        edit(false, None, None, Some(&second)),
    ];
    assert_eq!(
        reconstruct(&edits, Some("A\nb\nC\n")),
        Some(("a\nb\nc\n".to_string(), "A\nb\nC\n".to_string()))
    );
}

#[test]
fn reconstruct_treats_a_codex_add_patch_as_a_new_file() {
    // Codex's add: one header-less hunk of raw, unprefixed lines; an indented
    // line reads like context, so only the zero old-side count marks it new.
    let add = [DiffHunk {
        old_start: 1,
        old_lines: 0,
        new_start: 1,
        new_lines: 0,
        lines: vec!["x".to_string(), "  y".to_string(), String::new()],
    }];
    let edits = [edit(true, None, None, Some(&add))];
    assert_eq!(
        reconstruct(&edits, Some("x\n  y\n")),
        Some((String::new(), "x\n  y\n".to_string()))
    );
}

#[test]
fn reconstruct_gives_up_when_a_patch_no_longer_matches() {
    let patch = [hunk(1, 1, &["-a", "+A"])];
    let edits = [edit(false, None, None, Some(&patch))];
    assert_eq!(reconstruct(&edits, Some("rewritten by hand\n")), None);
}

#[test]
fn reconstruct_gives_up_on_an_edit_with_neither_original_nor_patch() {
    let edits = [edit(false, None, None, None)];
    assert_eq!(reconstruct(&edits, Some("x\n")), None);
}

// ── reverse_apply ────────────────────────────────────────────────────────────

#[test]
fn reverse_apply_restores_removed_and_replaced_lines() {
    let hunks = [hunk(1, 1, &[" keep", "-gone", "-old", "+new", " tail"])];
    assert_eq!(
        reverse_apply("keep\nnew\ntail\n", &hunks).as_deref(),
        Some("keep\ngone\nold\ntail\n")
    );
}

#[test]
fn reverse_apply_undoes_several_hunks_regardless_of_their_order() {
    let hunks = [hunk(1, 1, &["-a", "+A"]), hunk(5, 5, &["-e", "+E"])];
    assert_eq!(
        reverse_apply("A\nb\nc\nd\nE\n", &hunks).as_deref(),
        Some("a\nb\nc\nd\ne\n")
    );
}

#[test]
fn reverse_apply_restores_a_pure_deletion_after_its_anchor_line() {
    let hunks = [DiffHunk {
        old_start: 2,
        old_lines: 1,
        new_start: 1,
        new_lines: 0,
        lines: vec!["-two".to_string()],
    }];
    assert_eq!(
        reverse_apply("one\nthree\n", &hunks).as_deref(),
        Some("one\ntwo\nthree\n")
    );
}

#[test]
fn reverse_apply_ignores_no_newline_markers() {
    let hunks = [hunk(1, 1, &["-a", "\\ No newline at end of file", "+b"])];
    assert_eq!(reverse_apply("b", &hunks).as_deref(), Some("a"));
}
