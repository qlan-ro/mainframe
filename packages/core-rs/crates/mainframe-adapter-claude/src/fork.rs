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

use mainframe_adapter_api::{ForkPinError, ForkPinRequest};
use mainframe_types::adapter::ForkSource;
use mainframe_types::transcript::TranscriptLocation;
use tokio::fs;

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

async fn copy_transcript_trimmed(source: &Path, dest: &Path) -> std::io::Result<()> {
    let bytes = fs::read(source).await?;
    fs::write(dest, trim_trailing_partial_line(&bytes)).await
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
/// (trimmed of any trailing partial line) into `request.dest_dir` as
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
    copy_transcript_trimmed(Path::new(&source_path), &dest_path)
        .await
        .map_err(|e| ForkPinError::Failed(e.to_string()))?;

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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fork_source(path: &str) -> ForkSource {
        ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: Some(path.to_string()),
        }
    }

    // ---- resolve_resume ----

    #[test]
    fn own_id_with_transcript_present_resumes_plainly() {
        let source = fork_source("/snap/parent-session.jsonl");
        assert_eq!(
            resolve_resume(Some("own-id"), true, Some(&source)),
            ResumeTarget::Own("own-id".to_string())
        );
    }

    #[test]
    fn no_own_id_uses_the_fork_source() {
        let source = fork_source("/snap/parent-session.jsonl");
        assert_eq!(
            resolve_resume(None, false, Some(&source)),
            ResumeTarget::Fork("/snap/parent-session.jsonl".to_string())
        );
    }

    #[test]
    fn own_id_with_missing_transcript_falls_back_to_fork_source() {
        let source = fork_source("/snap/parent-session.jsonl");
        assert_eq!(
            resolve_resume(Some("own-id"), false, Some(&source)),
            ResumeTarget::Fork("/snap/parent-session.jsonl".to_string())
        );
    }

    #[test]
    fn no_own_id_and_no_fork_source_is_fresh() {
        assert_eq!(resolve_resume(None, false, None), ResumeTarget::Fresh);
    }

    /// Existing (pre-#343) behavior: a regular chat with a stored session id
    /// and no pending fork always resumes plainly, even when the transcript
    /// presence probe says no — that probe only gates the fork-source arms.
    /// The CLI is responsible for failing loudly if `own-id` turns out to be
    /// unresumable; Mainframe must not silently start a fresh session over
    /// the top of it.
    #[test]
    fn own_id_present_with_no_fork_source_resumes_plainly_regardless_of_transcript_presence() {
        assert_eq!(
            resolve_resume(Some("own-id"), false, None),
            ResumeTarget::Own("own-id".to_string())
        );
    }

    /// The parent's own session id must never surface as a bare `--resume`
    /// value: `ResumeTarget::Own` only ever carries `own_id`, and the only
    /// value a `ForkSource` can produce is `resume_path` (the snapshot), never
    /// `source_session_id` itself. Exhaustive over every combination of the
    /// three inputs a caller can supply.
    #[test]
    fn resolver_never_surfaces_the_parent_session_id_as_a_bare_resume_value() {
        let source = fork_source("/snap/parent-session.jsonl");
        for own_id in [None, Some("own-id"), Some("parent-session")] {
            for own_present in [false, true] {
                for source_opt in [None, Some(&source)] {
                    let target = resolve_resume(own_id, own_present, source_opt);
                    match target {
                        ResumeTarget::Own(id) => {
                            // Only reachable when an own id was actually supplied.
                            // With no fork source, an own id resumes plainly
                            // regardless of transcript presence (existing
                            // behavior); with a fork source pending, it only
                            // wins once its own transcript is confirmed present.
                            assert_eq!(Some(id.as_str()), own_id);
                            assert!(source_opt.is_none() || own_present);
                        }
                        ResumeTarget::Fork(path) => {
                            // Never the bare parent session id — always the pinned
                            // snapshot path, and always paired with --fork-session
                            // by build_args.
                            assert_ne!(path, "parent-session");
                            assert_eq!(Some(path.as_str()), source.resume_path.as_deref());
                        }
                        ResumeTarget::Fresh => {}
                    }
                }
            }
        }
    }

    // ---- pin_fork_point ----

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(contents.as_bytes()).unwrap();
    }

    #[tokio::test]
    async fn pin_copies_the_transcript_verbatim() {
        let project_dir = tempfile::tempdir().unwrap();
        let dest_dir = tempfile::tempdir().unwrap();
        let source_path = project_dir.path().join("parent-session.jsonl");
        write_file(
            &source_path,
            "{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n",
        );

        let request = ForkPinRequest {
            source_session_id: "parent-session".to_string(),
            cwd: "/unused".to_string(),
            session_file_path: Some(source_path.to_string_lossy().to_string()),
            dest_dir: dest_dir.path().to_string_lossy().to_string(),
        };
        let result = pin_fork_point(request).await.unwrap();
        assert_eq!(result.source_session_id, "parent-session");
        let dest_path = result.resume_path.unwrap();
        let copied = std::fs::read_to_string(&dest_path).unwrap();
        assert_eq!(copied, "{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n");
    }

    #[tokio::test]
    async fn pin_trims_a_trailing_partial_line() {
        let project_dir = tempfile::tempdir().unwrap();
        let dest_dir = tempfile::tempdir().unwrap();
        let source_path = project_dir.path().join("parent-session.jsonl");
        write_file(
            &source_path,
            "{\"type\":\"user\"}\n{\"type\":\"assistant\", \"partial",
        );

        let request = ForkPinRequest {
            source_session_id: "parent-session".to_string(),
            cwd: "/unused".to_string(),
            session_file_path: Some(source_path.to_string_lossy().to_string()),
            dest_dir: dest_dir.path().to_string_lossy().to_string(),
        };
        let result = pin_fork_point(request).await.unwrap();
        let copied = std::fs::read_to_string(result.resume_path.unwrap()).unwrap();
        assert_eq!(copied, "{\"type\":\"user\"}\n");
    }

    #[tokio::test]
    async fn pin_copies_the_subagents_directory_when_present() {
        let project_dir = tempfile::tempdir().unwrap();
        let dest_dir = tempfile::tempdir().unwrap();
        let source_path = project_dir.path().join("parent-session.jsonl");
        write_file(&source_path, "{\"type\":\"user\"}\n");
        let subagent_file = project_dir
            .path()
            .join("parent-session")
            .join("subagents")
            .join("agent-1.jsonl");
        write_file(&subagent_file, "{\"type\":\"assistant\"}\n");

        let request = ForkPinRequest {
            source_session_id: "parent-session".to_string(),
            cwd: "/unused".to_string(),
            session_file_path: Some(source_path.to_string_lossy().to_string()),
            dest_dir: dest_dir.path().to_string_lossy().to_string(),
        };
        pin_fork_point(request).await.unwrap();

        let copied_subagent = dest_dir
            .path()
            .join("parent-session")
            .join("subagents")
            .join("agent-1.jsonl");
        assert_eq!(
            std::fs::read_to_string(copied_subagent).unwrap(),
            "{\"type\":\"assistant\"}\n"
        );
    }

    #[tokio::test]
    async fn pin_omits_subagents_when_absent() {
        let project_dir = tempfile::tempdir().unwrap();
        let dest_dir = tempfile::tempdir().unwrap();
        let source_path = project_dir.path().join("parent-session.jsonl");
        write_file(&source_path, "{\"type\":\"user\"}\n");

        let request = ForkPinRequest {
            source_session_id: "parent-session".to_string(),
            cwd: "/unused".to_string(),
            session_file_path: Some(source_path.to_string_lossy().to_string()),
            dest_dir: dest_dir.path().to_string_lossy().to_string(),
        };
        pin_fork_point(request).await.unwrap();
        assert!(
            !dest_dir
                .path()
                .join("parent-session")
                .join("subagents")
                .exists()
        );
    }

    #[tokio::test]
    async fn pin_maps_a_missing_transcript_to_transcript_missing() {
        let dest_dir = tempfile::tempdir().unwrap();
        let request = ForkPinRequest {
            source_session_id: "no-such-session".to_string(),
            cwd: "/nonexistent/project".to_string(),
            session_file_path: Some("/nonexistent/path.jsonl".to_string()),
            dest_dir: dest_dir.path().to_string_lossy().to_string(),
        };
        assert_eq!(
            pin_fork_point(request).await.unwrap_err(),
            ForkPinError::TranscriptMissing
        );
    }
}
