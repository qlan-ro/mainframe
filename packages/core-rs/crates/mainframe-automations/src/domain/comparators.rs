//! Which comparators fit which token type, and their wire names (Node
//! parity: packages/types/src/automation-domain/comparators.ts).

use super::condition::Comparator;
use super::scope::TokenType;

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
// notes: split out of scope.rs when the `$name` namespace landed there.
