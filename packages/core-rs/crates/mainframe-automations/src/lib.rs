//! Automations v2 engine: When-triggers + linear Do-steps, executed over
//! trait ports (contract: docs/plans/2026-07-12-automations-v2-contract.md).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

/// Anchors the crate until the engine modules land (plan T0.1).
pub fn engine_placeholder() -> &'static str {
    "mainframe-automations"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_names_the_crate() {
        assert_eq!(engine_placeholder(), "mainframe-automations");
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md), not a TS port
// confidence: high
// todos: 0
// notes: T0.1 placeholder; the module tree (domain/store/engine/tokens/...) lands in Phases 1-10.
