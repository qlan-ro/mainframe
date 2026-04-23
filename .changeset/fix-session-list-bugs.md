---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.
