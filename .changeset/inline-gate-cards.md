---
"@qlan-ro/mainframe-app-tauri": patch
---

Add the three inline interactive chat gate cards — tool **Permission**,
**AskUserQuestion**, and **Plan approval** (ExitPlanMode) — rendered in the thread
via a single `ChatGateMount` at the thread tail. All three ride the existing
out-of-band `control_request` channel (discriminated by `ControlRequest.toolName`)
and reply through `replyToPermission`; no daemon/contract changes. Queue-front-only
(one gate at a time, ordered by `askedAt`); "Always allow" only when the request
carries `suggestions`; the plan card ships the exec-mode + clear-context run
controls. Permission cards dismiss on answer; AskUserQuestion/Plan persist via the
existing tool-result display cards.
