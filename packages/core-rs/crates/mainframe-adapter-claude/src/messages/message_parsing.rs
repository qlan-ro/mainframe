//! Ported from `packages/core/src/messages/message-parsing.ts`.
//!
//! Claude-specific slash-command / attached-file / mainframe-command tag
//! parsing. The TS source leans on regexes; the `regex` crate is not on the
//! port allowlist (see task-progress.rs), so each pattern is matched by hand
//! below with the same semantics.

use mainframe_types::skill::Skill;

// ── hand-rolled tag helpers ─────────────────────────────────────────────────

/// `<open>[^<]*<close>` — remove every non-overlapping occurrence (regex `g`).
fn replace_tag_all(text: &str, open: &str, close: &str) -> String {
    let bytes = text;
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(open) {
            let after = i + open.len();
            let rest = &bytes[after..];
            if let Some(lt) = rest.find('<')
                && rest[lt..].starts_with(close)
            {
                i = after + lt + close.len();
                continue;
            }
        }
        let ch = bytes[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// `<open>([^<]*)<close>` — capture the (slash-stripped) inner text of the first match.
fn capture_tag(text: &str, open: &str, close: &str, strip_leading_slash: bool) -> Option<String> {
    let oi = text.find(open)?;
    let after = oi + open.len();
    let mut rest = &text[after..];
    if strip_leading_slash && rest.starts_with('/') {
        rest = &rest[1..];
    }
    let lt = rest.find('<')?;
    if !rest[lt..].starts_with(close) {
        return None;
    }
    Some(rest[..lt].to_string())
}

pub struct ParsedCommand {
    pub command_name: String,
    pub user_text: String,
}

pub fn parse_command_message(text: &str) -> Option<ParsedCommand> {
    // COMMAND_NAME_RE = /<command-name>\/?([^<]*)<\/command-name>/
    let command_name = capture_tag(text, "<command-name>", "</command-name>", true)?;

    // /<command-args>([^<]*)<\/command-args>/
    let command_args = capture_tag(text, "<command-args>", "</command-args>", false)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let user_text = {
        let s = replace_tag_all(text, "<command-message>", "</command-message>");
        let s = replace_tag_all(&s, "<command-name>", "</command-name>");
        let s = replace_tag_all(&s, "<command-args>", "</command-args>");
        let s = replace_tag_all(&s, "<local-command-caveat>", "</local-command-caveat>");
        let s = replace_tag_all(&s, "<local-command-stdout>", "</local-command-stdout>");
        s.trim().to_string()
    };

    Some(ParsedCommand {
        command_name,
        user_text: if command_args.is_empty() {
            user_text
        } else {
            command_args
        },
    })
}

fn invocation_ends_with_colon(inv: &Option<String>, name: &str) -> bool {
    match inv {
        Some(i) => i.ends_with(&format!(":{name}")),
        None => false,
    }
}

pub fn resolve_skill_name(name: &str, skills: &[Skill]) -> String {
    if let Some(exact) = skills
        .iter()
        .find(|s| s.invocation_name.as_deref() == Some(name) || s.name == name)
    {
        // `exact.invocationName || exact.name` — empty string is falsy in JS.
        return match &exact.invocation_name {
            Some(inv) if !inv.is_empty() => inv.clone(),
            _ => exact.name.clone(),
        };
    }
    if let Some(suffix) = skills
        .iter()
        .find(|s| invocation_ends_with_colon(&s.invocation_name, name))
    {
        // `suffix.invocationName!` — the predicate guarantees Some.
        if let Some(inv) = &suffix.invocation_name {
            return inv.clone();
        }
    }
    name.to_string()
}

pub struct RawCommand {
    pub command_name: String,
    pub user_text: String,
    pub is_command: Option<bool>,
}

/// The TS param is `Array<{ name: string }>`; only `.name` is read, so the port
/// takes the command names directly.
pub fn parse_raw_command(
    text: &str,
    skills: &[Skill],
    commands: Option<&[String]>,
) -> Option<RawCommand> {
    if !text.starts_with('/') {
        return None;
    }
    // /^\/(\S+)/ — the non-whitespace run after the leading slash.
    let raw_name: String = text[1..]
        .chars()
        .take_while(|c| !c.is_whitespace())
        .collect();
    if raw_name.is_empty() {
        return None;
    }
    let match0_len = 1 + raw_name.len();

    if let Some(cmds) = commands
        && cmds.iter().any(|c| c == &raw_name)
    {
        let user_text = text[match0_len..].trim().to_string();
        return Some(RawCommand {
            command_name: raw_name,
            user_text,
            is_command: Some(true),
        });
    }

    let is_known = skills.iter().any(|s| {
        s.invocation_name.as_deref() == Some(raw_name.as_str())
            || s.name == raw_name
            || invocation_ends_with_colon(&s.invocation_name, &raw_name)
    });
    if !is_known {
        return None;
    }
    let resolved = resolve_skill_name(&raw_name, skills);
    let user_text = text[match0_len..].trim().to_string();
    Some(RawCommand {
        command_name: resolved,
        user_text,
        is_command: None,
    })
}

pub fn decode_xml_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

pub struct AttachedFile {
    pub name: String,
}

pub struct AttachedFilePaths {
    pub files: Vec<AttachedFile>,
    pub clean_text: String,
}

/// Extract `name="…"` from the first `name="([^"]+)"` in an attribute string.
fn extract_attr_name(attrs: &str) -> Option<String> {
    let start = attrs.find("name=\"")? + "name=\"".len();
    let rest = &attrs[start..];
    let end = rest.find('"')?;
    if end == 0 {
        return None; // `[^"]+` requires ≥1 char
    }
    Some(rest[..end].to_string())
}

pub fn parse_attached_file_path_tags(text: &str) -> AttachedFilePaths {
    // ATTACHED_FILE_PATH_RE = /<attached_file_path\s+([^>]+?)\/?>/g
    let mut files: Vec<AttachedFile> = Vec::new();
    let mut out = String::new();
    let mut i = 0;
    const OPEN: &str = "<attached_file_path";
    while i < text.len() {
        if text[i..].starts_with(OPEN) {
            let after = i + OPEN.len();
            let rest = &text[after..];
            // require \s+
            let ws_len = rest.chars().take_while(|c| c.is_whitespace()).count();
            let ws_bytes: usize = rest.chars().take(ws_len).map(|c| c.len_utf8()).sum();
            if ws_len >= 1
                && let Some(gt) = rest[ws_bytes..].find('>')
                && gt >= 1
            {
                let mut attrs = &rest[ws_bytes..ws_bytes + gt];
                // `\/?>` — an optional trailing slash is not part of the capture.
                if attrs.ends_with('/') {
                    attrs = &attrs[..attrs.len() - 1];
                }
                if let Some(name) = extract_attr_name(attrs) {
                    files.push(AttachedFile {
                        name: decode_xml_attr(&name),
                    });
                }
                i = after + ws_bytes + gt + 1; // consume through '>'
                continue;
            }
        }
        let ch = text[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }

    let clean_text = strip_image_coordinate_note(&out).trim().to_string();
    AttachedFilePaths { files, clean_text }
}

/// IMAGE_COORDINATE_NOTE_RE — a fixed-template note the CLI injects. Marked for
/// removal in the TS source ("should not be used"); replicated for fidelity.
/// Pattern: `\[Image:\s*original\s+\d+x\d+,\s*displayed at\s+\d+x\d+\.\s*Multiply
/// coordinates by\s+[0-9.]+\s+to map to original image\.\]`
fn strip_image_coordinate_note(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if let Some(end) = match_image_note(&chars, i) {
            i = end;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn match_image_note(c: &[char], start: usize) -> Option<usize> {
    let mut i = start;
    let lit = |c: &[char], i: usize, s: &str| -> Option<usize> {
        let sc: Vec<char> = s.chars().collect();
        if i + sc.len() <= c.len() && c[i..i + sc.len()] == sc[..] {
            Some(i + sc.len())
        } else {
            None
        }
    };
    let ws_star = |c: &[char], mut i: usize| -> usize {
        while i < c.len() && c[i].is_whitespace() {
            i += 1;
        }
        i
    };
    let ws_plus = |c: &[char], i: usize| -> Option<usize> {
        if i < c.len() && c[i].is_whitespace() {
            Some(ws_star(c, i))
        } else {
            None
        }
    };
    let digits = |c: &[char], i: usize| -> Option<usize> {
        let mut j = i;
        while j < c.len() && c[j].is_ascii_digit() {
            j += 1;
        }
        if j > i { Some(j) } else { None }
    };
    let num = |c: &[char], i: usize| -> Option<usize> {
        // [0-9.]+
        let mut j = i;
        while j < c.len() && (c[j].is_ascii_digit() || c[j] == '.') {
            j += 1;
        }
        if j > i { Some(j) } else { None }
    };

    i = lit(c, i, "[Image:")?;
    i = ws_star(c, i);
    i = lit(c, i, "original")?;
    i = ws_plus(c, i)?;
    i = digits(c, i)?;
    i = lit(c, i, "x")?;
    i = digits(c, i)?;
    i = lit(c, i, ",")?;
    i = ws_star(c, i);
    i = lit(c, i, "displayed at")?;
    i = ws_plus(c, i)?;
    i = digits(c, i)?;
    i = lit(c, i, "x")?;
    i = digits(c, i)?;
    i = lit(c, i, ".")?;
    i = ws_star(c, i);
    i = lit(c, i, "Multiply coordinates by")?;
    i = ws_plus(c, i)?;
    i = num(c, i)?;
    i = ws_plus(c, i)?;
    i = lit(c, i, "to map to original image")?;
    i = lit(c, i, ".")?;
    i = lit(c, i, "]")?;
    Some(i)
}

pub fn format_turn_duration(duration_ms: f64) -> String {
    if !duration_ms.is_finite() || duration_ms < 0.0 {
        return String::new();
    }
    if duration_ms < 1000.0 {
        return format!("{}ms", js_round(duration_ms));
    }
    let seconds = duration_ms / 1000.0;
    if seconds < 10.0 {
        return format!("{seconds:.1}s");
    }
    format!("{}s", js_round(seconds))
}

/// `Math.round(x)` for non-negative x (`floor(x + 0.5)`).
fn js_round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

pub fn strip_mainframe_command_tags(text: &str) -> String {
    // MAINFRAME_CMD_RESPONSE_RE = /<mainframe-command-response[^>]*>([\s\S]*?)<\/mainframe-command-response>/
    if let Some(captured) = capture_mainframe_response(text) {
        return captured.trim().to_string();
    }
    // MAINFRAME_CMD_WRAPPER_RE = /<mainframe-command[^>]*>[\s\S]*?<\/mainframe-command>/ (first only)
    remove_mainframe_wrapper(text).trim().to_string()
}

fn capture_mainframe_response(text: &str) -> Option<String> {
    const TAG: &str = "<mainframe-command-response";
    const CLOSE: &str = "</mainframe-command-response>";
    let tag_start = text.find(TAG)?;
    let after_tag = tag_start + TAG.len();
    // [^>]*> — the rest of the open tag.
    let gt = text[after_tag..].find('>')?;
    // ensure no '>' skipped implicitly by [^>]* — find already returns first '>'.
    let content_start = after_tag + gt + 1;
    let close_rel = text[content_start..].find(CLOSE)?; // non-greedy = first
    Some(text[content_start..content_start + close_rel].to_string())
}

fn remove_mainframe_wrapper(text: &str) -> String {
    const TAG: &str = "<mainframe-command";
    const CLOSE: &str = "</mainframe-command>";
    let Some(tag_start) = text.find(TAG) else {
        return text.to_string();
    };
    let after_tag = tag_start + TAG.len();
    let Some(gt) = text[after_tag..].find('>') else {
        return text.to_string();
    };
    let content_start = after_tag + gt + 1;
    let Some(close_rel) = text[content_start..].find(CLOSE) else {
        return text.to_string();
    };
    let close_end = content_start + close_rel + CLOSE.len();
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..tag_start]);
    out.push_str(&text[close_end..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_response_wrapper_tags() {
        let input =
            "<mainframe-command-response id=\"cmd_abc\">Hello world</mainframe-command-response>";
        assert_eq!(strip_mainframe_command_tags(input), "Hello world");
    }

    #[test]
    fn returns_text_unchanged_when_no_tags_present() {
        assert_eq!(strip_mainframe_command_tags("Normal text"), "Normal text");
    }

    #[test]
    fn strips_command_wrapper_from_user_messages() {
        let input =
            "<mainframe-command name=\"init\" id=\"cmd_abc\">Do init work</mainframe-command>";
        assert_eq!(strip_mainframe_command_tags(input), "");
    }

    #[test]
    fn parse_command_message_uses_args_over_body() {
        let input = "<command-name>/deploy</command-name><command-args>prod</command-args>rest";
        let parsed = parse_command_message(input).unwrap();
        assert_eq!(parsed.command_name, "deploy");
        assert_eq!(parsed.user_text, "prod");
    }

    #[test]
    fn format_turn_duration_buckets() {
        assert_eq!(format_turn_duration(f64::NAN), "");
        assert_eq!(format_turn_duration(-5.0), "");
        assert_eq!(format_turn_duration(250.4), "250ms");
        assert_eq!(format_turn_duration(2500.0), "2.5s");
        assert_eq!(format_turn_duration(42_000.0), "42s");
    }

    #[test]
    fn decode_xml_attr_unescapes() {
        assert_eq!(
            decode_xml_attr("a &amp; &lt;b&gt; &quot;c&quot;"),
            "a & <b> \"c\""
        );
    }

    #[test]
    fn attached_file_path_extracts_names_and_strips_tags() {
        let text = "before <attached_file_path name=\"a &amp; b.txt\" /> after";
        let out = parse_attached_file_path_tags(text);
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].name, "a & b.txt");
        assert_eq!(out.clean_text, "before  after");
    }

    #[test]
    fn strips_image_coordinate_note() {
        let text = "keep [Image: original 100x200, displayed at 50x100. Multiply coordinates by 2.0 to map to original image.] tail";
        let out = parse_attached_file_path_tags(text);
        assert_eq!(out.clean_text, "keep  tail");
    }
}

// PORT STATUS: src/messages/message-parsing.ts (99 lines)
// confidence: medium
// todos: 0
// notes: `regex` is not on the allowlist, so every RE is hand-rolled with the
// same semantics: COMMAND_NAME_RE / command tag replaces (`<t>[^<]*</t>`),
// ATTACHED_FILE_PATH_RE (`<attached_file_path\s+([^>]+?)\/?>`), the
// IMAGE_COORDINATE_NOTE_RE fixed template, and the mainframe-command response/
// wrapper patterns. parseRawCommand's `Array<{name}>` param is taken as the
// command names (`&[String]`); only `.name` was read. Math.round → floor(x+0.5)
// (positive-only path); `.toFixed(1)` → `{:.1}` (round-half-to-even may differ
// from JS on exact .05 boundaries in 1.0..10.0 — untested edge). Only
// stripMainframeCommandTags is covered by a ported TS test; the rest carry
// sanity tests. IMAGE note matcher confidence medium — no TS test exercises it.
