---
'@qlan-ro/mainframe-core': patch
---

Decompose the Claude adapter's `events.ts` (618 lines) by lifting the two largest stream-event handlers into their own modules: `assistant-event.ts` (`handleAssistantEvent` + the V2 task accumulator) and `user-event.ts` (`handleUserEvent` + subagent-child handling + skill-injection parsing). `events.ts` keeps stream framing, the small system/control/result handlers, and the `handleEvent` dispatch, dropping to 233 lines. No behavior change; the externally imported `handleStdout`/`handleStderr`/`handleControlResponseEvent` stay in `events.ts`.
