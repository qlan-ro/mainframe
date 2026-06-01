---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-desktop": patch
---

Normalize the daemon HTTP API to a single response envelope. Every route now returns `{ success: true, data }` (or `{ success: true }` for state-only mutations) and `{ success: false, error }` on failure, replacing the previous mix of bare objects, bare arrays, and ad-hoc `{ tasks }` / `{ ok: true }` / `{ reason }` shapes. Git read endpoints keep their not-a-git-repo "soft errors" as successful empty payloads so the existing empty-state UX is unchanged. Desktop API consumers unwrap the envelope; the mobile client already tolerates both shapes. Internal-only change with no user-facing behavior difference.
