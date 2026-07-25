//! Setup Advisor: fingerprints a project's files and recommends Claude Code
//! automations for what it finds. Mappings and rationale come from the
//! `claude-code-setup v1.0.0` plugin bundle; every shipped command is sourced in
//! `docs/research/2026-07-25-todo-191-command-provenance.md`.

pub mod detections;
pub mod fingerprint;
mod git_host;
pub mod manifests;
pub mod recommend;
pub mod rule;
pub mod rules;
pub mod signals;

pub use fingerprint::fingerprint;
pub use recommend::recommend;
