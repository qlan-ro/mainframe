//! Pure `apply_patch` envelope parsing for `rollout_reconstruct`'s
//! `custom_tool_call` handling — split out to keep `rollout_reconstruct.rs`
//! under the 300-line ceiling (todo #339 task 16 widened that file to also
//! dispatch unified-exec pairs, which pushed apply_patch's own logic over the
//! limit).

use crate::item_types::{FileChange, FileChangeItem, PatchChangeKind, ThreadItem};

struct PatchFileBlock {
    path: String,
    kind: PatchChangeKind,
    diff: String,
}

/// Splits an `apply_patch` envelope on its `*** {Add|Update|Delete} File:`
/// headers; everything up to the next header (or `*** End Patch`) is that
/// file's diff/content block.
fn parse_apply_patch_envelope(input: &str) -> Vec<PatchFileBlock> {
    let mut blocks = Vec::new();
    let mut current: Option<(String, PatchChangeKind, Vec<&str>)> = None;
    for line in input.lines() {
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            flush_patch_block(&mut blocks, &mut current);
            let kind = PatchChangeKind::Update { move_path: None };
            current = Some((path.to_string(), kind, Vec::new()));
        } else if let Some(path) = line.strip_prefix("*** Add File: ") {
            flush_patch_block(&mut blocks, &mut current);
            current = Some((path.to_string(), PatchChangeKind::Add, Vec::new()));
        } else if let Some(path) = line.strip_prefix("*** Delete File: ") {
            flush_patch_block(&mut blocks, &mut current);
            current = Some((path.to_string(), PatchChangeKind::Delete, Vec::new()));
        } else if line == "*** End Patch" {
            flush_patch_block(&mut blocks, &mut current);
        } else if let Some((_, _, body)) = current.as_mut() {
            body.push(line);
        }
    }
    flush_patch_block(&mut blocks, &mut current);
    blocks
}

fn flush_patch_block(
    blocks: &mut Vec<PatchFileBlock>,
    current: &mut Option<(String, PatchChangeKind, Vec<&str>)>,
) {
    if let Some((path, kind, body)) = current.take() {
        blocks.push(PatchFileBlock {
            path,
            kind,
            diff: body.join("\n"),
        });
    }
}

/// Mirrors `rollout_reconstruct::parse_rollout_output`'s exit-code scan but
/// against apply_patch's own header shape (`Exit code: N`, not `Process
/// exited with code N`), plus the textual success marker Codex also emits.
fn custom_tool_call_succeeded(output: &str) -> bool {
    let exit_zero = output
        .lines()
        .find_map(|l| l.strip_prefix("Exit code: "))
        .and_then(|rest| rest.trim().parse::<i64>().ok())
        .map(|code| code == 0)
        .unwrap_or(false);
    exit_zero || output.contains("Success. Updated the following files:")
}

pub(crate) fn build_file_change_item(call_id: &str, input: &str, output: &str) -> ThreadItem {
    let changes = parse_apply_patch_envelope(input)
        .into_iter()
        .map(|b| FileChange {
            path: b.path,
            kind: b.kind,
            diff: b.diff,
        })
        .collect();
    let status = if custom_tool_call_succeeded(output) {
        "completed"
    } else {
        "failed"
    };
    ThreadItem::FileChange(FileChangeItem {
        id: call_id.to_string(),
        changes,
        status: status.to_string(),
    })
}
