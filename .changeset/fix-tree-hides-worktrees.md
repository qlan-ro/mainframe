---
"@qlan-ro/mainframe-core": patch
---

Stop hiding `worktrees`/`.worktrees` directories from the file tree at any depth. The shared `IGNORED_DIRS` set (used by recursive search/list paths) was applied unconditionally to the tree route, which hid e.g. `.claude/worktrees/` even though the user expects to navigate into it. The tree route now uses a narrower allowlist (`.git`, `node_modules`); search and file listing keep the broader exclusion.
