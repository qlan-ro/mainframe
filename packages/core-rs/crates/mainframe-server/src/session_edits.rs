//! A session's file edits, read back from its transcript: which files it wrote
//! or edited, and each file's content before and after the session touched it.
//!
//! Git cannot answer "what did this session change" once the session commits,
//! so the review modal's Session scope reads it from the Write/Edit tool calls.
//! Adapters record edits at different fidelities: Claude results carry the full
//! file before (`original_file`) and after (`modified_file`) each edit; Codex
//! results carry only the patch hunks. `reconstruct` walks a file's edits from
//! newest to oldest, taking a recorded original where one exists and
//! reverse-applying the hunks where it does not.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, DiffHunk, MessageContent, MessageContentNode};

use crate::fs_utils::relative_within;

const FILE_TOOLS: [&str; 2] = ["Write", "Edit"];

/// One successful Write/Edit of a file, paired with its tool result.
#[derive(Debug, Clone, Copy)]
pub struct FileEdit<'a> {
    pub is_write: bool,
    pub original_file: Option<&'a str>,
    pub modified_file: Option<&'a str>,
    pub patch: Option<&'a [DiffHunk]>,
}

impl FileEdit<'_> {
    /// A Write with no prior content: no recorded original, and no hunk with an
    /// old side. Codex records a new file as one header-less hunk of its raw
    /// lines, so the line prefixes cannot be trusted; the old-side count can.
    pub fn creates_file(&self) -> bool {
        self.is_write
            && self.original_file.is_none()
            && self
                .patch
                .is_none_or(|hunks| hunks.iter().all(|hunk| hunk.old_lines == 0))
    }
}

/// The edits per file, keyed by `base`-relative path, in first-touch order.
/// Failed tool calls and files outside `base` are skipped.
pub fn file_edits<'a>(messages: &'a [ChatMessage], base: &str) -> Vec<(String, Vec<FileEdit<'a>>)> {
    let mut results: HashMap<&str, &'a MessageContentNode> = HashMap::new();
    for block in messages.iter().flat_map(|m| &m.content) {
        if let MessageContent::Node(node @ MessageContentNode::ToolResult { tool_use_id, .. }) =
            block
        {
            results.insert(tool_use_id.as_str(), node);
        }
    }

    let mut order: Vec<(String, Vec<FileEdit<'a>>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for block in messages.iter().flat_map(|m| &m.content) {
        let MessageContent::Node(MessageContentNode::ToolUse {
            id, name, input, ..
        }) = block
        else {
            continue;
        };
        if !FILE_TOOLS.contains(&name.as_str()) {
            continue;
        }
        let Some(path) = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .and_then(|fp| relative_within(base, fp))
        else {
            continue;
        };
        let Some(MessageContentNode::ToolResult {
            is_error: false,
            original_file,
            modified_file,
            structured_patch,
            ..
        }) = results.get(id.as_str()).copied()
        else {
            continue;
        };
        let edit = FileEdit {
            is_write: name == "Write",
            original_file: original_file.as_deref(),
            modified_file: modified_file.as_deref(),
            patch: structured_patch.as_deref(),
        };
        let slot = *index.entry(path.clone()).or_insert_with(|| {
            order.push((path, Vec::new()));
            order.len() - 1
        });
        order[slot].1.push(edit);
    }
    order
}

/// The file's content before the session's first edit and after its last.
/// `working` is the file on disk now (`None` when it no longer exists), used as
/// the end state when the newest edit recorded none. `None` when an edit can
/// neither be read from a recorded original nor reversed from its hunks.
pub fn reconstruct(edits: &[FileEdit<'_>], working: Option<&str>) -> Option<(String, String)> {
    let newest = edits.last()?;
    let after = newest
        .modified_file
        .or(working)
        .unwrap_or_default()
        .to_string();
    let mut state = after.clone();
    for edit in edits.iter().rev() {
        state = if let Some(original) = edit.original_file {
            original.to_string()
        } else if edit.creates_file() {
            String::new()
        } else {
            reverse_apply(&state, edit.patch?)?
        };
    }
    Some((state, after))
}

/// Undoes `hunks` on `text`, the content they produced. `None` when a hunk's
/// new side does not match the text at its position.
pub fn reverse_apply(text: &str, hunks: &[DiffHunk]) -> Option<String> {
    let trailing_newline = text.ends_with('\n');
    let mut lines: Vec<&str> = text.split('\n').collect();
    if trailing_newline || text.is_empty() {
        lines.pop();
    }
    let mut ordered: Vec<&DiffHunk> = hunks.iter().collect();
    ordered.sort_by_key(|hunk| std::cmp::Reverse(hunk.new_start));
    for hunk in ordered {
        let mut old_side: Vec<&str> = Vec::new();
        let mut new_side: Vec<&str> = Vec::new();
        for line in &hunk.lines {
            match line.split_at_checked(1) {
                Some((" ", rest)) => {
                    old_side.push(rest);
                    new_side.push(rest);
                }
                Some(("-", rest)) => old_side.push(rest),
                Some(("+", rest)) => new_side.push(rest),
                // `\ No newline at end of file`, and the empty tail a split
                // diff leaves behind.
                _ => {}
            }
        }
        // A zero-length range starts *after* line `new_start`.
        let start = usize::try_from(if new_side.is_empty() {
            hunk.new_start
        } else {
            hunk.new_start - 1
        })
        .ok()?;
        let end = start.checked_add(new_side.len())?;
        if lines.get(start..end)? != new_side.as_slice() {
            return None;
        }
        lines.splice(start..end, old_side);
    }
    let mut out = lines.join("\n");
    if trailing_newline && !lines.is_empty() {
        out.push('\n');
    }
    Some(out)
}

#[cfg(test)]
#[path = "session_edits_tests.rs"]
mod tests;
