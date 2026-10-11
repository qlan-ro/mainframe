use mainframe_types::display::AskUserQuestionAnswer;
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

pub(crate) fn parse_ask_user_question_result(
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
mod tests;
