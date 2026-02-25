# Remove Project — Design

**Date:** 2026-02-19

## Overview

Add the ability to remove a project from Mainframe. The backend infrastructure (DELETE route, cascade DB delete, API client, Zustand store action) already exists. Two gaps remain: the daemon does not clean up running processes on deletion, and the desktop has no UI to trigger the action.

## Daemon Changes

### Problem

`DELETE /api/projects/:id` currently calls `db.projects.removeWithChats(id)` directly. This deletes the project and chat rows from SQLite but leaves any running CLI processes alive as orphans. The `ChatManager.activeChats` map, message cache, permission manager, and attachment store all retain stale entries.

### Fix

Add `removeProject(projectId: string): Promise<void>` to `ChatManager`:

1. Query all chats for the project from the DB.
2. For each chat that has an active entry in `activeChats`:
   - Kill the CLI process via `adapter.kill()`.
   - Remove from `processToChat`.
   - Clear messages, permissions, and attachments.
   - Remove any git worktree if present.
   - Delete the `activeChats` entry.
3. Call `db.projects.removeWithChats(projectId)` to atomically delete all chat rows and the project row in a transaction.

Update the DELETE route to call `ctx.chats.removeProject(id)` instead of `ctx.db.projects.removeWithChats(id)`.

## Desktop Changes

### UI — Hover-Reveal Delete on ProjectRail

The `ProjectRail` shows a vertical strip of project initials buttons. When a user hovers a button, a small ✕ icon appears in the top-right corner. Clicking ✕ transitions the button into an inline confirmation state.

**State (local React):**

- `hoveringId: string | null` — which project the cursor is over
- `confirmingDeleteId: string | null` — which project is in "are you sure?" mode

**Normal hover:** when `hoveringId === project.id` and not confirming, show a small ✕ badge on the button.

**Confirm state (inline flip):** clicking ✕ sets `confirmingDeleteId`. The button content swaps to two small icon buttons:
- **✓ (confirm):** calls `removeProject(id)` API → on success, calls `store.removeProject(id)` to update local state and reset active project if needed. Resets both state vars.
- **✗ (cancel):** resets `confirmingDeleteId` to null.

Mouse leaving the button while in confirm state cancels automatically (resets both vars on `onMouseLeave`).

**Error handling:** if the API call fails, log the error and reset state — the project remains in the list.

## What Is Not Changed

- No new DB columns or migrations.
- No new event types emitted over WebSocket.
- Filesystem files are untouched; only the Mainframe metadata is removed.
- CLI session history files (managed by the adapter) are not deleted.
