# Review Panel

**Status:** Approved · **Date:** 2026-05-05

## Summary

The Review panel is a large modal interface for preparing pull requests within a chat session. It displays all changes since main (committed and uncommitted), enables file-level staging, supports inline code annotations, and facilitates commit + PR creation without leaving the chat context.

## Motivation

Today, users audit changes via in-app terminal or external git tools. This breaks the chat flow and lacks native integration with Mainframe's session model. The Review panel brings the critical pre-PR workflow into the chat, making code review, annotation, and PR creation native operations on the session.

## Scope

**In scope:**
- Display `git diff main` for all files (added, modified, deleted)
- File-level staging and unstaging
- Monaco diff editor with inline comment widgets (session-persisted)
- Commit message generation (with AI suggestion via `writing-clearly-and-concisely`)
- `git commit` and PR creation via `gh pr create`
- Support both worktree-isolated and main-project workflows
- Two diff view modes: inline and side-by-side

**Out of scope:**
- Hunk-level staging (file-level only)
- Merge conflict resolution (user handles manually)
- Multi-PR workflows (one PR per Review session)
- Stashing or branch switching
- History rewriting (rebase, squash on demand)

## Design

### UI Structure

The Review panel appears as a large, centered modal (85–90% of viewport) with visible frame and dimmed chat underneath, preserving the sense of modality rather than a page replace.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Chat thread (dimmed/blurred behind)                                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Review Panel                                  [X] Close    │    │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │    │
│  │                                                            │    │
│  │  Files (left)       │  Diff View (right)                 │    │
│  │  ─────────────────  │  [≣ Inline] [⇄ Split]             │    │
│  │                     │  ─────────────────────────        │    │
│  │  📄 src/index.ts    │                                   │    │
│  │  ☑️ (staged)        │ INLINE MODE:                      │    │
│  │  📄 README.md       │ @@ -10,5 +10,7 @@                │    │
│  │  ☐ (unstaged)      │ function foo() {                  │    │
│  │  ➕ new file.ts     │ -  return 1;                      │    │
│  │  ☐ (unstaged)      │ +  return 2; // updated          │    │
│  │                     │ }                                 │    │
│  │                     │ [inline comment widget]           │    │
│  │                     │                                   │    │
│  ├─────────────────────┴───────────────────────────────────┤    │
│  │ [Stage All] [Unstage All]  │  Commit Message Input      │    │
│  │                            │  [AI Suggest] [Commit]     │    │
│  │                            │  [Open PR]                 │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Left Pane: File Tree

- Hierarchical list of files from `git diff main --name-status`
- File badges: `📄` (modified), `➕` (added), `🗑` (deleted), `🔄` (renamed)
- Two sections: "Staged" (checked files) and "Unstaged" (unchecked files)
- Checkboxes for file-level staging toggles
- Click file to load its diff in the right pane

#### Right Pane: Diff View

- Monaco diff editor (read-only) showing `git diff main -- <file>`
- Two modes (toggle in toolbar):
  - **Inline:** Changes shown with context lines, compact layout (default)
  - **Side-by-side:** Main branch (left) vs. worktree (right), wider viewport
- Supports Monaco inline comment widgets for session-persisted annotations
- Mode preference saved to localStorage

#### Bottom Action Bar

- **[Stage All] / [Unstage All]** buttons to toggle all files at once
- **Commit Message Input** field (auto-filled with AI suggestion)
- **[AI Suggest]** button to regenerate message from changed files
- **[Commit]** button to stage and create commit
- **[Open PR]** button to push and create PR via `gh pr create`

#### Warning Banner

If no worktree and reviewing main project directory:
```
⚠️  Changes are not isolated to this chat. Review includes all uncommitted work in the project.
```

### Workflow

```
User opens Review panel
       ↓
Load git diff main, populate file tree
       ↓
User selects file → load diff in editor
       ↓
User stages/unstages files (checkboxes)
       ↓
User adds inline comments (Monaco widgets) → stored in session
       ↓
User enters commit message (or clicks [AI Suggest])
       ↓
[Commit] → git add <staged-files> && git commit -m "..."
       ↓
[Open PR] → git push && gh pr create --base main --head <branch>
       ↓
Modal closes, PR URL shown in chat
```

**Inline Comments:**
- Comments are stored in `chat.reviewComments` (session-level)
- Format: `{ fileId, line, content, authorId, timestamp }`
- Persisted when session ends or modal explicitly saved
- Survives modal close/reopen (not lost if user edits content and reopens)

### Worktree Support

**Scenario A: Chat with worktree (preferred)**
- Review shows `git diff main` within isolated worktree branch
- Changes scoped to this chat only
- PR created on worktree branch (reuses existing branch if PR exists)
- No warning banner

**Scenario B: Chat without worktree (main project)**
- Review shows `git diff main` in project root directory
- Show warning banner (changes not isolated to this chat)
- User can still stage, commit, and create PR
- Useful for simpler workflows where isolation isn't required

### Staging & Commits

- **File-level only:** No hunk-level staging (simpler implementation, covers 90% of use cases)
- **Preserve existing commits:** If worktree already has commits, they stay; new commits added on top
- **Single new commit:** Unstaged changes get one new commit on top of any existing worktree commits
- **Commit message:** Pre-filled via AI suggestion from `writing-clearly-and-concisely` patterns

### PR Creation

- **Branch reuse:** Push to existing worktree branch (idempotent)
- **Idempotent PR:** If PR already exists for this branch, update the existing PR (via `gh pr create` re-run or detection logic)
- **PR source tracking:** Detected as `source: 'created'` in existing PR detection system

### Diff View Modes

**Inline Mode (default):**
- Changes shown with context lines
- Compact vertical layout
- Good for sequential reading

**Side-by-Side Mode:**
- Main branch (left) vs. worktree (right)
- Wider viewport, easier to scan visual differences
- Better for large changes
- Toggle via `[≣ Inline] [⇄ Split]` buttons

Both modes support Monaco features: syntax highlighting, line numbers, minimap, inline comments.

**Mode persistence:** User preference saved to localStorage per session/user.

## Integration

### API Endpoints

New or extended endpoints in `packages/core/src/server/routes/git.ts`:

```typescript
POST /api/git/diff
  body: { chatId, files?: string[] }
  returns: { diffs: Record<string, { main: string; worktree: string }> }

POST /api/git/status
  body: { chatId }
  returns: { staged: string[]; unstaged: string[]; untracked: string[] }

POST /api/git/stage
  body: { chatId, files: string[] }
  returns: { success: boolean; error?: string }

POST /api/git/commit
  body: { chatId, message: string, files: string[] }
  returns: { hash: string; error?: string }

POST /api/git/push
  body: { chatId }
  returns: { success: boolean; error?: string }
```

All endpoints operate on `chat.worktreePath` (if set) or `project.path` (if no worktree). Path resolution via existing `resolveAndValidatePath()` helper.

### Existing Systems

| System | Integration |
|--------|-------------|
| **Worktree system** | Uses `chat.worktreePath` or `project.path` |
| **DiffViewer** | Reuses Monaco diff editor + comment widget infrastructure |
| **Chat session** | Stores review comments in `chat.reviewComments` |
| **PR detection** | Existing `detectPr` hook fires on `gh pr create` success |
| **Desktop UI** | New modal component, triggered via button or keyboard shortcut |

### Component Structure

```
packages/desktop/src/renderer/components/
├── modals/
│   └── ReviewPanel.tsx
│       ├── ReviewPanelHeader.tsx
│       ├── FileTree.tsx
│       ├── DiffView.tsx (reuses Monaco editor)
│       └── ActionBar.tsx
└── ... (existing)
```

**State management:** Zustand store or component state (TBD based on complexity).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No worktree, project dirty | Allow Review to proceed; show warning banner |
| `git diff` fails (repo error) | Toast error; show retry button |
| Diff too large (>50k lines) | Show warning; offer file filtering |
| File deleted in worktree | Show in tree with 🗑 badge; diff shows full deletion |
| Commit fails (conflicts detected) | Modal error dialog; user resolves manually |
| Push fails (auth, network, branch deleted) | Error dialog; suggest manual `git push` |
| PR creation fails (`gh pr create` error) | Error dialog; suggest manual `gh pr create` |
| Comment widget error | Graceful fallback; diff still readable |
| Modal closed with changes | Confirm dialog: "Discard changes?" |

## Data Model

### Review Modal State

```typescript
type ReviewPanelState = {
  isOpen: boolean;
  selectedFile: string | null;
  stagedFiles: Set<string>;
  diffMode: 'inline' | 'split';
  commitMessage: string;
  loading: boolean;
  error: string | null;
};
```

### Chat Session Extension

```typescript
chat.reviewComments?: {
  [fileId: string]: Array<{
    line: number;
    content: string;
    authorId: string;
    timestamp: number;
  }>;
};
```

### Persistence

- **Diff mode preference:** Browser localStorage
- **Review comments:** Attached to chat session, persisted to DB on session end
- **Staged files:** Live only in modal memory, lost on close (not persisted)

## Testing Strategy

- Unit tests for git command wrappers (diff, status, stage, commit, push)
- Component tests for FileTree, DiffView, ActionBar (props, interactions)
- Integration tests: full flow (open → stage → commit → PR create)
- E2E tests: Review panel in actual Electron app with real git repo
- Error cases: network failures, repo corruption, auth errors

## Open Questions

None. Design is complete and approved.

## Related Issues

- #35 Review Panel (this feature)
- Existing: Worktree support, DiffViewer, PR detection system
