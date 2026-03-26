# Unified Session View

Remove the project selector. Show all sessions across all projects in a single grouped sidebar. Derive the active project from the selected session.

## Motivation

Working on multiple projects simultaneously requires constant project switching via the dropdown selector. This friction compounds when using git worktrees, which today are registered as entirely separate projects — losing access to the parent project's launch configurations, skills, and sandbox context.

## Design

### Data Model

**`projects` table** — add one column:

```sql
ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id);
```

- Regular projects: `parent_project_id = NULL`.
- Worktree projects: `parent_project_id` points to the main repo's project ID.

**`chats` table** — unchanged. Each chat retains its `project_id` FK.

### Worktree Detection

On project registration (`POST /api/projects`):

1. Run `git worktree list --porcelain` on every existing project.
2. If the new project's path appears as a worktree entry of an existing project, set `parent_project_id` on the new project.
3. If the new project has worktrees whose paths match already-registered projects, backfill `parent_project_id` on those existing projects.

This uses the stable porcelain format and avoids parsing `.git` internals.

### API Changes

**New endpoint:** `GET /api/chats`
- Returns all non-archived chats across all projects, sorted by `updatedAt DESC`.
- Replaces `GET /api/projects/:projectId/chats` as the primary fetch on app init.

**Modified:** `GET /api/projects`
- Include `parentProjectId` in the response payload.

**Modified:** `POST /api/projects`
- Run worktree detection (both directions) after registration.
- Return the project with `parentProjectId` populated.

**Modified:** `DELETE /api/projects/:id`
- If deleting a parent project, clear `parent_project_id` on its worktree children (do not cascade-delete them).

**Retained:** `GET /api/projects/:projectId/chats` stays available but is no longer called by the desktop app on startup.

### UI Changes

**Remove project selector** from `TitleBar`. The title bar shows the active project's name (derived from the selected session). When no session is selected, it shows the app name ("Mainframe").

**Unified ChatsPanel:**
- Fetches all projects and chats on mount via `GET /api/projects` + `GET /api/chats`.
- Renders collapsible project groups, sorted by most recent session activity within each group.
- Each group header: project name, session count, collapse/expand toggle.
- Sessions within each group sorted by `updatedAt` descending.
- Collapse/expand state persisted to `localStorage` key `mf:collapsedProjects`.

**Worktree groups:**
- Appear as independent groups in the sidebar (not nested under parent).
- Visual indicator linking to parent (e.g., subtitle `↳ branch of <parent-name>`).
- Sorted by their own recency among other groups.

**Add Project button:**
- Positioned at the top or bottom of the sessions panel.
- Opens the existing `DirectoryPickerModal`.

### State Management

**`useProjectsStore`:**
- Remove `activeProjectId` from the store (no longer user-set).
- Store continues to hold `projects: Project[]`.

**`useChatsStore`:**
- Holds all non-archived chats across all projects (no per-project filtering).

**Derived active project:**
- `useActiveProjectId()` hook computes `activeProjectId` from `activeChatId` by looking up `chat.projectId`.
- When no session is selected, returns `null`.

**`useTabsStore`:**
- Remove `switchProject()` save/restore logic and `ProjectTabSnapshot` per-project persistence.
- All tabs coexist in a single unified list. Each tab's `chatId` ties it to a project implicitly.

**`useProject` hook:**
- Reacts to the derived `activeProjectId` changing (when selecting a session from a different project).
- Loads project-specific context: skills, agents, launch configs, sandbox.
- No longer clears/re-fetches chats on project change.

**WebSocket event routing (`ws-event-router.ts`):**
- Remove `activeProjectId` filtering.
- Accept `chat.created`, `chat.updated`, and other events for all projects.

### Migration

**Database:**
- Add `parent_project_id` column to `projects` (nullable FK).
- On first startup post-migration, run `git worktree list --porcelain` on all existing projects to backfill worktree relationships.

**localStorage:**
- Remove `mf:activeProjectId`.
- Remove `mf:projectTabs` (per-project tab snapshots).
- Add `mf:collapsedProjects` (set of collapsed project IDs).

### Scope Summary

| Area | Change |
|------|--------|
| Data model | One new column on `projects` |
| API | One new endpoint, three modified endpoints |
| UI | Remove project selector, unified grouped sessions panel, add-project button |
| State | Derive `activeProjectId`, remove per-project tab snapshots, unfilter WS events |
| Migration | Backfill worktree relationships, clean up localStorage |
