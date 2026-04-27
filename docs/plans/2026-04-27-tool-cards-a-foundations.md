# Tool Cards Plan A — Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daemon becomes the single source of truth for hidden tools; desktop's `CollapsibleToolCard` gains the props it needs to support every unified card design (trailing-slot status dot, no-toggle-icon mode, always-visible subHeader).

**Architecture:** Two changes, both small but foundational.
1. Reconcile and lock down the Claude adapter's `getToolCategories().hidden` Set, then teach desktop to consume `toolCall.category === 'hidden'` (mobile already does). Drop the two hardcoded HIDDEN lists in desktop.
2. Extend `CollapsibleToolCard` with `hideToggle` (drop the Maximize2/Minimize2 icon) and `subHeader` rendered in BOTH open and closed states, plus the convention of using `trailing` for the status dot.

**Tech Stack:** TypeScript, React, Vitest, pnpm workspaces. Daemon is `@qlan-ro/mainframe-core`, renderer is `@qlan-ro/mainframe-desktop`.

**Spec reference:** `docs/plans/2026-04-06-tool-card-rendering-audit.md` — `## Hidden Tools` section, plus shared design principles.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/plugins/builtin/claude/adapter.ts` | Claude adapter declares tool categories | Add `TaskCreate`, `TaskUpdate` to `hidden`. Remove `Skill` from `hidden` (skill activation now flows through `SkillLoadedCard` system message; the rare model-driven `Skill` tool_use should render via `SlashCommandCard` fallback). |
| `packages/core/src/__tests__/plugins/builtin/claude/adapter.test.ts` | Adapter tests | Add test for the hidden Set contents. |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx` | Registers per-tool UIs with assistant-ui | Drop the `HIDDEN_TOOLS` array + `HiddenToolUIs` registrations entirely. |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx` | Tool dispatch helper | Drop the `HIDDEN_TOOL_NAMES` Set. Replace with a `category === 'hidden'` short-circuit in callers. |
| `packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts` | DisplayContent → assistant-ui ThreadMessageLike | Filter out `tool_call` blocks where `category === 'hidden'` before they reach the registry. |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx` | Base collapsible container | Add `hideToggle?: boolean` prop. Render `subHeader` in BOTH open and closed states (currently only when collapsed). |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx` | New test file | Cover `hideToggle` and always-visible `subHeader`. |

---

## Task 1: Update the Claude adapter's hidden Set

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/adapter.ts:159-176`
- Test: `packages/core/src/__tests__/plugins/builtin/claude/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Find the existing adapter test (or create one) and add:

```ts
// packages/core/src/__tests__/plugins/builtin/claude/adapter.test.ts
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../../plugins/builtin/claude/adapter.js';

describe('ClaudeAdapter.getToolCategories', () => {
  it('hides all internal/dormant tools per the rendering audit', () => {
    const adapter = new ClaudeAdapter();
    const cats = adapter.getToolCategories();
    const hidden = cats.hidden;

    // V1 task tools
    expect(hidden.has('TodoWrite')).toBe(true);
    // V2 task tools (added — _TaskProgress fires on these)
    expect(hidden.has('TaskCreate')).toBe(true);
    expect(hidden.has('TaskUpdate')).toBe(true);
    expect(hidden.has('TaskList')).toBe(true);
    expect(hidden.has('TaskGet')).toBe(true);
    expect(hidden.has('TaskOutput')).toBe(true);
    expect(hidden.has('TaskStop')).toBe(true);
    // Mode/internal
    expect(hidden.has('EnterPlanMode')).toBe(true);
    expect(hidden.has('AskUserQuestion')).toBe(true); // pending state goes to BottomCard
    expect(hidden.has('ToolSearch')).toBe(true);

    // Skill is NOT hidden — model-driven Skill tool_use renders via SlashCommandCard
    // (skill activation flows through SkillLoadedCard system message instead)
    expect(hidden.has('Skill')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- adapter.test.ts
```

Expected: FAIL — `Skill` is currently in the hidden set; `TaskCreate`/`TaskUpdate` are not.

- [ ] **Step 3: Update the adapter**

```ts
// packages/core/src/plugins/builtin/claude/adapter.ts (replace lines 159-176)
getToolCategories(): ToolCategories {
  return {
    explore: new Set(['Read', 'Glob', 'Grep', 'LS']),
    hidden: new Set([
      // TodoV1
      'TodoWrite',
      // TodoV2 (gated by isTodoV2Enabled() in the CLI; emitted as _TaskProgress)
      'TaskCreate',
      'TaskUpdate',
      'TaskList',
      'TaskGet',
      'TaskOutput',
      'TaskStop',
      // Mode/internal
      'EnterPlanMode',
      'AskUserQuestion', // pending state surfaces via BottomCard
      'ToolSearch',
    ]),
    progress: new Set(['TaskCreate', 'TaskUpdate']),
    subagent: new Set(['Task', 'Agent']),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full core test suite (catch regressions)**

```bash
pnpm --filter @qlan-ro/mainframe-core test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/adapter.ts \
        packages/core/src/__tests__/plugins/builtin/claude/adapter.test.ts
git commit -m "feat(core): align Claude adapter hidden tools with rendering audit

Add TodoV2 task tools (TaskCreate/TaskUpdate/TaskList/TaskGet/TaskOutput/
TaskStop) to hidden. Remove Skill — model-driven Skill tool_use renders
via SlashCommandCard fallback; skill activation already flows through
SkillLoadedCard system message.

Daemon is now the single source of truth for which tools render in chat."
```

---

## Task 2: Filter hidden tool calls in the desktop convert pipeline

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts`
- Test: `packages/desktop/src/renderer/components/chat/assistant-ui/__tests__/convert-message.test.ts`

- [ ] **Step 1: Read the current convert-message implementation**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts | head -120
```

Note where the `assistant` case loops over `message.content` and emits `tool-call` parts. The filter goes right before that emission.

- [ ] **Step 2: Write the failing test**

Add to the existing convert-message tests (or create the file):

```ts
// packages/desktop/src/renderer/components/chat/assistant-ui/__tests__/convert-message.test.ts
import { describe, it, expect } from 'vitest';
import { convertMessage } from '../convert-message';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';

describe('convertMessage filters hidden tool calls', () => {
  it('omits tool_call blocks with category === hidden', () => {
    const msg: DisplayMessage = {
      id: 'm1',
      chatId: 'c1',
      type: 'assistant',
      timestamp: new Date().toISOString(),
      content: [
        { type: 'text', text: 'hi' },
        {
          type: 'tool_call',
          id: 't1',
          name: 'TodoWrite',
          input: {},
          category: 'hidden',
        },
        {
          type: 'tool_call',
          id: 't2',
          name: 'Bash',
          input: { command: 'ls' },
          category: 'default',
        },
      ],
    };

    const converted = convertMessage(msg);
    const parts = (converted.content as Array<{ type: string; toolName?: string }>);
    const toolNames = parts.filter((p) => p.type === 'tool-call').map((p) => p.toolName);
    expect(toolNames).toEqual(['Bash']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- convert-message
```

Expected: FAIL — `TodoWrite` still appears.

- [ ] **Step 4: Add the filter in convert-message.ts**

In the `assistant` case, before mapping content to parts, filter out hidden tool_call blocks:

```ts
// In the assistant case of convertMessage (find the existing content loop):
const visibleContent = message.content.filter((c) => {
  if (c.type !== 'tool_call') return true;
  return c.category !== 'hidden';
});
// ... use visibleContent instead of message.content for the tool_call mapping
```

(Match the surrounding style — preserve existing logic for text, thinking, image, tool_group, task_group, etc.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- convert-message
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts \
        packages/desktop/src/renderer/components/chat/assistant-ui/__tests__/convert-message.test.ts
git commit -m "feat(desktop): filter hidden tool calls via daemon category

convert-message now drops tool_call blocks where category === 'hidden'
before they reach the assistant-ui registry. Source of truth: daemon
adapter.getToolCategories().hidden."
```

---

## Task 3: Drop hardcoded HIDDEN_TOOLS from desktop registry

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx`

- [ ] **Step 1: Remove the hardcoded HIDDEN_TOOLS array and HiddenToolUIs export**

In `tool-ui-registry.tsx`, delete lines 84-101:

```ts
// REMOVE this block entirely:
const HIDDEN_TOOLS = [
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'EnterPlanMode',
  'ToolSearch',
] as const;
export const HiddenToolUIs = HIDDEN_TOOLS.map((toolName) =>
  makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: () => null,
  }),
);
```

Then remove `HiddenToolUIs` from any export aggregator (e.g. `AllToolUIs` array or wherever it's spread into the runtime).

- [ ] **Step 2: Find and update consumers**

```bash
grep -rn "HiddenToolUIs" packages/desktop/src
```

Remove every reference. Likely just one spread in `AllToolUIs`.

- [ ] **Step 3: Verify build still passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop typecheck
pnpm --filter @qlan-ro/mainframe-desktop build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx
git commit -m "refactor(desktop): drop hardcoded HIDDEN_TOOLS from tool-ui-registry

Hidden tools are now filtered upstream in convert-message via daemon
category. Removes duplicate source of truth."
```

---

## Task 4: Drop HIDDEN_TOOL_NAMES from render-tool-card.tsx

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx`

- [ ] **Step 1: Inspect the current render-tool-card**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx | head -40
```

Note the `HIDDEN_TOOL_NAMES` Set and the early `if (HIDDEN_TOOL_NAMES.has(toolName)) return null;` short-circuit.

- [ ] **Step 2: Remove the HIDDEN_TOOL_NAMES Set and the short-circuit**

Delete the Set declaration and the `if (HIDDEN_TOOL_NAMES.has(...))` block. Hidden tools never reach this function now (filtered in convert-message).

- [ ] **Step 3: Verify TaskGroupCard still works**

`TaskGroupCard` calls `renderToolCard` recursively to render its children. None of those children should ever be hidden (subagents only call non-hidden tools), but verify by reading `TaskGroupCard.tsx` and confirming no hidden tools are passed in.

```bash
grep -n "renderToolCard" packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx
```

If a hidden tool somehow reaches it, add `if (category === 'hidden') return null;` as a defensive guard at the top — but only if the data structure surfaces category here (check the call site).

- [ ] **Step 4: Run desktop tests**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx
git commit -m "refactor(desktop): drop HIDDEN_TOOL_NAMES from render-tool-card

Single source of truth for hidden tools is now the daemon adapter's
getToolCategories().hidden, applied in convert-message."
```

---

## Task 5: Add `hideToggle` prop to CollapsibleToolCard

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx`
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollapsibleToolCard } from '../CollapsibleToolCard';

describe('CollapsibleToolCard', () => {
  it('renders the toggle icon by default', () => {
    render(
      <CollapsibleToolCard header={<span>hdr</span>}>
        <div>body</div>
      </CollapsibleToolCard>,
    );
    // The toggle icon (Maximize2 / Minimize2) is a lucide svg — assert by role
    expect(screen.getByRole('button')).toBeInTheDocument();
    // Maximize2 svg should be present (icon library renders an svg)
    expect(document.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeTruthy();
  });

  it('hides the toggle icon when hideToggle=true', () => {
    render(
      <CollapsibleToolCard header={<span>hdr</span>} hideToggle>
        <div>body</div>
      </CollapsibleToolCard>,
    );
    expect(document.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
    expect(document.querySelector('svg.lucide-minimize-2, svg[class*="minimize"]')).toBeNull();
    // Header row is still clickable
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CollapsibleToolCard
```

Expected: FAIL — `hideToggle` prop doesn't exist.

- [ ] **Step 3: Add the `hideToggle` prop**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx
// Add to interface:
interface CollapsibleToolCardProps {
  variant?: 'primary' | 'compact';
  wrapperClassName?: string;
  disabled?: boolean;
  defaultOpen?: boolean;
  /** Hide the Maximize2/Minimize2 icon. Whole header row stays clickable. */
  hideToggle?: boolean;
  statusDot?: React.ReactNode;
  header: React.ReactNode;
  trailing?: React.ReactNode;
  subHeader?: React.ReactNode;
  children?: React.ReactNode;
}

// In the component, gate the toggle render on both !disabled and !hideToggle:
{!disabled && !hideToggle && (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="shrink-0" tabIndex={0}>
        {open ? (
          <Minimize2 size={14} className="..." />
        ) : (
          <Maximize2 size={14} className="..." />
        )}
      </span>
    </TooltipTrigger>
    <TooltipContent side="left">{open ? 'Collapse' : 'Expand'}</TooltipContent>
  </Tooltip>
)}
```

(Destructure `hideToggle` in the props.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CollapsibleToolCard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx
git commit -m "feat(desktop): add hideToggle prop to CollapsibleToolCard

Per the unified design: most cards drop the Maximize2/Minimize2 icon
since the whole header row is already the click target. hideToggle
makes the icon optional without changing click behavior."
```

---

## Task 6: Make `subHeader` render in BOTH open and closed states

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the existing test file:

```tsx
it('renders subHeader when collapsed AND when expanded', () => {
  const { rerender } = render(
    <CollapsibleToolCard
      header={<span>hdr</span>}
      subHeader={<span data-testid="sub">sub</span>}
    >
      <div>body</div>
    </CollapsibleToolCard>,
  );

  // Collapsed (default): subHeader visible
  expect(screen.getByTestId('sub')).toBeInTheDocument();

  // Programmatically open it (use defaultOpen variant)
  rerender(
    <CollapsibleToolCard
      defaultOpen
      header={<span>hdr</span>}
      subHeader={<span data-testid="sub">sub</span>}
    >
      <div>body</div>
    </CollapsibleToolCard>,
  );
  // Expanded: subHeader STILL visible (used to be hidden)
  expect(screen.getByTestId('sub')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CollapsibleToolCard
```

Expected: FAIL — subHeader is hidden when `open=true` in the current implementation (`{!open && subHeader}`).

- [ ] **Step 3: Update CollapsibleToolCard render**

Replace the conditional rendering:

```tsx
// BEFORE:
{!open && subHeader}
{open && children}

// AFTER:
{subHeader}
{open && children}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- CollapsibleToolCard
```

Expected: PASS.

- [ ] **Step 5: Visually confirm no existing card breaks**

Existing cards that use `subHeader` (only `BashCard` per current spec) currently rely on it being collapsed-only. After this change, BashCard's description will appear in BOTH states — which is the desired unified behavior (U1). No regression: it just appears in one more state.

Run the full desktop test suite to be sure:

```bash
pnpm --filter @qlan-ro/mainframe-desktop test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/CollapsibleToolCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/CollapsibleToolCard.test.tsx
git commit -m "feat(desktop): subHeader renders in both open and closed states

Per unified design: subHeader information (e.g. Bash description) should
be visible regardless of expansion state. Previously hidden when expanded."
```

---

## Task 7: Run typecheck + tests across the workspace

- [ ] **Step 1: Typecheck both packages**

```bash
pnpm --filter @qlan-ro/mainframe-core typecheck
pnpm --filter @qlan-ro/mainframe-desktop typecheck
```

Expected: PASS for both.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all green.

- [ ] **Step 3: Build desktop**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

Expected: build succeeds.

---

## Task 8: Add a changeset

- [ ] **Step 1: Generate a changeset**

```bash
pnpm changeset
```

Select both `@qlan-ro/mainframe-core` and `@qlan-ro/mainframe-desktop`. Bump type: `minor` (foundational refactor, internal API additions — no breaking external API).

Summary text:

```
Tool card foundations: daemon adapter is now single source of truth for
hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via
toolCall.category. CollapsibleToolCard gains hideToggle prop and renders
subHeader in both open and closed states.
```

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for tool card foundations"
```

---

## Self-Review

- ✅ **Spec coverage:** Hidden Tools section fully addressed (Tasks 1-4). CollapsibleToolCard changes (Tasks 5-6) cover the contract used by U1-U11.
- ✅ **Placeholder scan:** every code step shows actual code. Test cases use real assertions, not "TODO".
- ✅ **Type consistency:** `hideToggle?: boolean` named identically across Tasks 5 + interface. `category` accessed as `c.category` consistently with `DisplayContent` type at `packages/types/src/display.ts:23-27`.
- ✅ **Scope:** stays within "foundations" — no card-specific refactors leak in.
