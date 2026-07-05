---
"@qlan-ro/mainframe-ui": patch
---

Fix model/effort/plan/permission switching going silently dead for the rest of a session after the first message. A new thread's aui item id stays `__LOCALID_*` for life, but `ChatThreadController.setRemoteId` only updated the private `daemonId` field — the public `state.chatId` snapshot (read by the composer tuning toolbar, the diff-expand fetch, and the `@`-file search scope) never flipped to the real daemon id. Every PATCH after the first send targeted a chat id the daemon had never heard of, 404'd, and was silently swallowed by a `console.warn`. Adds a `chat.id.adopted` reducer event so `state.chatId` flips the moment the daemon id is known, plus a defensive `chatConfig.id` fallback in `useComposerTuning` for the same class of bug.
