---
"@qlan-ro/mainframe-ui": patch
---

Repair four unit-test files that were red in CI, all test-side only. `FileTree.reveal.test.tsx` and `layout-preview-reap-seam.test.tsx` render `FileTreeRowMenu`/`PreviewInstance`, which read the active daemon via `useDaemonIsLocal()` — both now wrap their renders in `ActiveDaemonProvider`. `App.integration.test.tsx`'s `useAssistantRuntime` mock was missing `threads.getState()`/`switchToNewThread()`, which the ⌘N hotkey handler reads; the mock now returns the full `ThreadListState` shape. `tauri-config.test.ts` pointed at `packages/ui/src-tauri`, a path that moved to `packages/app-tauri/src-tauri` in the 2026-06-25 renderer extraction; the test now resolves the real location.
