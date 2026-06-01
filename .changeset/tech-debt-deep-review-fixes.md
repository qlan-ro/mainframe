---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-desktop": patch
---

Deep-review follow-up fixes for the tech-debt PR:

- **Security (core):** the content-search JS fallback (used when ripgrep is unavailable) now re-resolves every enumerated file through `realpath` + project-boundary containment before reading it. Previously an in-repo symlink returned by `git ls-files` could escape the project and surface out-of-project file contents in search results.
- **Regression (core):** todo attachment uploads accept zero-byte files again. WS10 tightened the schema to `data: z.string().min(1)`, which 400'd a legitimate empty file; relaxed to `z.string()` (length is carried by `sizeBytes`).
- **Types:** add `ApiResponseEmpty` (`ApiOkEmpty | ApiErr`) for state-only routes that reply via `okEmpty`, and use it for the git stage/unstage/push desktop clients instead of `ApiResponse<never>`.
- **Hygiene (core):** remove the dead, unreferenced `isGitRepo` helper from `workspace/worktree.ts`.
