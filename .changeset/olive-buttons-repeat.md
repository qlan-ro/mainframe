---
'@qlan-ro/mainframe-core': patch
---

Fix Codex sessions failing to start when a configured MCP server needs authentication.

The codex binary writes tracing logs to stderr as normal operation, and the adapter escalated
every stderr line to a fatal run error. An unauthenticated remote MCP server makes codex log an
`rmcp` ERROR on every startup, so each Codex session died instantly with "Agent run failed"
while the underlying run was healthy.

stderr is now treated as a log stream. Real failures still surface: an unexpected non-zero exit
reports its code along with the tail of recent stderr, so genuine startup crashes keep their
diagnostics.
