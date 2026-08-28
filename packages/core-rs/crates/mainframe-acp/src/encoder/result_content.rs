//! Tool-result content assembly for the canonical encoder: the preview text
//! block (with its namespaced truncation marker, spec Decision 20) and the
//! `diff` entry an Edit/Write result maps to (spec Decision 15).

use std::collections::HashMap;

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{
    MAINFRAME_META_NAMESPACE, StructuredDiff, TruncationMarker,
};
use mainframe_types::acp::tool_call::{
    Diff, DiffChange, DiffFileType, DiffOperation, DiffPatch, DiffPatchFormat, ToolCallContent,
};
use mainframe_types::chat::DiffHunk;
use mainframe_types::display::ToolCallResult;
use serde_json::{Value, json};

pub(super) fn result_content(
    name: &str,
    input: &HashMap<String, Value>,
    result: &Option<ToolCallResult>,
) -> Vec<ToolCallContent> {
    let Some(r) = result else {
        return Vec::new();
    };
    let mut out = vec![ToolCallContent::Content {
        content: ContentBlock::Text {
            text: r.content.clone(),
            meta: truncation_meta(r),
        },
    }];
    out.extend(diff_content(name, input, r));
    out
}

/// A daemon-truncated result marks its preview text block with the
/// namespaced `truncated`/`fullBytes` pair (spec Decision 20) — the joined
/// text alone cannot say "this is a preview of N bytes", which the legacy
/// dialect's `ToolCallResult` carries inline and the expand affordance needs.
fn truncation_meta(result: &ToolCallResult) -> Option<Value> {
    if result.truncated != Some(true) {
        return None;
    }
    let full_bytes = result.full_bytes?;
    let marker = TruncationMarker {
        truncated: true,
        full_bytes,
    };
    Some(json!({ MAINFRAME_META_NAMESPACE: marker }))
}

/// A result carrying structured hunks becomes a `diff` content entry after
/// the text block: `changes` + `patch` are the ACP-conformant surface a
/// generic client renders, and the hunks/full-file text the desktop Edit/
/// Write cards consume ride the diff's own `_meta["_mainframe.dev"]`
/// (spec Decision 15).
fn diff_content(
    name: &str,
    input: &HashMap<String, Value>,
    result: &ToolCallResult,
) -> Option<ToolCallContent> {
    let hunks = result.structured_patch.as_ref()?;
    let path = input.get("file_path").and_then(Value::as_str)?;
    // A `Write` with no pre-image created the file; anything else that
    // produced hunks modified one in place.
    let is_add = name == "Write" && result.original_file.is_none();
    let operation = if is_add {
        DiffOperation::Add {
            path: path.to_string(),
        }
    } else {
        DiffOperation::Modify {
            path: path.to_string(),
        }
    };
    let fidelity = StructuredDiff {
        structured_patch: hunks.clone(),
        original_file: result.original_file.clone(),
        modified_file: result.modified_file.clone(),
    };
    Some(ToolCallContent::Diff(Diff {
        changes: vec![DiffChange {
            operation,
            file_type: Some(DiffFileType::Text),
            mime_type: None,
            meta: None,
        }],
        patch: Some(DiffPatch {
            format: DiffPatchFormat::GitPatch,
            text: git_patch_text(path, is_add, hunks),
        }),
        meta: Some(json!({ MAINFRAME_META_NAMESPACE: fidelity })),
    }))
}

/// Git `--patch` text per the pinned v2 doc example: bare absolute paths (no
/// `a/`/`b/` prefixes), `/dev/null` as the pre-image of an added file, no
/// commit metadata. `DiffHunk.lines` already carry their `+`/`-`/` ` prefix.
fn git_patch_text(path: &str, is_add: bool, hunks: &[DiffHunk]) -> String {
    let old = if is_add { "/dev/null" } else { path };
    let mut text = format!("diff --git {path} {path}\n--- {old}\n+++ {path}\n");
    for h in hunks {
        text.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            h.old_start, h.old_lines, h.new_start, h.new_lines
        ));
        for line in &h.lines {
            text.push_str(line);
            text.push('\n');
        }
    }
    text
}
