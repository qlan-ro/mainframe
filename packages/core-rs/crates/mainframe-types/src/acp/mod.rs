//! Vendored subset of ACP (Agent Client Protocol) v2 for the chat-surface
//! facade (todo #350, `docs/specs/2026-08-28-todo-350-wire-protocol-payload-
//! grammar.md`). Pinned snapshot: spec repo commit `d0370de50e16`, schema
//! crate 1.7.0 (`docs/research/ACP-EVALUATION.md` sources table) — fetched at
//! that commit from `schema/v2/schema.json` and `schema/v2/meta.json` to
//! write these types (plan decision 1: hand-vendored, not the
//! `agent-client-protocol` crate, whose v2 sits behind an unstable feature
//! with no semver protection).
//!
//! Scope: the chat-facade payload grammar only. Fields orthogonal to it —
//! auth, elicitation, MCP server wiring, session config options, the resume
//! cursor scheme, `fs/*`/`terminal/*` client services — are kept opaque
//! (`serde_json::Value`) or omitted; each submodule's doc comment says which
//! and why. Mainframe's own `_mainframe.dev` extension vocabulary
//! (capabilities, retry marker, queued-prompt state, rich permission answer,
//! heartbeat) lives in `extensions.rs`.

pub mod content;
pub mod extensions;
pub mod jsonrpc;
mod patch;
pub mod permission;
pub mod session;
pub mod tool_call;
pub mod update;

pub use content::*;
pub use extensions::*;
pub use jsonrpc::*;
pub use permission::*;
pub use session::*;
pub use tool_call::*;
pub use update::*;
