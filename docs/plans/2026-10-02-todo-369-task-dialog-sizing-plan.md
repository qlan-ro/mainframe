# Task dialog sizing plan

Implement todo #369's approved design from `.worktrees/.lane-state/todo-369-task-dialog-sizing/brief.md`, relative to the main checkout. Make the board editor, sidebar editor and resolved-project Quick Task resizable. Cap description growth at 16rem, reduced for the viewport, with internal scrolling and reachable actions. Preserve fields, task persistence, project selection and board resizing.

## Established facts

All paths below are relative to the worktree.

- `packages/ui/src/components/ui/dialog.tsx`, `DialogContent`, accepts `resizeKey?: string`. `components/ui/dialog-resize.tsx`, under the same `src` directory, implements `useDialogResize` and `DialogResizeGrabber`. It measures the opening dimensions as minimums, clamps against the viewport minus 32px, and persists on drag release. Minimums win if larger than the viewport; applied sizes remove CSS maximum width and height. There is no window-resize listener.
- `packages/ui/src/store/ui-prefs.ts`, `dialogSizeFor` and `setDialogSize`, use independent string keys in persisted `dialogSizes`. `packages/ui/src/features/tasks/TasksModalHost.tsx` already uses `tasks` for the resolved-project board.
- Under `packages/ui/src/features/tasks/`, `TaskEditModal.tsx` and `QuickTaskForm.tsx` already separate scrolling content from nonshrinking action rows. Neither description has a height cap. `sidebar/TaskEditModal.tsx` instead scrolls the whole dialog and caps its description with `max-h-64`.
- `QuickTaskDialog.tsx`, `QuickTaskDialog`, keeps one Dialog root while switching from `ProjectPickList` to `QuickTaskForm` when `projectId` resolves. Quick Task cancels through Escape or Close; it has no Cancel button.
- `packages/ui/src/components/ui/textarea.tsx`, `Textarea`, uses `field-sizing-content`. Keep the fix local to task forms. Existing `features/tasks/__tests__/TaskEditModal.test.tsx` covers the board editor, not the sidebar editor.

## Group 1: task dialogs and regression coverage

One UI owner implements and verifies this group. Dependencies are the approved brief, existing dialog preferences and a prepared worktree; no new package or API is needed.

Owned source paths, under `packages/ui/src/features/tasks/`: `TaskEditModal.tsx`, `sidebar/TaskEditModal.tsx`, `QuickTaskDialog.tsx`, `QuickTaskForm.tsx`. Add `__tests__/TaskDialogSizing.test.tsx` for focused coverage and a UI patch changeset under `.changeset/`.

- [ ] Assign distinct keys `tasks-board-edit`, `tasks-sidebar-edit` and `tasks-quick`. Enable the Quick Task key only when `projectId !== null`, without replacing its Dialog root. Keep the board's existing `tasks` key.
- [ ] Apply the same local description cap, `min(16rem, 40dvh)`, and explicit vertical overflow to all three descriptions. Preserve content sizing below the cap, editing and image paste behavior.
- [ ] Keep board and Quick Task headers/actions outside their existing scrolling bodies. Keep the sidebar's whole-dialog scrolling unless browser evidence requires a local layout adjustment. Check opening minimums and restored dimensions against short viewports; do not assume the initial CSS maximum survives a resize. Any required shared resize change needs a documented scope decision before implementation.
- [ ] Add behavioral regression coverage using the real Dialog: each editor opts in with an independent preference key; seeded sizes restore without affecting another dialog or the board; unresolved Quick Task offers the picker and selecting a project enables its grip. Verify a 100-line description remains intact after editing its last line and submitting. Keep these tests with the implementation; avoid CSS-class assertions as proof of layout.

## Exit criteria

Run focused new tests and existing board editor, Quick Task/project-scope, dialog-resize and UI-preferences suites, one file per invocation. UI typecheck, lint/format checks for changed files, the UI patch changeset, staged secret scan and normal commit hooks must pass. Keep changed files within repository size limits.

In the running app, exercise board create/edit, sidebar create/edit and Quick Task with at least 100 lines. At default dimensions and after growing then shrinking to the supported minimum, measure a description height no greater than the cap, confirm internal scrolling, edit the final line, save/create and reopen to verify content. Check Save/Create, editor Cancel, Escape and Close, including with attachments and a short viewport. Reopen after resizing to verify separate sizes; reopen at a smaller viewport and check action reachability. Confirm board resizing and unresolved-project selection still work. Record actual viewport sizes, outcomes and evidence in the lane checkpoint. DOM tests alone do not establish these layout results.
