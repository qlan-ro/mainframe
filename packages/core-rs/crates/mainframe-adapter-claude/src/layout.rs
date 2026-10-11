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
    let encoded = mainframe_types::paths::encode_claude_project_path(project_path);
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
mod tests;
