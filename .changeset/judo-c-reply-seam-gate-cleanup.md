---
"@qlan-ro/mainframe-app-tauri": patch
---

Gate-card cleanup from the review. The reply seam now takes only the `ControlResponse`
(judo-C) — the response already carries its `requestId`, so passing it separately (a
"replied to the wrong entry" footgun) is gone. Removes the dead `useChatPermissions`
hook; extracts the AskUserQuestion answer-shaping into one `resolveChosen` helper shared
by `assembleAnswers` and the Next/Submit enable-check (no more drift); and gives
PlanGate's "Keep planning" a Cancel back to the approve panel.
