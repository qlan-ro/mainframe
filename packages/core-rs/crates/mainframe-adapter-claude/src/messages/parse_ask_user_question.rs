//! Ported from `packages/core/src/messages/parse-ask-user-question.ts`.
//!
//! Parses the Claude CLI's AskUserQuestion result text back into structured
//! answers. The CLI wording varies across versions, so every known prefix/suffix
//! variant is matched. `regex` is not on the port allowlist, so the PAIR /
//! preview / notes patterns are matched by hand with identical semantics.

use mainframe_types::display::AskUserQuestionAnswer;

// The CLI's AskUserQuestion result wording varies across versions — match every
// known prefix/suffix variant so answers keep parsing.
const PREFIXES: [&str; 2] = [
    "User has answered your questions: ",
    "Your questions have been answered: ",
];
const SUFFIXES: [&str; 2] = [
    ". You can now continue with the user's answers in mind.",
    ". You can now continue with these answers in mind.",
];

#[derive(Debug, Clone)]
pub struct KnownQuestionOption {
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct KnownQuestion {
    pub question: String,
    pub multi_select: Option<bool>,
    pub options: Option<Vec<KnownQuestionOption>>,
}

fn strip_body(content: &str) -> Option<String> {
    let prefix = PREFIXES.iter().find(|p| content.starts_with(**p))?;
    let mut body = &content[prefix.len()..];
    if let Some(suffix) = SUFFIXES.iter().find(|s| body.ends_with(**s)) {
        body = &body[..body.len() - suffix.len()];
    }
    Some(body.to_string())
}

fn split_answer(raw: &str, multi_select: Option<bool>) -> Vec<String> {
    if multi_select != Some(true) {
        // Free-text / single-select answers are kept verbatim.
        let trimmed = raw.trim();
        return if !trimmed.is_empty() {
            vec![trimmed.to_string()]
        } else {
            vec![raw.to_string()]
        };
    }
    let parts: Vec<String> = raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if !parts.is_empty() {
        parts
    } else {
        vec![raw.to_string()]
    }
}

/// `/selected preview:\r?\n([\s\S]*?)(?: user notes: |$)/` — group 1.
fn match_preview(s: &str) -> Option<String> {
    let p = s.find("selected preview:")?;
    let mut j = p + "selected preview:".len();
    if s[j..].starts_with("\r\n") {
        j += 2;
    } else if s[j..].starts_with('\n') {
        j += 1;
    } else {
        return None;
    }
    let end = s[j..]
        .find(" user notes: ")
        .map(|k| j + k)
        .unwrap_or(s.len());
    Some(s[j..end].to_string())
}

/// `/user notes: ([\s\S]*?)\s*,?\s*$/` — group 1 (the maximal `\s*,?\s*` suffix removed).
fn match_notes(s: &str) -> Option<String> {
    let p = s.find("user notes: ")?;
    let start = p + "user notes: ".len();
    let x = &s[start..];
    // Longest trailing run that is all whitespace with at most one comma.
    let chars: Vec<(usize, char)> = x.char_indices().collect();
    let mut boundary = x.len();
    let mut comma_seen = false;
    for &(idx, ch) in chars.iter().rev() {
        if ch.is_whitespace() {
            boundary = idx;
        } else if ch == ',' && !comma_seen {
            comma_seen = true;
            boundary = idx;
        } else {
            break;
        }
    }
    Some(x[..boundary].to_string())
}

/// `segment.search(/ selected preview:| user notes: /)` — first index of either.
fn search_cut(segment: &str) -> Option<usize> {
    let a = segment.find(" selected preview:");
    let b = segment.find(" user notes: ");
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

struct PreviewNotes {
    answer: String,
    preview: Option<String>,
    notes: Option<String>,
}

fn extract_preview_notes(segment: &str) -> PreviewNotes {
    let preview_match = match_preview(segment);
    let notes_match = match_notes(segment);
    let cut_at = search_cut(segment);
    let mut answer = match cut_at {
        Some(idx) => segment[..idx].to_string(),
        None => segment.to_string(),
    };
    // Drop the answer's structural closing quote.
    if let Some(stripped) = answer.strip_suffix('"') {
        answer = stripped.to_string();
    }
    let preview = preview_match
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let notes = notes_match
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    PreviewNotes {
        answer,
        preview,
        notes,
    }
}

/// Anchored parse: locate each known question by its exact text, then take the
/// answer up to the next known question's marker.
fn parse_anchored(body: &str, questions: &[KnownQuestion]) -> Option<Vec<AskUserQuestionAnswer>> {
    let mut out: Vec<AskUserQuestionAnswer> = Vec::new();
    let mut cursor = 0usize;
    for i in 0..questions.len() {
        let q = &questions[i];
        let marker = format!("\"{}\"=\"", q.question);
        let m_idx = match body[cursor..].find(&marker) {
            Some(k) => cursor + k,
            None => continue, // unanswered question — omit
        };
        let ans_start = m_idx + marker.len();

        // Boundary: the start of the next answered question's marker.
        let mut seg_end = body.len();
        for question in questions.iter().skip(i + 1) {
            let next_marker = format!("\"{}\"=\"", question.question);
            let with_sep = format!(", {next_marker}");
            if let Some(k) = body[ans_start..].find(&with_sep) {
                seg_end = ans_start + k;
                break;
            }
            if let Some(k) = body[ans_start..].find(&next_marker) {
                seg_end = ans_start + k;
                break;
            }
        }

        let segment = &body[ans_start..seg_end];
        let pn = extract_preview_notes(segment);
        let mut entry = AskUserQuestionAnswer {
            question: q.question.clone(),
            answer: split_answer(&pn.answer, q.multi_select),
            preview: None,
            notes: None,
        };
        if pn.preview.is_some() {
            entry.preview = pn.preview;
        }
        if pn.notes.is_some() {
            entry.notes = pn.notes;
        }
        out.push(entry);
        cursor = seg_end;
    }
    if !out.is_empty() { Some(out) } else { None }
}

struct Pair {
    q: String,
    a: String,
    start: usize,
    end: usize,
}

/// PAIR = `/"([^"]*)"="([^"]*)"/g` — all non-overlapping matches.
fn find_pairs(body: &str) -> Vec<Pair> {
    let mut out: Vec<Pair> = Vec::new();
    let mut i = 0;
    while i < body.len() {
        if body[i..].starts_with('"')
            && let Some(pair) = try_pair(body, i)
        {
            i = pair.end;
            out.push(pair);
            continue;
        }
        let ch = body[i..].chars().next().unwrap_or('\0');
        i += ch.len_utf8();
    }
    out
}

fn try_pair(body: &str, i: usize) -> Option<Pair> {
    let after_q1 = i + 1;
    let qrel = body[after_q1..].find('"')?;
    let q = body[after_q1..after_q1 + qrel].to_string();
    let q_close = after_q1 + qrel;
    if !body[q_close + 1..].starts_with("=\"") {
        return None;
    }
    let a_start = q_close + 1 + 2;
    let arel = body[a_start..].find('"')?;
    let a = body[a_start..a_start + arel].to_string();
    let end = a_start + arel + 1;
    Some(Pair {
        q,
        a,
        start: i,
        end,
    })
}

/// Legacy regex parse — fallback when question metadata is unavailable.
fn parse_legacy(body: &str) -> Vec<AskUserQuestionAnswer> {
    let matches = find_pairs(body);
    if matches.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<AskUserQuestionAnswer> = Vec::new();
    for i in 0..matches.len() {
        let cur = &matches[i];
        let next = matches.get(i + 1);
        let tail_end = next.map(|n| n.start).unwrap_or(body.len());
        let tail = &body[cur.end..tail_end];

        let preview_match = match_preview(tail);
        let notes_match = match_notes(tail);

        let mut answer: Vec<String> = cur
            .a
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        if answer.is_empty() {
            answer = vec![cur.a.clone()];
        }

        let mut entry = AskUserQuestionAnswer {
            question: cur.q.clone(),
            answer,
            preview: None,
            notes: None,
        };
        let preview = preview_match
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let notes = notes_match
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if preview.is_some() {
            entry.preview = preview;
        }
        if notes.is_some() {
            entry.notes = notes;
        }
        out.push(entry);
    }
    out
}

pub fn parse_ask_user_question_result(
    content: &str,
    questions: Option<&[KnownQuestion]>,
) -> Vec<AskUserQuestionAnswer> {
    let body = match strip_body(content) {
        Some(b) => b,
        None => return Vec::new(),
    };
    if let Some(qs) = questions
        && !qs.is_empty()
        && let Some(anchored) = parse_anchored(&body, qs)
    {
        return anchored;
    }
    parse_legacy(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: &str = "User has answered your questions: ";
    const SUFFIX: &str = ". You can now continue with the user's answers in mind.";

    fn ans(q: &str, a: &[&str]) -> AskUserQuestionAnswer {
        AskUserQuestionAnswer {
            question: q.to_string(),
            answer: a.iter().map(|s| s.to_string()).collect(),
            preview: None,
            notes: None,
        }
    }

    fn kq(question: &str, multi_select: Option<bool>) -> KnownQuestion {
        KnownQuestion {
            question: question.to_string(),
            multi_select,
            options: None,
        }
    }

    #[test]
    fn parses_a_single_question_answer() {
        let s = format!("{PREFIX}\"Which DB?\"=\"Postgres\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![ans("Which DB?", &["Postgres"])]
        );
    }

    #[test]
    fn parses_multiple_questions() {
        let s = format!("{PREFIX}\"Q1\"=\"A1\", \"Q2\"=\"A2\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![ans("Q1", &["A1"]), ans("Q2", &["A2"])]
        );
    }

    #[test]
    fn splits_a_multi_select_answer_on_commas() {
        let s = format!("{PREFIX}\"Pick\"=\"Red,Green,Blue\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![ans("Pick", &["Red", "Green", "Blue"])]
        );
    }

    #[test]
    fn captures_preview_and_notes_segments() {
        let s = format!(
            "{PREFIX}\"Layout?\"=\"Grid\" selected preview:\n<div>grid</div> user notes: prefer dense, \"Theme?\"=\"Dark\"{SUFFIX}"
        );
        let mut expected0 = ans("Layout?", &["Grid"]);
        expected0.preview = Some("<div>grid</div>".to_string());
        expected0.notes = Some("prefer dense".to_string());
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![expected0, ans("Theme?", &["Dark"])]
        );
    }

    #[test]
    fn tolerates_commas_when_no_preview_notes_follow() {
        let s = format!("{PREFIX}\"Name\"=\"Doe, John\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![ans("Name", &["Doe", "John"])]
        );
    }

    #[test]
    fn captures_a_preview_that_uses_crlf_before_the_body() {
        let s = format!(
            "{PREFIX}\"Layout?\"=\"Grid\" selected preview:\r\n<div/> user notes: dense{SUFFIX}"
        );
        let mut e = ans("Layout?", &["Grid"]);
        e.preview = Some("<div/>".to_string());
        e.notes = Some("dense".to_string());
        assert_eq!(parse_ask_user_question_result(&s, None), vec![e]);
    }

    #[test]
    fn anchored_preserves_a_question_with_double_quotes() {
        let q = "\"Prepare Release Bugs\" is ambiguous to me — what do you want done?";
        let s = format!(
            "{PREFIX}\"{q}\"=\"1. cannot paste/attach images anymore in composer\"{SUFFIX}"
        );
        assert_eq!(
            parse_ask_user_question_result(&s, Some(&[kq(q, Some(false))])),
            vec![ans(
                q,
                &["1. cannot paste/attach images anymore in composer"]
            )]
        );
    }

    #[test]
    fn anchored_keeps_free_text_verbatim() {
        let q1 = "When you try to paste or attach an image in the composer, what exactly happens?";
        let q2 = "Which entry points are broken?";
        let a1 = "nothing happens at all, but forgot to mention that i run on that debug/queued-messages branch which also contains latest main";
        let a2 = "both, paperclip works until i choose the image i want to upload. once i hit \"open\" nothing shows up in the composer";
        let s = format!("{PREFIX}\"{q1}\"=\"{a1}\", \"{q2}\"=\"{a2}\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, Some(&[kq(q1, Some(false)), kq(q2, Some(false))])),
            vec![ans(q1, &[a1]), ans(q2, &[a2])]
        );
    }

    #[test]
    fn anchored_splits_multi_select_only_for_multiselect() {
        let s = format!("{PREFIX}\"Pick\"=\"Red,Blue\"{SUFFIX}");
        let q = KnownQuestion {
            question: "Pick".to_string(),
            multi_select: Some(true),
            options: Some(vec![
                KnownQuestionOption {
                    label: "Red".to_string(),
                },
                KnownQuestionOption {
                    label: "Blue".to_string(),
                },
            ]),
        };
        assert_eq!(
            parse_ask_user_question_result(&s, Some(&[q])),
            vec![ans("Pick", &["Red", "Blue"])]
        );
    }

    #[test]
    fn anchored_extracts_preview_and_notes() {
        let s = format!(
            "{PREFIX}\"Layout?\"=\"Grid\" selected preview:\n<div>grid</div> user notes: prefer dense, \"Theme?\"=\"Dark\"{SUFFIX}"
        );
        let mut e0 = ans("Layout?", &["Grid"]);
        e0.preview = Some("<div>grid</div>".to_string());
        e0.notes = Some("prefer dense".to_string());
        assert_eq!(
            parse_ask_user_question_result(
                &s,
                Some(&[kq("Layout?", Some(false)), kq("Theme?", Some(false))])
            ),
            vec![e0, ans("Theme?", &["Dark"])]
        );
    }

    #[test]
    fn anchored_omits_unanswered_questions() {
        let s = format!("{PREFIX}\"Q1\"=\"A1\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(
                &s,
                Some(&[kq("Q1", Some(false)), kq("Q2", Some(false))])
            ),
            vec![ans("Q1", &["A1"])]
        );
    }

    #[test]
    fn falls_back_to_legacy_when_no_question_matches() {
        let s = format!("{PREFIX}\"Different\"=\"X\"{SUFFIX}");
        assert_eq!(
            parse_ask_user_question_result(&s, Some(&[kq("Unrelated", Some(false))])),
            vec![ans("Different", &["X"])]
        );
    }

    #[test]
    fn returns_empty_for_non_askuserquestion_or_malformed() {
        assert_eq!(parse_ask_user_question_result("", None), Vec::new());
        assert_eq!(
            parse_ask_user_question_result("totally unrelated tool output", None),
            Vec::new()
        );
        assert_eq!(
            parse_ask_user_question_result(&format!("{PREFIX}garbage no quotes{SUFFIX}"), None),
            Vec::new()
        );
    }

    #[test]
    fn new_wording_single_question() {
        let new_prefix = "Your questions have been answered: ";
        let new_suffix = ". You can now continue with these answers in mind.";
        let s = format!("{new_prefix}\"What size pizza?\"=\"Small\"{new_suffix}");
        assert_eq!(
            parse_ask_user_question_result(&s, Some(&[kq("What size pizza?", None)])),
            vec![ans("What size pizza?", &["Small"])]
        );
    }

    #[test]
    fn new_wording_multiple_questions() {
        let new_prefix = "Your questions have been answered: ";
        let new_suffix = ". You can now continue with these answers in mind.";
        let s = format!("{new_prefix}\"Q1\"=\"A1\", \"Q2\"=\"A2\"{new_suffix}");
        assert_eq!(
            parse_ask_user_question_result(
                &s,
                Some(&[kq("Q1", Some(false)), kq("Q2", Some(false))])
            ),
            vec![ans("Q1", &["A1"]), ans("Q2", &["A2"])]
        );
    }

    #[test]
    fn new_wording_legacy_path_strips_suffix() {
        let new_prefix = "Your questions have been answered: ";
        let new_suffix = ". You can now continue with these answers in mind.";
        let s = format!("{new_prefix}\"What size pizza?\"=\"Small\"{new_suffix}");
        assert_eq!(
            parse_ask_user_question_result(&s, None),
            vec![ans("What size pizza?", &["Small"])]
        );
    }

    #[test]
    fn old_wording_still_parses() {
        let s = "User has answered your questions: \"What size pizza?\"=\"Small\". You can now continue with the user's answers in mind.";
        assert_eq!(
            parse_ask_user_question_result(s, Some(&[kq("What size pizza?", None)])),
            vec![ans("What size pizza?", &["Small"])]
        );
    }

    #[test]
    fn unrecognised_prefix_returns_empty() {
        assert_eq!(
            parse_ask_user_question_result("User skipped the question", None),
            Vec::new()
        );
    }

    #[test]
    fn canonical_cli_string_matches_shared_fixture() {
        // Mirrors ASK_USER_QUESTION_FIXTURE (types): Which DB? → Postgres; Pick →
        // [Red, Blue] with notes "dense".
        let s = "User has answered your questions: \"Which DB?\"=\"Postgres\", \"Pick\"=\"Red,Blue\" user notes: dense. You can now continue with the user's answers in mind.";
        let mut second = ans("Pick", &["Red", "Blue"]);
        second.notes = Some("dense".to_string());
        assert_eq!(
            parse_ask_user_question_result(s, None),
            vec![ans("Which DB?", &["Postgres"]), second]
        );
    }
}

// PORT STATUS: src/messages/parse-ask-user-question.ts (146 lines)
// confidence: high
// todos: 0
// notes: `regex` unavailable — PAIR (`"([^"]*)"="([^"]*)"`), the preview
// (`selected preview:\r?\n([\s\S]*?)(?: user notes: |$)`) and notes
// (`user notes: ([\s\S]*?)\s*,?\s*$`) patterns, and the `search()` cut are all
// hand-rolled with identical semantics. All 21 TS assertions ported; the
// canonical-fixture test inlines ASK_USER_QUESTION_FIXTURE's expected shape
// (Which DB?→Postgres, Pick→[Red,Blue]+notes:dense) rather than importing the
// types fixture. KnownQuestion.options is carried for interface fidelity though
// the parser never reads it (matches TS).
