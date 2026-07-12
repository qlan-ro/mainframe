//! Ported from `packages/core/src/plugins/builtin/claude/external-session-enrich.ts`.
//!
//! Reads the head/tail of an external session JSONL, applies hide rules
//! (sidechain / team / wrong-cwd), and projects it to an `ExternalSession`.

use std::io::SeekFrom;

use chrono::{DateTime, Utc};
use mainframe_runtime::time::{now_iso8601, to_iso8601};
use mainframe_types::adapter::ExternalSession;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::external_session_paths::cwd_belongs_to_project;

pub const SYNTHETIC_TITLE: &str = "(session)";
const READ_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone)]
pub struct Candidate {
    pub session_id: String,
    pub file_path: String,
    pub mtime_ms: f64,
    pub size: u64,
}

/// Read up to `READ_BYTES` from the start and end of the file (deduped if small).
async fn read_head_tail(file_path: &str) -> std::io::Result<(String, String)> {
    let size = tokio::fs::metadata(file_path).await?.len();
    let mut handle = tokio::fs::File::open(file_path).await?;

    let head_len = std::cmp::min(READ_BYTES, size) as usize;
    let mut head_buf = vec![0u8; head_len];
    handle.read_exact(&mut head_buf).await?;
    let head = String::from_utf8_lossy(&head_buf).to_string();

    if size <= READ_BYTES {
        return Ok((head.clone(), head));
    }

    let tail_len = std::cmp::min(READ_BYTES, size) as usize;
    handle.seek(SeekFrom::Start(size - tail_len as u64)).await?;
    let mut tail_buf = vec![0u8; tail_len];
    handle.read_exact(&mut tail_buf).await?;
    Ok((head, String::from_utf8_lossy(&tail_buf).to_string()))
}

fn parse_lines(chunk: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for line in chunk.split('\n') {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(t) {
            out.push(v); // truncated/partial line at a 64KB boundary is tolerated
        }
    }
    out
}

/// `"<key>"\s*:` — optionally requiring `\s*true` after the colon.
fn head_has_flag(head: &str, key: &str, require_true: bool) -> bool {
    let needle = format!("\"{key}\"");
    let mut from = 0;
    while let Some(rel) = head[from..].find(&needle) {
        let i = from + rel;
        let after = &head[i + needle.len()..];
        let a = after.trim_start_matches(char::is_whitespace);
        if let Some(b) = a.strip_prefix(':') {
            if !require_true {
                return true;
            }
            if b.trim_start_matches(char::is_whitespace)
                .starts_with("true")
            {
                return true;
            }
        }
        from = i + needle.len();
    }
    false
}

fn raw_text(content: Option<&Value>, limit: usize) -> Option<String> {
    match content {
        Some(Value::Array(arr)) => {
            for block in arr {
                if block.get("type").and_then(Value::as_str) == Some("text")
                    && let Some(text) = block.get("text").and_then(Value::as_str)
                    && !text.is_empty()
                {
                    return Some(text.chars().take(limit).collect());
                }
            }
            None
        }
        Some(Value::String(s)) => Some(s.chars().take(limit).collect()),
        _ => None,
    }
}

fn clean_prompt(text: &str) -> String {
    let s = remove_tag_pairs(text);
    let s = remove_tags(&s);
    collapse_ws(&s).trim().to_string()
}

/// `<[^>]+>[^<]*</[^>]+>` global removal.
fn remove_tag_pairs(s: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < s.len() {
        if s[i..].starts_with('<')
            && let Some(end) = match_tag_pair(s, i)
        {
            i = end;
            continue;
        }
        let ch = s[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn match_tag_pair(s: &str, i: usize) -> Option<usize> {
    let after = &s[i + 1..];
    let gt1 = after.find('>')?;
    if gt1 == 0 {
        return None; // [^>]+ needs ≥1
    }
    let pos = i + 1 + gt1 + 1;
    let rest = &s[pos..];
    let lt = rest.find('<')?;
    if !rest[lt..].starts_with("</") {
        return None;
    }
    let after_close = pos + lt + 2;
    let gt2 = s[after_close..].find('>')?;
    if gt2 == 0 {
        return None;
    }
    Some(after_close + gt2 + 1)
}

/// `<[^>]+>` global removal.
fn remove_tags(s: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < s.len() {
        if s[i..].starts_with('<')
            && let Some(gt) = s[i + 1..].find('>')
            && gt >= 1
        {
            i = i + 1 + gt + 1;
            continue;
        }
        let ch = s[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// `\s+` → ' '.
fn collapse_ws(s: &str) -> String {
    let mut out = String::new();
    let mut prev_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    out
}

fn pick_string(entries: &[Value], key: &str) -> Option<String> {
    for e in entries {
        if let Some(v) = e.get(key).and_then(Value::as_str) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn fallback_from_ms(ms: f64) -> String {
    DateTime::from_timestamp_millis(ms as i64)
        .map(to_iso8601)
        .unwrap_or_else(now_iso8601)
}

/// Read the file's head/tail, apply hide rules, and project to an
/// `ExternalSession` (or `None` to drop).
pub async fn enrich_session(candidate: &Candidate, project_path: &str) -> Option<ExternalSession> {
    let (head, tail) = match read_head_tail(&candidate.file_path).await {
        Ok(ht) => ht,
        Err(err) => {
            tracing::warn!(
                module = "claude:external-session-enrich",
                err = %err,
                file_path = %candidate.file_path,
                "failed to read external session file"
            );
            return None;
        }
    };

    // Robust to truncated giant first lines: substring-scan for the hide flags.
    if head_has_flag(&head, "isSidechain", true) || head_has_flag(&head, "teamName", false) {
        return None;
    }

    let head_entries = parse_lines(&head);
    let tail_entries = parse_lines(&tail);
    let mut all = head_entries.clone();
    all.extend(tail_entries);

    let cwd = pick_string(&all, "cwd");
    if !cwd_belongs_to_project(cwd.as_deref(), project_path) {
        return None;
    }

    let git_branch = pick_string(&all, "gitBranch");
    let created_at = pick_string(&all, "timestamp");

    let first_user = head_entries.iter().find(|e| {
        e.get("type").and_then(Value::as_str) == Some("user")
            && e.get("message").and_then(|m| m.get("content")).is_some()
    });
    let first_prompt_raw =
        first_user.and_then(|e| raw_text(e.get("message").and_then(|m| m.get("content")), 2000));
    let first_prompt =
        first_prompt_raw.map(|r| clean_prompt(&r).chars().take(500).collect::<String>());

    // Title precedence: customTitle > aiTitle > summary > firstPrompt > synthetic.
    let title = pick_string(&all, "customTitle")
        .or_else(|| pick_string(&all, "aiTitle"))
        .or_else(|| pick_string(&all, "summary"))
        .or_else(|| first_prompt.clone())
        .unwrap_or_else(|| SYNTHETIC_TITLE.to_string());

    let modified_at = match tokio::fs::metadata(&candidate.file_path).await {
        Ok(m) => match m.modified() {
            Ok(t) => to_iso8601(DateTime::<Utc>::from(t)),
            Err(_) => fallback_from_ms(candidate.mtime_ms),
        },
        Err(_) => fallback_from_ms(candidate.mtime_ms),
    };

    Some(ExternalSession {
        session_id: candidate.session_id.clone(),
        adapter_id: "claude".to_string(),
        project_path: project_path.to_string(),
        cwd,
        first_prompt,
        title: Some(title),
        summary: None,
        message_count: None,
        created_at: created_at.unwrap_or_else(|| modified_at.clone()),
        modified_at,
        git_branch,
        model: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn write_temp(content: &str) -> (tempfile::TempDir, Candidate) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("abc.jsonl");
        tokio::fs::write(&file, content).await.unwrap();
        let cand = Candidate {
            session_id: "abc".to_string(),
            file_path: file.to_string_lossy().to_string(),
            mtime_ms: 1000.0,
            size: 0,
        };
        (dir, cand)
    }

    #[tokio::test]
    async fn uses_custom_title_over_ai_over_first_prompt() {
        let (_d, cand) = write_temp(
            &serde_json::json!({
                "type": "user",
                "cwd": "/p",
                "timestamp": "2026-01-01T00:00:00Z",
                "customTitle": "My Title",
                "aiTitle": "AI Title",
                "message": { "content": "Fix login" }
            })
            .to_string(),
        )
        .await;
        let s = enrich_session(&cand, "/p").await.unwrap();
        assert_eq!(s.title.as_deref(), Some("My Title"));
    }

    #[tokio::test]
    async fn falls_back_to_ai_title_then_first_prompt() {
        let (_d1, c1) = write_temp(
            &serde_json::json!({
                "type": "user", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z",
                "aiTitle": "AI Title", "message": { "content": "Fix login" }
            })
            .to_string(),
        )
        .await;
        assert_eq!(
            enrich_session(&c1, "/p").await.unwrap().title.as_deref(),
            Some("AI Title")
        );

        let (_d2, c2) = write_temp(
            &serde_json::json!({
                "type": "user", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z",
                "message": { "content": "Fix login" }
            })
            .to_string(),
        )
        .await;
        let s = enrich_session(&c2, "/p").await.unwrap();
        assert_eq!(s.title.as_deref(), Some("Fix login"));
        assert_eq!(s.first_prompt.as_deref(), Some("Fix login"));
    }

    #[tokio::test]
    async fn drops_sidechain_sessions() {
        let (_d, c) = write_temp(
            &serde_json::json!({ "type": "user", "isSidechain": true, "cwd": "/p", "message": { "content": "x" } })
                .to_string(),
        )
        .await;
        assert!(enrich_session(&c, "/p").await.is_none());
    }

    #[tokio::test]
    async fn drops_team_sessions() {
        let (_d, c) = write_temp(
            &serde_json::json!({ "type": "user", "teamName": "acme", "cwd": "/p", "message": { "content": "x" } })
                .to_string(),
        )
        .await;
        assert!(enrich_session(&c, "/p").await.is_none());
    }

    #[tokio::test]
    async fn drops_wrong_cwd_sessions() {
        let (_d, c) = write_temp(
            &serde_json::json!({ "type": "user", "cwd": "/p-web", "timestamp": "2026-01-01T00:00:00Z", "message": { "content": "x" } })
                .to_string(),
        )
        .await;
        assert!(enrich_session(&c, "/p").await.is_none());
    }

    #[tokio::test]
    async fn keeps_empty_session_with_synthetic_title() {
        let (_d, c) = write_temp(
            &serde_json::json!({ "type": "system", "cwd": "/p", "timestamp": "2026-01-01T00:00:00Z" }).to_string(),
        )
        .await;
        let s = enrich_session(&c, "/p").await.unwrap();
        assert_eq!(s.title.as_deref(), Some(SYNTHETIC_TITLE));
    }
}

// PORT STATUS: src/plugins/builtin/claude/external-session-enrich.ts (140 lines)
// confidence: high
// todos: 0
// notes: readHeadTail uses positional read_exact (head from 0, tail via seek);
// Buffer.toString('utf-8') → from_utf8_lossy (64KB boundary may split a
// codepoint). The hide-flag regexes and cleanPrompt's three regexes are
// hand-rolled. `.slice(0,N)` → chars().take(N) (UTF-16-unit vs char divergence on
// astral chars — untested edge). summary is intentionally NOT populated (the TS
// return omits it though it feeds title precedence). mtime → chrono
// DateTime::<Utc>::from(SystemTime); the mtimeMs fallback uses
// from_timestamp_millis. All 6 TS tests ported using real temp files (the TS
// mocked fs open/stat — tokio::fs isn't mockable, so real files exercise the
// same path and assert the same title/firstPrompt outputs).
