---
"@qlan-ro/mainframe-ui": patch
---

Fix four defects in the app-tauri new-session and chat-streaming flow:

- **New Session button was inert.** The `Hint` tooltip sat inside
  `ThreadListPrimitive.New asChild`, so the Slot-injected click handler landed on
  `Hint` (which doesn't forward it) instead of the button. `Hint` now wraps the
  trigger, matching every other Hint+trigger in the sidebar.
- **New sessions were created in the wrong project.** assistant-ui reuses one
  `__LOCALID_*` new-thread slot until the first send, and the draft/ready state
  was only cleared on send — so an abandoned draft leaked its project into the
  next New (or skipped the picker in the "All" view). Both New entry points (the
  sidebar button and the ⌘N hotkey) now reset the reused slot via
  `resetNewThreadDraft`.
- **Skills / agents / file pickers were empty on a new-thread draft.** The `/`,
  `@`-agents, and `@`-files popovers read project/adapter only from the daemon
  `chatConfig`, which is null before the first send. They now fall back to the
  in-memory draft via a shared `resolveDraftChatContext`, so they populate
  immediately on a fresh thread.
- **Assistant messages appeared instantly instead of streaming.** The pre-built
  `messageRepository` path skips assistant-ui's `getAutoStatus`, so the tail
  message was never marked `running` and `useSmooth` had nothing to animate. The
  projection now marks the streaming tail assistant message `running` while a run
  is active, restoring the character-by-character typing reveal; loaded history
  stays instant.
