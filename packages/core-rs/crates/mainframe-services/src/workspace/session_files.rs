//! Ported from `src/workspace/session-files.ts`.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use serde::Deserialize;
use tokio::io::AsyncBufReadExt;

/// `EXDEV` (cross-device link) — same numeric value on macOS and Linux.
const EXDEV: i32 = 18;

#[derive(Debug, thiserror::Error)]
pub enum SessionFilesError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn get_claude_project_dir(project_path: &str) -> PathBuf {
    let encoded: String = project_path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".claude").join("projects").join(encoded)
}

/// Move a CLI session's files from one Claude project dir to another.
pub async fn move_session_files(
    session_id: &str,
    source_dir: &str,
    target_dir: &str,
) -> Result<(), SessionFilesError> {
    let source = Path::new(source_dir);
    let target = Path::new(target_dir);
    tokio::fs::create_dir_all(target).await?;

    // 1. Move main JSONL. Claude's own EnterWorktree tool relocates the transcript
    // when the agent enters the worktree, so it is often already gone from the
    // source dir by the time we rebind — absence is expected, not a failure.
    match move_file(
        &source.join(format!("{session_id}.jsonl")),
        &target.join(format!("{session_id}.jsonl")),
    )
    .await
    {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tracing::warn!(
                session_id,
                source_dir,
                "session transcript not in source dir — assuming it was already relocated"
            );
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            tracing::warn!(
                session_id,
                target_dir,
                "session transcript already in target dir — keeping it and leaving the source copy alone"
            );
        }
        Err(err) => return Err(err.into()),
    }

    // 2. Move session directory (subagents + tool-results)
    let session_dir = source.join(session_id);
    if tokio::fs::metadata(&session_dir).await.is_ok() {
        // No session directory — that's fine (any error here is swallowed).
        let _ = move_file(&session_dir, &target.join(session_id)).await;
    }

    // 3. Move sidechain JSONL files that reference this session
    let main_jsonl = format!("{session_id}.jsonl");
    // Directory read / move failures are swallowed — proceed without sidechains.
    let _ = async {
        let mut entries = tokio::fs::read_dir(source).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.ends_with(".jsonl") || name == main_jsonl.as_str() {
                continue;
            }
            let file_path = source.join(name.as_ref());
            if is_sidechain_of(&file_path, session_id).await {
                match move_file(&file_path, &target.join(name.as_ref())).await {
                    Ok(()) => {}
                    // One collision must not abandon the rest of the sweep.
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        tracing::warn!(
                            session_id,
                            sidechain = %name,
                            "sidechain already in target dir — keeping it and leaving the source copy alone"
                        );
                    }
                    Err(err) => return Err(err),
                }
            }
        }
        Ok::<(), std::io::Error>(())
    }
    .await;

    Ok(())
}

async fn is_sidechain_of(file_path: &Path, session_id: &str) -> bool {
    #[derive(Deserialize)]
    struct FirstLine {
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    }
    let Ok(file) = tokio::fs::File::open(file_path).await else {
        // Unreadable — skip
        return false;
    };
    let mut lines = tokio::io::BufReader::new(file).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        return match serde_json::from_str::<FirstLine>(&line) {
            Ok(first) => first.session_id.as_deref() == Some(session_id),
            Err(_) => false,
        };
    }
    false
}

/// Move a file or directory, falling back to copy+delete for cross-device moves.
/// Refuses to overwrite: `rename` clobbers silently, and when a transcript is
/// already at `dest` that copy is the live one — a leftover at `src` must not
/// replace it.
async fn move_file(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    if tokio::fs::symlink_metadata(dest).await.is_ok() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("{} already exists", dest.display()),
        ));
    }
    match tokio::fs::rename(src, dest).await {
        Ok(()) => Ok(()),
        Err(err) if err.raw_os_error() == Some(EXDEV) => {
            copy_recursive(src, dest).await?;
            tokio::fs::remove_dir_all(src).await.or_else(|e| {
                // `rm -rf` semantics: a plain file target also succeeds.
                if e.kind() == std::io::ErrorKind::NotADirectory {
                    Ok(())
                } else {
                    Err(e)
                }
            })
        }
        Err(err) => Err(err),
    }
}

fn copy_recursive<'a>(
    src: &'a Path,
    dest: &'a Path,
) -> Pin<Box<dyn Future<Output = Result<(), std::io::Error>> + Send + 'a>> {
    Box::pin(async move {
        let meta = tokio::fs::metadata(src).await?;
        if meta.is_dir() {
            tokio::fs::create_dir_all(dest).await?;
            let mut entries = tokio::fs::read_dir(src).await?;
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name();
                copy_recursive(&entry.path(), &dest.join(&name)).await?;
            }
            Ok(())
        } else {
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::copy(src, dest).await?;
            Ok(())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_project_path_into_claude_projects_directory() {
        let result = get_claude_project_dir("/Users/foo/my-project");
        let expected = dirs::home_dir()
            .unwrap()
            .join(".claude")
            .join("projects")
            .join("-Users-foo-my-project");
        assert_eq!(result, expected);
    }

    #[test]
    fn replaces_non_alphanumeric_characters_except_hyphens() {
        let result = get_claude_project_dir("/tmp/test.dir/sub");
        let expected = dirs::home_dir()
            .unwrap()
            .join(".claude")
            .join("projects")
            .join("-tmp-test-dir-sub");
        assert_eq!(result, expected);
    }

    const SESSION_ID: &str = "abc-123";

    async fn setup_source_dir() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let base = tempfile::tempdir().unwrap();
        let src_base = base.path().join("source");
        let tgt_base = base.path().join("target");

        tokio::fs::create_dir_all(&src_base).await.unwrap();
        tokio::fs::write(
            src_base.join(format!("{SESSION_ID}.jsonl")),
            "{\"sessionId\":\"abc-123\"}\n",
        )
        .await
        .unwrap();

        tokio::fs::create_dir_all(src_base.join(SESSION_ID).join("subagents"))
            .await
            .unwrap();
        tokio::fs::write(
            src_base
                .join(SESSION_ID)
                .join("subagents")
                .join("agent-a1.jsonl"),
            "subagent data",
        )
        .await
        .unwrap();
        tokio::fs::write(
            src_base
                .join(SESSION_ID)
                .join("subagents")
                .join("agent-a1.meta.json"),
            "{}",
        )
        .await
        .unwrap();
        tokio::fs::create_dir_all(src_base.join(SESSION_ID).join("tool-results"))
            .await
            .unwrap();
        tokio::fs::write(
            src_base
                .join(SESSION_ID)
                .join("tool-results")
                .join("toolu_01.txt"),
            "tool output",
        )
        .await
        .unwrap();

        tokio::fs::write(
            src_base.join("sidechain-999.jsonl"),
            format!("{{\"sessionId\":\"{SESSION_ID}\"}}\n"),
        )
        .await
        .unwrap();

        tokio::fs::write(
            src_base.join("other-session.jsonl"),
            "{\"sessionId\":\"other\"}\n",
        )
        .await
        .unwrap();

        (base, src_base, tgt_base)
    }

    #[tokio::test]
    async fn moves_jsonl_session_dir_and_sidechain_files_to_target() {
        let (_base, src_base, tgt_base) = setup_source_dir().await;

        move_session_files(
            SESSION_ID,
            src_base.to_str().unwrap(),
            tgt_base.to_str().unwrap(),
        )
        .await
        .unwrap();

        assert!(tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
        assert!(tgt_base.join(SESSION_ID).exists());
        assert!(tgt_base.join("sidechain-999.jsonl").exists());

        let content = tokio::fs::read_to_string(
            tgt_base
                .join(SESSION_ID)
                .join("subagents")
                .join("agent-a1.jsonl"),
        )
        .await
        .unwrap();
        assert_eq!(content, "subagent data");

        assert!(!src_base.join(format!("{SESSION_ID}.jsonl")).exists());
        assert!(!src_base.join(SESSION_ID).exists());
        assert!(!src_base.join("sidechain-999.jsonl").exists());

        let other = tokio::fs::read_to_string(src_base.join("other-session.jsonl"))
            .await
            .unwrap();
        assert!(other.contains("other"));
    }

    #[tokio::test]
    async fn works_when_main_jsonl_was_already_relocated() {
        let (_base, src_base, tgt_base) = setup_source_dir().await;
        // The CLI's EnterWorktree relocates the transcript itself, so by the time
        // the daemon rebinds the chat the main JSONL is gone from the source dir.
        tokio::fs::remove_file(src_base.join(format!("{SESSION_ID}.jsonl")))
            .await
            .unwrap();

        move_session_files(
            SESSION_ID,
            src_base.to_str().unwrap(),
            tgt_base.to_str().unwrap(),
        )
        .await
        .unwrap();

        assert!(!tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
        assert!(tgt_base.join(SESSION_ID).exists());
        assert!(tgt_base.join("sidechain-999.jsonl").exists());
    }

    #[tokio::test]
    async fn keeps_the_transcript_already_in_the_target_dir() {
        let (_base, src_base, tgt_base) = setup_source_dir().await;
        // A dying CLI can recreate a stub in the source dir after the real
        // transcript was relocated, so the copy in the target is the live one.
        tokio::fs::write(src_base.join(format!("{SESSION_ID}.jsonl")), "stale stub")
            .await
            .unwrap();
        tokio::fs::create_dir_all(&tgt_base).await.unwrap();
        tokio::fs::write(
            tgt_base.join(format!("{SESSION_ID}.jsonl")),
            "the relocated transcript",
        )
        .await
        .unwrap();

        move_session_files(
            SESSION_ID,
            src_base.to_str().unwrap(),
            tgt_base.to_str().unwrap(),
        )
        .await
        .unwrap();

        let kept = tokio::fs::read_to_string(tgt_base.join(format!("{SESSION_ID}.jsonl")))
            .await
            .unwrap();
        assert_eq!(kept, "the relocated transcript");
        assert!(tgt_base.join(SESSION_ID).exists());
        assert!(tgt_base.join("sidechain-999.jsonl").exists());
    }

    #[tokio::test]
    async fn keeps_a_sidechain_already_in_the_target_and_moves_the_others() {
        let (_base, src_base, tgt_base) = setup_source_dir().await;
        tokio::fs::write(
            src_base.join("sidechain-aaa.jsonl"),
            format!("{{\"sessionId\":\"{SESSION_ID}\"}}\n"),
        )
        .await
        .unwrap();
        tokio::fs::create_dir_all(&tgt_base).await.unwrap();
        tokio::fs::write(
            tgt_base.join("sidechain-999.jsonl"),
            "the relocated sidechain",
        )
        .await
        .unwrap();

        move_session_files(
            SESSION_ID,
            src_base.to_str().unwrap(),
            tgt_base.to_str().unwrap(),
        )
        .await
        .unwrap();

        let kept = tokio::fs::read_to_string(tgt_base.join("sidechain-999.jsonl"))
            .await
            .unwrap();
        assert_eq!(kept, "the relocated sidechain");
        // A collision on one sidechain must not abandon the rest of the sweep.
        assert!(tgt_base.join("sidechain-aaa.jsonl").exists());
        assert!(tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
    }

    #[tokio::test]
    async fn works_when_session_directory_does_not_exist() {
        let base = tempfile::tempdir().unwrap();
        let src_base = base.path().join("source");
        let tgt_base = base.path().join("target");
        tokio::fs::create_dir_all(&src_base).await.unwrap();
        tokio::fs::write(
            src_base.join(format!("{SESSION_ID}.jsonl")),
            "{\"sessionId\":\"abc-123\"}\n",
        )
        .await
        .unwrap();

        move_session_files(
            SESSION_ID,
            src_base.to_str().unwrap(),
            tgt_base.to_str().unwrap(),
        )
        .await
        .unwrap();

        let content = tokio::fs::read_to_string(tgt_base.join(format!("{SESSION_ID}.jsonl")))
            .await
            .unwrap();
        assert!(content.contains("abc-123"));
    }
}

// PORT STATUS: src/workspace/session-files.ts (72 lines)
// confidence: high
// todos: 0
// notes: async fs via tokio::fs; readline via tokio BufReader::lines. The regex
// /[^a-zA-Z0-9-]/g → char map. moveFile falls back to copy_recursive + remove on
// EXDEV (raw_os_error == 18, same on macOS/Linux). copy_recursive is Box::pin'd
// async recursion (Node `cp {recursive:true}`). The session-dir move and the
// sidechain readdir/move loop swallow errors exactly like the TS try/catch blocks.
// isSidechainOf reads only the first non-empty line and compares `sessionId`.
// INTENTIONAL DIVERGENCE: a missing main JSONL is warned about, not thrown — the
// TS version hard-failed the whole rebind whenever the CLI had already relocated
// the transcript itself. moveFile also refuses to overwrite an existing
// destination; the TS `rename` clobbered an already-relocated transcript with
// whatever stub was left behind in the source dir.
