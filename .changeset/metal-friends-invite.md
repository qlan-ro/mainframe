---
'@qlan-ro/mainframe-core': patch
---

Drop the duplicate subagent dispatch prompt when it arrives in the array-of-text-blocks shape. PR #264 caught the string-content path, but the CLI's `normalizeMessages` (`utils/messages.ts:782-793`) wraps any string-content user message into `[{type: 'text', text: <string>}]` before yielding to stream-json — so in practice the daemon receives the prompt as a single text block, not as a string. The new guard fires inside the array-content text-block branch, after the existing skill-injection check, so subagent skill loads still surface and only the duplicate prompt is suppressed.
