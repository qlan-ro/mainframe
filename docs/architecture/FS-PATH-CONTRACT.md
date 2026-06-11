# Filesystem Path Contract

## Overview

All daemon filesystem and git routes operate on **effective-base-relative** paths.
This document is the authoritative contract for every route that reads, writes, or
runs git commands under a project or worktree directory.

---

## Path flavours

| Flavour | Where used | Notes |
|---------|-----------|-------|
| **effective-base-relative** | All `/files`, `/git`, `/search`, `/launch` routes | Default. `chatId` selects the base. |
| **absolute-under-base** | `GET /files` only | Compatibility affordance: an absolute path that resolves within the base is accepted in addition to relative paths. |
| **absolute, any location** | `/filesystem/browse`, `/files/external` | Intentionally unrestricted by design; these endpoints are filesystem explorers. |

---

## How the effective base is resolved

The canonical resolver is `getEffectivePath(ctx, projectId, chatId?)` in
`packages/core/src/server/routes/types.ts`.

1. Look up the project by `projectId`. Return `null` (→ 404) if not found.
2. If `chatId` is provided:
   - Look up the chat. If the chat's `projectId` differs from the URL's `projectId`,
     return `null` (→ 404). This is the **cross-project access guard** — it prevents
     a `chatId` from project B from silently re-basing reads or writes under project
     A's URL.
   - If the chat has a `worktreePath` and `worktreeMissing === true`, return `null`
     (→ 409 "Worktree missing").
   - If the chat has a live `worktreePath`, return it as the base.
3. Return the project root path.

`ChatManager.getEffectivePath(chatId)` (used by chat-only POST routes without a
project URL param) applies the same logic: returns `null` when the chat is unknown,
its project is unknown, or `worktreeMissing === true`.

---

## Error semantics

| Condition | HTTP status | Message |
|-----------|-------------|---------|
| Project not found | 404 | `"Project not found"` |
| `chatId` belongs to a different project | 404 | `"Project not found"` |
| Worktree path has been deleted | 409 | `"Worktree missing"` |
| Path resolves outside the base | 403 | `"Path outside project"` |

Routes distinguish "worktree missing" from "not found" by checking
`ctx.chats.getChat(chatId)?.worktreeMissing` after receiving a `null` base.

---

## Consumer responsibilities

Every route handler that accepts a file path from the caller MUST:

1. Call `getEffectivePath(ctx, projectId, chatId?)` to obtain the validated base.
   Treat `null` as described in the error table above.
2. Call `resolveAndValidatePath(base, requestedPath)` (or `resolveReadablePath` for
   read-only routes that also serve `~/.claude/` files) before any I/O.
3. Treat a `null` return from the resolver as 403 "Path outside project".
4. Never pass a raw user-supplied string directly as `basePath`.
5. Never construct file paths with string interpolation — use `path.resolve` /
   `path.join` and always re-validate the result.

---

## Absolute-flavor exceptions

Two endpoints intentionally operate on caller-supplied absolute paths:

- **`GET /api/filesystem/browse`** — directory picker; validates the supplied
  absolute path with `resolveAndValidatePath` against a safe root, not the project
  base.
- **`GET /api/files/external`** — reads files outside the project tree (e.g. agent
  outputs in a spool directory); path is validated against a separate allowed prefix.

Do not add new absolute-flavor endpoints without an explicit ADR justifying the
exception.

---

## Implementation files

| File | Role |
|------|------|
| `packages/core/src/server/routes/types.ts` | `getEffectivePath` — canonical route-level resolver |
| `packages/core/src/server/routes/path-utils.ts` | `resolveAndValidatePath`, `resolveReadablePath` — containment checks |
| `packages/core/src/chat/chat-manager.ts` | `ChatManager.getEffectivePath` — chat-only routes (no project URL param) |
