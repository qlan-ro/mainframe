---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the bottom-panel Skills/Agents lists showing Claude's skills for non-Claude
sessions. The sidebar fetch hardcoded `adapterId='claude'`; it now reads the
active session's adapter (exposed via `useActiveIdentity`, sourced from the
session `custom`) and falls back to `'claude'` only when no session is active.
