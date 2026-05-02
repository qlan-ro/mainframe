# Tool Cards Plan E — Markdown Code Block (U13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop fenced-code-block headers visually integrate with the code body (drop the divider line + lighter header background) so they match mobile's pattern.

**Architecture:** Single-file CSS/className change to `CodeHeader.tsx`. No mobile change.

**Tech Stack:** React, Tailwind utility classes. Desktop only.

**Spec reference:** `docs/plans/2026-04-06-tool-card-rendering-audit.md` — section U13.

**Depends on:** Nothing. Independent of all other plans. ~5 minute implementation.

**⚠️ Working directory:** This `feat-tool-cards` worktree.

---

## File Structure

| File | Change |
|---|---|
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/CodeHeader.tsx` | Drop `bg-mf-hover/50` + `border-b border-mf-divider`. Header inherits the code block's `bg-mf-input-bg` for a single integrated surface. |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/__tests__/CodeHeader.test.tsx` | New: assert no border-b class and no bg-mf-hover class on the header. |

---

## Task 1: Drop the visual separation in CodeHeader

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/CodeHeader.tsx`
- Test: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/__tests__/CodeHeader.test.tsx`

- [ ] **Step 1: Read the current implementation**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/parts/CodeHeader.tsx
```

The relevant line (~19) is:

```tsx
<div className="group flex items-center justify-between px-3 py-1.5 bg-mf-hover/50 border-b border-mf-divider">
```

- [ ] **Step 2: Write the failing test**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/__tests__/CodeHeader.test.tsx
import { render } from '@testing-library/react';
import { CodeHeader } from '../CodeHeader';

describe('CodeHeader (U13)', () => {
  it('does not draw a divider line below the header', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1" />);
    const header = container.firstChild as HTMLElement;
    expect(header.className).not.toMatch(/border-b/);
  });

  it('does not use the lighter bg-mf-hover background', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1" />);
    const header = container.firstChild as HTMLElement;
    expect(header.className).not.toMatch(/bg-mf-hover/);
  });

  it('still renders language label and copy button', () => {
    const { getByText, getByRole } = render(<CodeHeader language="ts" code="const x = 1" />);
    expect(getByText('ts')).toBeTruthy();
    expect(getByRole('button')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test → FAIL**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CodeHeader
```

Expected: FAIL on the first two assertions (current code has both classes).

- [ ] **Step 4: Update CodeHeader.tsx**

Replace line 19 (the outer `div` className):

```tsx
// BEFORE:
<div className="group flex items-center justify-between px-3 py-1.5 bg-mf-hover/50 border-b border-mf-divider">

// AFTER:
<div className="group flex items-center justify-between px-3 py-1.5">
```

The header now inherits `bg-mf-input-bg` from the parent `.aui-md-pre` (defined in `index.css:258-265`). Card border + rounded corners stay on the parent — header and body share one visual surface.

- [ ] **Step 5: Run the test → PASS**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CodeHeader
```

Expected: PASS (3/3).

- [ ] **Step 6: Visually verify (optional)**

Build and run desktop, send any chat message containing a fenced code block. The "ts" label and the code body should now share the same dark background with no horizontal line between them. Card border + rounded corners stay on the outer `.aui-md-pre`.

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/CodeHeader.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/__tests__/CodeHeader.test.tsx
git commit -m "feat(desktop): U13 integrate code block header with body

Drop the bg-mf-hover/50 highlight and border-b divider. Header now
inherits bg-mf-input-bg from the outer .aui-md-pre, so the language
label and code share one visual surface — matches mobile's pattern."
```

---

## Task 2: Changeset

- [ ] **Step 1: Generate**

```bash
pnpm changeset
```

Select `@qlan-ro/mainframe-desktop`. Bump: `patch` (purely visual, no API change).

Summary:

```
Markdown code blocks: header (language label + Copy button) and code
body now share one visual surface. Drops the divider line and lighter
header background.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for U13 code block header integration"
```

---

## Self-Review

- ✅ **Spec coverage:** U13 implemented in one task.
- ✅ **Placeholder scan:** none.
- ✅ **Type consistency:** N/A (CSS classname change).
- ✅ **Scope:** purely visual; no behavior change. Copy button + language label both preserved.
