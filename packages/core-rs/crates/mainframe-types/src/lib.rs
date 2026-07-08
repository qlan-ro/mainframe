//! Ported from `packages/types/src/*` — pure serde structs/enums, one `.rs` per `.ts`.
//!
//! `packages/types/src/index.ts` is a barrel re-export only; it has no Rust module
//! counterpart here — this `lib.rs` plays that role (crate root re-exports go here
//! once the submodules have real content). `__fixtures__/` and `__tests__/` are test
//! support, not port targets, and are intentionally omitted from the module list.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod adapter;
pub mod api;
pub mod background_task;
pub mod chat;
pub mod command;
pub mod content;
pub mod context;
pub mod device;
pub mod display;
pub mod events;
pub mod git;
pub mod host;
pub mod launch;
pub mod lsp;
pub mod plugin;
pub mod search;
pub mod settings;
pub mod skill;
pub mod suggestion;
pub mod tags;
pub mod task_progress;
pub mod workflow;
