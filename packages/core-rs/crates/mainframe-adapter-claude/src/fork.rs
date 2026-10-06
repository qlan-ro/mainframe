//! Fork pinning and resume-target resolution for the Claude adapter (todo #343
//! Group 2 — see `docs/plans/2026-09-24-todo-343-fork-thread.md` "Fork-point
//! mechanism").
//!
//! `pin_fork_point` snapshots the parent's transcript into a Mainframe-owned
//! directory at the moment of the fork action, so the fork's first spawn has a
//! stable, never-drifting resume target regardless of what the parent does
//! afterward or whether the daemon restarts in between. `resolve_resume` is the
//! pure decision of what a spawn should actually pass to `--resume`: it must
//! never let the parent's own session id become a resume target without
//! `--fork-session`, because that would continue the parent instead of
//! branching it.

use std::path::Path;

use mainframe_adapter_api::{ForkCut, ForkPinError, ForkPinRequest};
use mainframe_types::adapter::ForkSource;
use mainframe_types::transcript::TranscriptLocation;
use tokio::fs;

use crate::fork_cut::prefix_len_before_message;
use crate::transcript::locate_claude_transcript;

/// What a spawn should resume from. `Fork` is the only variant that ever
/// carries `--fork-session`; `Own` is a plain `--resume`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResumeTarget {
    /// Resume this session's own transcript plainly.
    Own(String),
    /// Resume the pinned fork snapshot at this path, with `--fork-session`.
    Fork(String),
    /// No resume target; start fresh.
    Fresh,
}

/// Decide the resume target without ever using the parent's session id as a
/// bare `--resume` value.
///
/// When there is no pending fork source, this is existing (pre-#343)
/// behavior: an own session id always resumes plainly, regardless of
/// transcript presence on disk — the CLI itself is responsible for failing
/// loudly if that id turns out to be unresumable. The `own_transcript_present`
/// probe only matters when a fork source is also pinned, to decide whether a
/// fork's own first-turn transcript has appeared yet (covers a first turn
/// that crashed after `on_init` but before the CLI wrote the transcript — the
/// fork source is still pinned then, so resolution falls back to it).
pub fn resolve_resume(
    own_id: Option<&str>,
    own_transcript_present: bool,
    fork_source: Option<&ForkSource>,
) -> ResumeTarget {
    match (own_id, fork_source) {
        (Some(id), None) => ResumeTarget::Own(id.to_string()),
        (Some(id), Some(_)) if own_transcript_present => ResumeTarget::Own(id.to_string()),
        (_, Some(source)) => match source.resume_path.as_deref() {
            Some(path) => ResumeTarget::Fork(path.to_string()),
            None => ResumeTarget::Fresh,
        },
        (None, None) => ResumeTarget::Fresh,
    }
}

/// Drop a trailing line with no terminating `\n` — an idle live parent CLI may
/// still be mid-write on its last line when the fork snapshot is taken. A file
/// that already ends in `\n` (or is empty) is returned unchanged.
fn trim_trailing_partial_line(bytes: &[u8]) -> Vec<u8> {
    if bytes.is_empty() || bytes.ends_with(b"\n") {
        return bytes.to_vec();
    }
    match bytes.iter().rposition(|&b| b == b'\n') {
        Some(idx) => bytes[..=idx].to_vec(),
        None => Vec::new(),
    }
}

/// Copy the parent transcript into the snapshot: the whole settled file for a
/// whole-chat fork, or only the line prefix before the cut message for a
/// from-message fork. The transcript is append-only, so that prefix is exactly
/// the file the parent had when the message was sent.
async fn copy_transcript(
    source: &Path,
    dest: &Path,
    cut: Option<&ForkCut>,
) -> Result<(), ForkPinError> {
    let bytes = fs::read(source)
        .await
        .map_err(|e| ForkPinError::Failed(e.to_string()))?;
    let settled = trim_trailing_partial_line(&bytes);
    let snapshot = match cut {
        None => &settled[..],
        Some(cut) => &settled[..prefix_len_before_message(&settled, &cut.vendor_message_id)?],
    };
    fs::write(dest, snapshot)
        .await
        .map_err(|e| ForkPinError::Failed(e.to_string()))
}

/// Copy `source_dir`'s files (non-recursive: subagent JSONLs are a flat
/// directory) into `dest_dir`, if `source_dir` exists. A missing source is not
/// an error — most sessions have no subagents.
async fn copy_subagents_dir(source_dir: &Path, dest_dir: &Path) -> std::io::Result<()> {
    if fs::metadata(source_dir).await.is_err() {
        return Ok(());
    }
    fs::create_dir_all(dest_dir).await?;
    let mut entries = fs::read_dir(source_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_file() {
            fs::copy(entry.path(), dest_dir.join(entry.file_name())).await?;
        }
    }
    Ok(())
}

/// Pin a fork's starting point: locate the parent's transcript, copy it
/// (trimmed of any trailing partial line, and cut before `request.cut`'s
/// message when set) into `request.dest_dir` as
/// `<source_session_id>.jsonl`, and copy its subagents directory alongside it
/// when present. Returns the `ForkSource` the fork's first spawn resumes from.
pub async fn pin_fork_point(request: ForkPinRequest) -> Result<ForkSource, ForkPinError> {
    let location = locate_claude_transcript(
        &request.source_session_id,
        &request.cwd,
        request.session_file_path.as_deref(),
    )
    .await;
    let Some(TranscriptLocation::Present(source_path)) = location else {
        return Err(ForkPinError::TranscriptMissing);
    };

    fs::create_dir_all(&request.dest_dir)
        .await
        .map_err(|e| ForkPinError::Failed(e.to_string()))?;

    let dest_path =
        Path::new(&request.dest_dir).join(format!("{}.jsonl", request.source_session_id));
    copy_transcript(Path::new(&source_path), &dest_path, request.cut.as_ref()).await?;

    if let Some(project_dir) = Path::new(&source_path).parent() {
        let subagents_src = project_dir
            .join(&request.source_session_id)
            .join("subagents");
        let subagents_dest = Path::new(&request.dest_dir)
            .join(&request.source_session_id)
            .join("subagents");
        copy_subagents_dir(&subagents_src, &subagents_dest)
            .await
            .map_err(|e| ForkPinError::Failed(e.to_string()))?;
    }

    Ok(ForkSource {
        source_session_id: request.source_session_id,
        resume_path: Some(dest_path.to_string_lossy().to_string()),
        last_turn_id: None,
    })
}

#[cfg(test)]
#[path = "fork_tests.rs"]
mod tests;
