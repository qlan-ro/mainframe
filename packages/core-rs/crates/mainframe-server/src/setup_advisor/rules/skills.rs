//! The `skills` rules dataset.
//!
//! Structure follows the upstream `claude-code-setup v1.0.0` bundle's
//! `claude-automation-recommender` skill; every `command`, source repo, install
//! count, and skill id is transcribed from
//! `docs/research/2026-07-25-todo-191-command-provenance.md`, which is the only
//! source of truth for this file. A signal with no row there ships no rule —
//! `passport` is the one such signal.
//!
//! Priority runs in tier order so a registry-backed skill always outranks a
//! scaffold: vendor-official 10–26, third-party 40–58, first-party 80–87.
//!
//! The submodules are the dataset, not an arrangement of it: each owns the
//! `RULES` slice its rows live in, so a rule exists by being written down once.
//! An index naming all 43 individually would drop any rule whose line went
//! missing, silently and without failing a build.

mod aggregator_languages;
mod aggregator_tooling;
mod common;
mod scaffold;
mod scaffold_bodies;
mod vendor_services;
mod vendor_stack;

use crate::setup_advisor::rule::Rule;

/// Every skills rule, tier by tier: vendor-official, then third-party, then the
/// first-party scaffolds that only reach the user when nothing else matched.
pub fn rules() -> impl Iterator<Item = &'static Rule> {
    [
        vendor_stack::RULES,
        vendor_services::RULES,
        aggregator_languages::RULES,
        aggregator_tooling::RULES,
        scaffold::RULES,
    ]
    .into_iter()
    .flatten()
}
