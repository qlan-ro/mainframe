//! Token scope model backing validation: which named outputs each step
//! produces (contract §5's frozen table), plus builtin/trigger tokens and
//! the comparator/type compatibility table (Node parity:
//! packages/types/src/automation-domain/{tokens,comparators}.ts).

use super::catalog::{action_outputs, capitalize, output_label};
use super::condition::Comparator;
use super::form::FormFieldType;
use super::step::{ExpectedOutputType, Step};
use super::token::{TOKEN_STEP_TRIGGER, TokenRef};
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
    out
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
        Step::Notify(_) => Vec::new(),
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
        Step::AskMe(_) => Vec::new(),
        Step::RunAction(s) => s.params.values().flat_map(|p| chip_tokens(p)).collect(),
        Step::Notify(s) => chip_tokens(&s.message),
        Step::If(s) => s.conditions.iter().map(|c| &c.token).collect(),
        Step::Repeat(s) => vec![&s.items],
    }
}

/// Comparators that fit each token type (Node's BY_TYPE table; `contains`
/// is polymorphic — text substring, list membership).
pub(crate) fn comparators_for(token_type: TokenType) -> &'static [Comparator] {
    match token_type {
        TokenType::Text => &[
            Comparator::Is,
            Comparator::IsNot,
            Comparator::Contains,
            Comparator::StartsWith,
            Comparator::IsOneOf,
        ],
        TokenType::Choice => &[Comparator::Is, Comparator::IsNot, Comparator::IsOneOf],
        TokenType::Number => &[
            Comparator::Eq,
            Comparator::IsNot,
            Comparator::Lt,
            Comparator::Gt,
        ],
        TokenType::List => &[
            Comparator::IsEmpty,
            Comparator::NotEmpty,
            Comparator::Contains,
        ],
        TokenType::Date => &[
            Comparator::Is,
            Comparator::IsNot,
            Comparator::Lt,
            Comparator::Gt,
        ],
        TokenType::Object => &[Comparator::IsEmpty, Comparator::NotEmpty],
    }
}

pub(crate) fn comparator_wire_name(comparator: Comparator) -> &'static str {
    match comparator {
        Comparator::Is => "is",
        Comparator::IsNot => "is_not",
        Comparator::Contains => "contains",
        Comparator::StartsWith => "starts_with",
        Comparator::Eq => "eq",
        Comparator::Lt => "lt",
        Comparator::Gt => "gt",
        Comparator::IsEmpty => "is_empty",
        Comparator::NotEmpty => "not_empty",
        Comparator::IsOneOf => "is_one_of",
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: the contract §5 output table lives in catalog.rs; scope semantics
//        mirror Node's token-scope.ts (If leaks, Repeat isolates).
