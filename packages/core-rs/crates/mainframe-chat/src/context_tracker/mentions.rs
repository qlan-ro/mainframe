//! `@` file mentions in user-message text, recorded as session context.

use super::*;

pub fn extract_mentions_from_text(
    chat_id: &str,
    text: Option<&str>,
    db: &dyn ContextDb,
) -> Result<bool, SeamError> {
    let Some(text) = text else {
        return Ok(false);
    };
    if text.is_empty() {
        return Ok(false);
    }
    let chars: Vec<char> = text.chars().collect();
    let mut changed = false;
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '@' || (i > 0 && !chars[i - 1].is_whitespace()) {
            i += 1;
            continue;
        }
        let (path, next) = read_mention_path(&chars, i + 1);
        i = next;
        let Some(path) = path else { continue };
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        let mention = SessionMention {
            id: nanoid::nanoid!(),
            kind: MentionKind::File,
            source: MentionSource::User,
            name,
            path: Some(path),
            timestamp: now_iso8601(),
        };
        if db.add_mention(chat_id, &mention)? {
            changed = true;
        }
    }
    Ok(changed)
}

/// Reads the file path of a word-initial `@` mention whose body starts at
/// `start`; returns it (None when the token is not a file path) and the index
/// after the token. `@"…"` quotes a path containing spaces (the Claude CLI's
/// form); otherwise the token is the `\S+` run.
fn read_mention_path(chars: &[char], start: usize) -> (Option<String>, usize) {
    if chars.get(start) == Some(&'"')
        && let Some(end) = chars[start + 1..]
            .iter()
            .position(|&c| c == '"' || c == '\n')
            .map(|n| start + 1 + n)
            .filter(|&end| chars[end] == '"')
    {
        let quoted: String = chars[start + 1..end].iter().collect();
        // `@"name (agent)"` is the CLI's agent mention, not a file.
        let is_path = !quoted.trim().is_empty() && !quoted.ends_with(" (agent)");
        return (is_path.then_some(quoted), end + 1);
    }
    let end = chars[start..]
        .iter()
        .position(|c| c.is_whitespace())
        .map_or(chars.len(), |n| start + n);
    let reference: String = chars[start..end].iter().collect();
    // An unterminated `@"` is not a path.
    let is_path =
        !reference.starts_with('"') && (reference.contains('/') || reference.contains('.'));
    (is_path.then(|| clean_reference(&reference)), end)
}

/// `ref.replace(/<\/[^>]+>$/, '').replace(/[,;:!?)]+$/, '')`.
fn clean_reference(reference: &str) -> String {
    let without_tag = strip_trailing_close_tag(reference).unwrap_or_else(|| reference.to_string());
    without_tag
        .trim_end_matches([',', ';', ':', '!', '?', ')'])
        .to_string()
}

/// Strip a trailing `</[^>]+>` closing tag.
fn strip_trailing_close_tag(s: &str) -> Option<String> {
    if !s.ends_with('>') {
        return None;
    }
    let start = s.rfind("</")?;
    let inner = &s[start + 2..s.len() - 1];
    if inner.is_empty() || inner.contains('>') {
        return None;
    }
    Some(s[..start].to_string())
}

#[cfg(test)]
#[path = "mentions_tests.rs"]
mod tests;
