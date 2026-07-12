//! Ask-me form fields (contract §1): five field types, `showWhen` visibility.
//! Canonical definitions live in `mainframe-types::automation` (T9.1 — the
//! interaction summary WS payload carries them); re-exported here under the
//! engine's original names.

pub use mainframe_types::automation::{
    AutomationFormField, AutomationFormFieldType as FormFieldType, AutomationShowWhen as ShowWhen,
};

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: `showWhen` is the one wire name (contract renames Rust's `when`).
