//! Token resolution + literal substitution (contract Decision 9, plan Phase
//! 3). `Scope::resolve` returns the raw typed value (comparators and Repeat
//! need a real list/number, not a string); `substitute::render` stringifies
//! for prompt/param text.

pub mod compare;
pub mod scope;
pub mod substitute;
pub mod value;

pub use compare::evaluate;
pub use scope::Scope;
pub use substitute::render;
pub use value::TokenValue;

#[cfg(test)]
mod compare_tests;

#[cfg(test)]
mod substitute_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: none.
