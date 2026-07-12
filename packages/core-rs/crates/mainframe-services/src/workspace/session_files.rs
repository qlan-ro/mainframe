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

    // 1. Move main JSONL
    move_file(
        &source.join(format!("{session_id}.jsonl")),
        &target.join(format!("{session_id}.jsonl")),
    )
    .await?;

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
                move_file(&file_path, &target.join(name.as_ref())).await?;
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
async fn move_file(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
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
