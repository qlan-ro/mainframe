//! The `$name` variable model — the runtime twin of
//! packages/types/src/automation-domain/variables.ts, which must stay in
//! lockstep with it; the shared cases live in
//! packages/types/fixtures/automations/variable-substitution.json.
//!
//! Names are position-dependent because scope is: they are assigned over the
//! descriptors visible *at the referencing step*, in walk order. After
//! `[repeat[agent A], agent B]`, B is `agent_result` — A never leaves the
//! repeat body. A flat sweep of every step would name B `agent_result_2` and
//! silently substitute A's value at run time.

use std::collections::HashMap;

use crate::domain::{
    AutomationDefinition, Step, TOKEN_STEP_CURRENT, TokenRef,
    scope::{TokenInfo, builtin_tokens, current_item_info, step_produces, trigger_tokens},
    token::TokenSourceKind,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariableRef {
    pub name: String,
    /// Dotted suffix, dug into the resolved value with the same semantics as
    /// a legacy token's `field`.
    pub path: Vec<String>,
    /// Byte index of the `$`.
    pub start: usize,
    /// Exclusive byte end of the whole match.
    pub end: usize,
    /// Set on the braced `${name}` spelling, which needs no word boundary.
    pub delimited: bool,
}

/// What a name resolves to. `Current item` has no producing step, so it can
/// only be addressed through the reserved stepId, never a `TokenRef` a step
/// emitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NameTarget {
    Ref(TokenRef),
    CurrentItem,
}

/// Names visible at one step.
pub type NameMap = HashMap<String, NameTarget>;
/// Every step's `NameMap`, keyed by step id — built once per run.
pub type NameIndex = HashMap<String, NameMap>;

fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// A path segment may start with a digit — `$prs.0` indexes a list, the same
/// descent a legacy token's `field` performs.
fn scan_segment(bytes: &[u8], from: usize) -> usize {
    let mut end = from;
    while end < bytes.len() && is_name_char(bytes[end]) {
        end += 1;
    }
    end
}

/// A `$` only opens a ref at the start of the text or after whitespace — the
/// same word boundary the composer's `/` and `@` triggers use.
fn opens_ref(text: &str, index: usize) -> bool {
    index == 0
        || text[..index]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace)
}

/// The `name.path` body shared by both spellings, from `from`; `end == from`
/// means "no name here".
fn scan_body(text: &str, from: usize) -> (String, Vec<String>, usize) {
    let bytes = text.as_bytes();
    if !bytes.get(from).is_some_and(|b| is_name_start(*b)) {
        return (String::new(), Vec::new(), from);
    }
    let name_end = scan_segment(bytes, from);

    let mut path = Vec::new();
    let mut end = name_end;
    while bytes.get(end) == Some(&b'.') {
        let segment_end = scan_segment(bytes, end + 1);
        if segment_end == end + 1 {
            break;
        }
        path.push(text[end + 1..segment_end].to_string());
        end = segment_end;
    }
    (text[from..name_end].to_string(), path, end)
}

/// Every `$name` / `$name.path` / `${name}` occurrence, with exact offsets. A
/// trailing bare period is never consumed: `$release_notes.` resolves the
/// variable and leaves the period as text. Scanning is byte-wise, which is
/// UTF-8 safe here because every byte it matches on is ASCII.
///
/// The braced spelling exists because the bare one needs a word boundary, so
/// `todo/$id` is literal text; the editor inserts `${id}` mid-word, and it is
/// recognized anywhere.
pub fn extract_variable_refs(text: &str) -> Vec<VariableRef> {
    let bytes = text.as_bytes();
    let mut refs = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'$' {
            i += 1;
            continue;
        }

        if bytes.get(i + 1) == Some(&b'{') {
            let (name, path, end) = scan_body(text, i + 2);
            if end == i + 2 || bytes.get(end) != Some(&b'}') {
                i += 1;
                continue;
            }
            refs.push(VariableRef {
                name,
                path,
                start: i,
                end: end + 1,
                delimited: true,
            });
            i = end + 1;
            continue;
        }

        if !opens_ref(text, i) {
            i += 1;
            continue;
        }
        let (name, path, end) = scan_body(text, i + 1);
        if end == i + 1 {
            i += 1;
            continue;
        }
        refs.push(VariableRef {
            name,
            path,
            start: i,
            end,
            delimited: false,
        });
        i = end;
    }
    refs
}

/// Outputs an agent step produces without the user naming them — they need
/// the step-kind prefix to read as a variable.
const IMPLICIT_AGENT_OUTPUTS: [&str; 2] = ["result", "chatId"];

/// Folds arbitrary text into a `$name`-safe identifier. Lossy on purpose —
/// collisions are resolved by suffixing in `build_variable_namespace`.
pub fn sanitize_variable_name(raw: &str) -> String {
    let mut snake = String::with_capacity(raw.len() + 1);
    let mut previous: Option<char> = None;
    for ch in raw.chars() {
        if ch.is_ascii_uppercase()
            && previous.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit())
        {
            snake.push('_');
        }
        let lower = ch.to_ascii_lowercase();
        snake.push(
            if lower.is_ascii_lowercase() || lower.is_ascii_digit() || lower == '_' {
                lower
            } else {
                '_'
            },
        );
        previous = Some(ch);
    }
    if snake.is_empty() {
        return "_".to_string();
    }
    if snake.starts_with(|c: char| c.is_ascii_digit()) {
        format!("_{snake}")
    } else {
        snake
    }
}

/// The base identifier a descriptor derives, before collision suffixing.
pub(crate) fn variable_name_for(info: &TokenInfo) -> String {
    match info.source_kind {
        TokenSourceKind::Trigger => format!("trigger_{}", sanitize_variable_name(&info.output)),
        TokenSourceKind::Agent if IMPLICIT_AGENT_OUTPUTS.contains(&info.output.as_str()) => {
            format!("agent_{}", sanitize_variable_name(&info.output))
        }
        TokenSourceKind::Item => "item".to_string(),
        TokenSourceKind::Variable => sanitize_variable_name(&info.label),
        _ => sanitize_variable_name(&info.output),
    }
}

/// Assigns a final name to every descriptor, in list order.
///
/// A descriptor's name is its base plus the ordinal its producing step minted
/// once, at creation (`scope::output_name_ordinal`) — *not* its position here.
/// That is the point: insert a second agent step above the first and the first
/// keeps `$agent_result`, because the ordinal travels with the step rather than
/// with the row it sits in. Steps saved before `outputName` existed carry no
/// ordinal and fall back to position-ordered suffixing, so old definitions keep
/// the names they had.
///
/// A set-variable name is never suffixed — the user typed it, so a second step
/// claiming it is a mistake, not a second addressable value: the first wins and
/// `validate` reports the duplicate.
pub(crate) fn build_variable_namespace(scope: &[TokenInfo]) -> NameMap {
    let mut by_name = NameMap::new();
    for info in scope {
        let base = variable_name_for(info);
        let mut name = match info.name_ordinal {
            Some(ordinal) => format!("{base}_{ordinal}"),
            None => base.clone(),
        };
        if by_name.contains_key(&name) {
            if info.source_kind == TokenSourceKind::Variable {
                continue;
            }
            let mut suffix = 2;
            while by_name.contains_key(&format!("{base}_{suffix}")) {
                suffix += 1;
            }
            name = format!("{base}_{suffix}");
        }
        by_name.insert(name, target_for(info));
    }
    by_name
}

fn target_for(info: &TokenInfo) -> NameTarget {
    if info.step_id == TOKEN_STEP_CURRENT {
        return NameTarget::CurrentItem;
    }
    NameTarget::Ref(TokenRef {
        step_id: info.step_id.clone(),
        output: info.output.clone(),
        field: None,
    })
}

/// The names every step in a definition can address, from the same scope walk
/// validation uses (`domain::validate::walk`): `if` leaks both branches to
/// later siblings, `repeat` isolates its body and adds `Current item`.
pub fn build_name_index(definition: &AutomationDefinition) -> NameIndex {
    let mut scope = builtin_tokens();
    scope.extend(trigger_tokens(&definition.triggers));
    let mut index = NameIndex::new();
    walk(&definition.steps, &mut scope, &mut index);
    index
}

fn walk(steps: &[Step], scope: &mut Vec<TokenInfo>, index: &mut NameIndex) {
    for step in steps {
        index.insert(step.id().to_string(), build_variable_namespace(scope));
        match step {
            Step::If(block) => {
                walk(&block.then, &mut scope.clone(), index);
                walk(&block.otherwise, &mut scope.clone(), index);
                scope.extend(step_produces(step));
            }
            Step::Repeat(block) => {
                let mut inner = scope.clone();
                inner.push(current_item_info());
                walk(&block.steps, &mut inner, index);
            }
            _ => scope.extend(step_produces(step)),
        }
    }
}

// PORT STATUS: TS port of packages/types/src/automation-domain/variables.ts (T6)
// confidence: high
// todos: 0
// notes: rename helpers stay TS-only — they rewrite editor drafts, which the
//        runtime never does.
