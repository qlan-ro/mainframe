---
"@qlan-ro/mainframe-app-tauri": patch
---

Wrap-up quick wins: wire retry-resend for failed user sends (a `local.message.retrying`
reducer event + `ChatThreadController.retryMessage` + a Retry button on the "Failed to
send" indicator; text-only resend, attachments are not re-uploaded), and remove the stray
divider rendered before each worktree group in the branch popover so worktrees flow under
Local as sub-groups (only Remote keeps a divider).
