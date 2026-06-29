---
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-types": minor
---

Progressive external-session listing with CLI `/resume` parity. The daemon now
discovers importable sessions by scanning `~/.claude/projects/*.jsonl` directly
(the non-authoritative `sessions-index.json` path is dropped): a stat-only lite
pass orders candidates by mtime, and only the requested page is enriched via a
head/tail read — applying the CLI's hide rules (`isSidechain`, team sessions,
wrong-cwd) and title precedence (`customTitle > aiTitle > summary > firstPrompt`).
The list endpoint is paginated (`?offset&limit` → `{ sessions, total, nextOffset }`),
and the import dialog loads pages on scroll. Title-generation no longer creates
throwaway resumable sessions (`--no-session-persistence`), so they stop polluting
the list.
