/**
 * Smart-action detection for assistant markdown: slash instructions (#278)
 * and localhost URLs (#279). Pure, React-free, I/O-free — the UI owns
 * rendering and gating, this module owns the grammar and the wire contract.
 */
export * from './instructions.js';
export * from './port-tunnels.js';
