/**
 * Vendored subset of ACP (Agent Client Protocol) v2 for the chat-surface
 * facade (todo #350, `docs/specs/2026-08-28-todo-350-wire-protocol-payload-
 * grammar.md`). Pinned snapshot: spec repo commit `d0370de50e16`, schema
 * crate 1.7.0 (`docs/research/ACP-EVALUATION.md` sources table) — fetched at
 * that commit from `schema/v2/schema.json` and `schema/v2/meta.json`.
 * Mirrors `packages/core-rs/crates/mainframe-types/src/acp/`; see that
 * directory's `mod.rs` for the shared scope note.
 */
export * from './content.js';
export * from './extensions.js';
export * from './jsonrpc.js';
export * from './permission.js';
export * from './session.js';
export * from './tool-call.js';
export * from './update.js';
