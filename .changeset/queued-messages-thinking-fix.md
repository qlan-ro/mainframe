---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-desktop": patch
---

Fix #147: Queued messages don't dismiss and thinking indicator disappears while assistant is working

Add comprehensive debug logging and test coverage for message queuing and thinking state management. Identify race conditions and edge cases where queued messages fail to dismiss or the thinking indicator flips false prematurely while the assistant is still streaming responses. Tests cover queued message lifecycle and proper thinking indicator state transitions across subagent execution.
