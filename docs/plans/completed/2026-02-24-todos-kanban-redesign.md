# Todos Kanban Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign `TodoCard` and `TodosPanel` to use the app background as column dividers and restructure the card layout to surface the task number, priority pill, and icon-only actions naturally.

**Architecture:** Pure UI change across two files. No logic, state, or API changes. The `data-testid="todo-card"` attribute on the card root must be preserved (referenced by tests).

**Tech Stack:** React, Tailwind CSS, Lucide icons

---

### Task 1: Update column separators in TodosPanel

**Files:**
- Modify: `packages/desktop/src/renderer/components/todos/TodosPanel.tsx:179-214`

**Step 1: Change the columns flex container**

In `TodosPanel.tsx`, find the columns container at line ~179:

```tsx
<div className="flex-1 flex gap-0 overflow-hidden">
```

Change to:

```tsx
<div className="flex-1 flex gap-px overflow-hidden">
```

**Step 2: Remove `border-r` from column divs**

Each column div (line ~183) currently has:

```tsx
className="flex-1 flex flex-col border-r border-mf-border last:border-r-0 overflow-hidden"
```

Change to:

```tsx
className="flex-1 flex flex-col overflow-hidden"
```

**Step 3: Verify in the app**

Run the desktop app and confirm the three columns are separated by a thin gap showing the app background instead of a border line.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/TodosPanel.tsx
git commit -m "fix(todos): use gap instead of border for column separators"
```

---

### Task 2: Redesign TodoCard layout

**Files:**
- Modify: `packages/desktop/src/renderer/components/todos/TodoCard.tsx`

**Step 1: Update the priority color map to use pills**

Replace the current `PRIORITY_COLORS` record (which is text-only):

```tsx
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-mf-text-secondary',
};
```

With a pill map (background + text):

```tsx
const PRIORITY_PILL: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-gray-500/10 text-mf-text-secondary',
};
```

**Step 2: Rewrite the card JSX**

Replace the full `return` block with the new three-row layout. Keep `data-testid="todo-card"`, `draggable`, `onDragStart`, and `onClick` on the root unchanged.

```tsx
return (
  <div
    data-testid="todo-card"
    draggable
    onDragStart={(e) => e.dataTransfer.setData('todo-id', todo.id)}
    onClick={() => onEdit(todo)}
    className="bg-mf-app-bg rounded-mf-input p-3 space-y-1.5 border border-mf-border group cursor-pointer"
  >
    {/* Row 1: type badge + #number + title */}
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={cn(
          'shrink-0 text-mf-status font-medium px-1.5 py-0.5 rounded capitalize',
          TYPE_COLORS[todo.type] ?? 'bg-mf-hover text-mf-text-secondary',
        )}
      >
        {todo.type.replace('_', ' ')}
      </span>
      <span className="shrink-0 font-mono text-mf-status text-mf-text-secondary">#{todo.number}</span>
      <span className="text-mf-small text-mf-text-primary leading-snug truncate">{todo.title}</span>
    </div>

    {/* Row 2: priority pill */}
    <div>
      <span
        className={cn(
          'inline-block text-mf-status font-medium px-1.5 py-0.5 rounded capitalize',
          PRIORITY_PILL[todo.priority] ?? 'bg-gray-500/10 text-mf-text-secondary',
        )}
      >
        {todo.priority}
      </span>
    </div>

    {/* Row 3: labels + actions on hover */}
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1 min-w-0">
        {todo.labels.map((l) => (
          <span key={l} className="text-mf-status bg-mf-hover px-1.5 py-0.5 rounded text-mf-text-secondary">
            {l}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {(todo.status === 'open' || todo.status === 'in_progress') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartSession(todo);
            }}
            className="p-1 rounded text-mf-accent hover:bg-mf-accent/10 transition-colors"
            title="Start session"
            aria-label="Start in new session"
          >
            <Play size={12} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(todo);
          }}
          className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
          title="Edit"
          aria-label="Edit task"
        >
          <Edit size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(todo.id);
          }}
          className="p-1 rounded text-mf-text-secondary hover:text-mf-destructive hover:bg-mf-hover transition-colors"
          title="Delete"
          aria-label="Delete task"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  </div>
);
```

**Step 3: Remove the unused `PRIORITY_COLORS` reference**

After the rewrite, `PRIORITY_COLORS` is deleted (replaced by `PRIORITY_PILL`). Verify no other code in the file references it.

**Step 4: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 5: Verify in the app**

Open the todos panel. Confirm:
- Row 1: `[bug] #42 Title text` — type badge, number, title all inline
- Row 2: Priority shown as a colored pill (not plain text)
- Row 3: Labels on left; on hover, ▶ (accent), ✏, 🗑 appear on right
- Play icon only appears for `open` / `in_progress` cards

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/TodoCard.tsx
git commit -m "feat(todos): redesign kanban card layout with inline number, priority pill, icon-only actions"
```
