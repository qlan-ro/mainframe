//! Token scope model backing validation: which named outputs each step
//! produces (contract §5's frozen table), plus builtin/trigger tokens and
//! the comparator/type compatibility table (Node parity:
//! packages/types/src/automation-domain/{tokens,comparators}.ts).

use super::catalog::{action_outputs, capitalize, output_label};
use super::form::FormFieldType;
use super::step::{ExpectedOutputType, Step};
use super::token::{TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER, TokenRef, TokenSourceKind};
use super::trigger::Trigger;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenType {
    Text,
    Number,
    List,
    Choice,
    Date,
    Object,
}

impl TokenType {
    pub(crate) fn describe(self) -> &'static str {
        match self {
            TokenType::Text => "text",
            TokenType::Number => "number",
            TokenType::List => "list",
            TokenType::Choice => "choice",
            TokenType::Date => "date",
            TokenType::Object => "object",
        }
    }
}

/// A named output visible in scope, with display names for error messages.
#[derive(Debug, Clone)]
pub(crate) struct TokenInfo {
    pub step_id: String,
    pub output: String,
    pub token_type: TokenType,
    pub label: String,
    pub source: String,
    /// Stamped by whoever produced the info; `info` defaults to `Builtin`
    /// because builtins are the only family with no stamping step.
    pub source_kind: TokenSourceKind,
    /// The producing step's stored collision ordinal, so
    /// `build_variable_namespace` can name this without consulting position.
    /// `None` on a step saved before `outputName` existed.
    pub name_ordinal: Option<u32>,
}

fn info(
    step_id: &str,
    output: &str,
    token_type: TokenType,
    label: &str,
    source: &str,
) -> TokenInfo {
    TokenInfo {
        step_id: step_id.to_string(),
        output: output.to_string(),
        token_type,
        label: label.to_string(),
        source: source.to_string(),
        source_kind: TokenSourceKind::Builtin,
        name_ordinal: None,
    }
}

fn stamp(kind: TokenSourceKind, mut infos: Vec<TokenInfo>) -> Vec<TokenInfo> {
    for info in &mut infos {
        info.source_kind = kind;
    }
    infos
}

/// The Repeat block's `Current item`, synthesized by every scope walk and
/// never produced by a step (contract §5).
pub(crate) fn current_item_info() -> TokenInfo {
    TokenInfo {
        source_kind: TokenSourceKind::Item,
        ..info(
            TOKEN_STEP_CURRENT,
            "item",
            TokenType::Text,
            "Current item",
            "Repeat",
        )
    }
}

pub(crate) fn builtin_tokens() -> Vec<TokenInfo> {
    vec![
        info("builtin", "today", TokenType::Date, "Today", "Built-in"),
        info("builtin", "now", TokenType::Date, "Now", "Built-in"),
    ]
}

/// Event triggers produce `result`/`chatId`; webhooks produce `payload`;
/// schedules produce nothing.
pub(crate) fn trigger_tokens(triggers: &[Trigger]) -> Vec<TokenInfo> {
    let mut out = Vec::new();
    for trigger in triggers {
        match trigger {
            Trigger::Event(_) => {
                out.push(info(
                    TOKEN_STEP_TRIGGER,
                    "result",
                    TokenType::Text,
                    "Result",
                    "Trigger",
                ));
                out.push(info(
                    TOKEN_STEP_TRIGGER,
                    "chatId",
                    TokenType::Text,
                    "Chat",
                    "Trigger",
                ));
            }
            Trigger::Webhook(_) => {
                out.push(info(
                    TOKEN_STEP_TRIGGER,
                    "payload",
                    TokenType::Object,
                    "Payload",
                    "Trigger",
                ));
            }
            Trigger::Schedule(_) => {}
        }
    }
    stamp(TokenSourceKind::Trigger, out)
}

fn expected_output_type(t: ExpectedOutputType) -> TokenType {
    match t {
        ExpectedOutputType::Text => TokenType::Text,
        ExpectedOutputType::Number => TokenType::Number,
        ExpectedOutputType::List => TokenType::List,
        ExpectedOutputType::Choice => TokenType::Choice,
    }
}

fn form_field_type(t: FormFieldType) -> TokenType {
    match t {
        FormFieldType::Multi => TokenType::List,
        FormFieldType::Choice => TokenType::Choice,
        FormFieldType::Number => TokenType::Number,
        FormFieldType::Text | FormFieldType::Textarea => TokenType::Text,
    }
}

/// Named outputs a single step produces. `if` aggregates BOTH branches
/// (branch results leak to later siblings once the block closes); `repeat`
/// produces nothing — its `Current item` is synthesized by the walk and
/// never leaks.
pub(crate) fn step_produces(step: &Step) -> Vec<TokenInfo> {
    let mut produced = produced_by(step);
    if let Some(ordinal) = output_name_ordinal(step) {
        for info in &mut produced {
            info.name_ordinal = Some(ordinal);
        }
    }
    match own_source_kind(step) {
        Some(kind) => stamp(kind, produced),
        // `If` re-emits its branches' infos, already stamped by their steps.
        None => produced,
    }
}

/// The trailing `_N` of a step's minted `outputName`, which is the whole of
/// what naming needs from it (the base is re-derived per output).
pub(crate) fn output_name_ordinal(step: &Step) -> Option<u32> {
    let stored = match step {
        Step::AskAgent(s) => s.output_name.as_deref(),
        Step::AskMe(s) => s.output_name.as_deref(),
        Step::RunAction(s) => s.output_name.as_deref(),
        _ => None,
    }?;
    let digits = stored.rsplit_once('_')?.1;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn own_source_kind(step: &Step) -> Option<TokenSourceKind> {
    match step {
        Step::AskAgent(_) => Some(TokenSourceKind::Agent),
        Step::AskMe(_) => Some(TokenSourceKind::AskMe),
        Step::RunAction(_) => Some(TokenSourceKind::Action),
        Step::SetVariable(_) => Some(TokenSourceKind::Variable),
        Step::Notify(_) | Step::Wait(_) | Step::Repeat(_) | Step::If(_) => None,
    }
}

fn produced_by(step: &Step) -> Vec<TokenInfo> {
    match step {
        Step::AskAgent(s) => {
            let mut out = vec![
                info(&s.id, "result", TokenType::Text, "Result", "Ask agent"),
                info(&s.id, "chatId", TokenType::Text, "Chat", "Ask agent"),
            ];
            for expected in s.expects.as_deref().unwrap_or(&[]) {
                out.push(info(
                    &s.id,
                    &expected.key,
                    expected_output_type(expected.output_type),
                    &capitalize(&expected.key),
                    "Ask agent",
                ));
            }
            out
        }
        Step::AskMe(s) => s
            .fields
            .iter()
            .filter(|f| !f.key.is_empty())
            .map(|f| {
                let label = f.label.clone().unwrap_or_else(|| f.key.clone());
                info(
                    &s.id,
                    &f.key,
                    form_field_type(f.field_type),
                    &label,
                    &s.title,
                )
            })
            .collect(),
        Step::RunAction(s) => action_outputs(&s.action_id)
            .iter()
            .map(|(name, token_type)| {
                info(&s.id, name, *token_type, &output_label(name), &s.action_id)
            })
            .collect(),
        Step::Notify(_) | Step::Wait(_) => Vec::new(),
        Step::SetVariable(s) => {
            let source = if s.name.is_empty() {
                "Set a value".to_string()
            } else {
                format!("Set {}", s.name)
            };
            vec![info(&s.id, "value", TokenType::Text, &s.name, &source)]
        }
        Step::If(s) => {
            let mut out = Vec::new();
            for inner in s.then.iter().chain(s.otherwise.iter()) {
                out.extend(step_produces(inner));
            }
            out
        }
        Step::Repeat(_) => Vec::new(),
    }
}

/// Every `TokenRef` a step directly uses: chip-text fields plus the direct
/// refs (If condition tokens, Repeat `items`). Block bodies are walked
/// separately.
pub(crate) fn step_refs(step: &Step) -> Vec<&TokenRef> {
    use super::template::chip_tokens;
    match step {
        Step::AskAgent(s) => {
            let mut refs = chip_tokens(&s.prompt);
            if let Some(worktree) = &s.worktree {
                refs.extend(chip_tokens(&worktree.branch_name));
            }
            refs
        }
        Step::AskMe(_) | Step::Wait(_) => Vec::new(),
        Step::RunAction(s) => s.params.values().flat_map(|p| chip_tokens(p)).collect(),
        Step::Notify(s) => chip_tokens(&s.message),
        Step::SetVariable(s) => chip_tokens(&s.value),
        Step::If(s) => s.conditions.iter().map(|c| &c.token).collect(),
        Step::Repeat(s) => vec![&s.items],
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: the contract §5 output table lives in catalog.rs; scope semantics
//        mirror Node's token-scope.ts (If leaks, Repeat isolates).
