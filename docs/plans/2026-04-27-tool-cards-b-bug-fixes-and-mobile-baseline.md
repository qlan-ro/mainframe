# Tool Cards Plan B — Bug Fixes & Mobile Baseline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four broken behaviors on mobile (`task_group` field bugs, "Thinking..." pill, missing assistant images) and create the mobile equivalent of `CollapsibleToolCard` that the rest of the unified-design work in Plan C and Plan D will build on.

**Architecture:** Mobile lives at `packages/mobile/` in the **main mainframe checkout** (NOT in this worktree). All mobile work happens there. Build a React Native `CollapsibleToolCard` mirroring the desktop contract: `header`, `trailing`, `subHeader` (always visible), `children` (open only), `hideToggle`, `defaultOpen`, `disabled`, `variant`. Use `Pressable` for the header click target.

**Tech Stack:** React Native (Expo), TypeScript, NativeWind (Tailwind for RN), `lucide-react-native`, vitest (if mobile uses it; else jest-expo).

**Spec reference:** `docs/plans/2026-04-06-tool-card-rendering-audit.md` — Known Bugs §6-9, sections #14 and #16.

**⚠️ Working directory note:** All mobile changes happen in `/Users/doruchiulan/Projects/qlan/mainframe/packages/mobile/` (main checkout). Open a separate worktree for that branch or work directly in `main`. Plan A (foundations) ships entirely from this `feat-tool-cards` worktree (core + desktop only) — they're independent.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/mobile/components/chat/AssistantMessage.tsx` | ContentBlock dispatch | Fix `task_group` to read `block.agentId` (not `agentType`) and `block.taskArgs?.description`. Remove `case 'thinking'` (fall through to default → null). Add `case 'image'`. |
| `packages/mobile/components/chat/tools/CollapsibleToolCard.tsx` | New shared component | Build the mobile equivalent of desktop's CollapsibleToolCard. |
| `packages/mobile/components/chat/tools/__tests__/CollapsibleToolCard.test.tsx` | Tests for the new component | TDD with the desktop test as the contract. |
| `packages/mobile/components/chat/tools/index.tsx` | ToolCardRouter | No change in this plan — Plans C/D will rewire individual cards to use the new CollapsibleToolCard. |

---

## Task 1: Fix `task_group` field-access bugs in mobile AssistantMessage

**Files:**
- Modify: `packages/mobile/components/chat/AssistantMessage.tsx`
- Test: `packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx` (create if missing)

**Context:** The current code reads `block.agentType` and `block.description`, but the `task_group` DisplayContent type (`packages/types/src/display.ts`) defines the fields as `agentId` and `taskArgs`. The current code silently renders `undefined`.

- [ ] **Step 1: Confirm the type shape**

```bash
grep -A 7 "task_group" packages/types/src/display.ts
```

Expected output (around line 31-37):

```ts
| { type: 'task_group'; agentId: string;
    taskArgs: Record<string, unknown>;
    calls: DisplayContent[];
    result?: ToolCallResult }
```

- [ ] **Step 2: Write the failing test**

If a test setup exists for mobile, add:

```tsx
// packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx
import { render, screen } from '@testing-library/react-native';
import { AssistantMessage } from '../AssistantMessage';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';

describe('AssistantMessage task_group rendering', () => {
  it('renders agentId and taskArgs.description', () => {
    const msg: DisplayMessage = {
      id: 'm1',
      chatId: 'c1',
      type: 'assistant',
      timestamp: new Date().toISOString(),
      content: [
        {
          type: 'task_group',
          agentId: 'general-purpose',
          taskArgs: { description: 'Fix the login bug', prompt: '...' },
          calls: [],
        },
      ],
    };
    render(<AssistantMessage message={msg} />);
    expect(screen.getByText('general-purpose')).toBeTruthy();
    expect(screen.getByText('Fix the login bug')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: FAIL — current code reads non-existent `agentType` and `description` fields.

- [ ] **Step 4: Fix the field access in AssistantMessage.tsx**

Find the `case 'task_group':` branch (around line 76 per the audit). Replace `block.agentType` with `block.agentId` and `block.description` with `(block.taskArgs?.description as string | undefined)`:

```tsx
case 'task_group': {
  const description = (block.taskArgs?.description as string | undefined) ?? '';
  return (
    <View key={i} className="...">
      <View className="flex-row items-center gap-2">
        <Bot size={14} color="#f97312" />
        <Text className="text-xs text-mf-accent">
          {block.agentId ?? 'general-purpose'}
        </Text>
      </View>
      {description ? (
        <Text className="text-xs text-mf-text-secondary/80">{description}</Text>
      ) : null}
      {/* ...existing children rendering... */}
    </View>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/AssistantMessage.tsx \
        packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx
git commit -m "fix(mobile): use correct task_group field names

Read block.agentId (not agentType) and block.taskArgs.description
(not block.description). Both old field names don't exist on the
DisplayContent type, so the previous code silently rendered undefined."
```

---

## Task 2: Remove the "Thinking..." pill from mobile

**Files:**
- Modify: `packages/mobile/components/chat/AssistantMessage.tsx`

**Context:** Desktop already hides thinking blocks. Per spec issue #31, mobile should too.

- [ ] **Step 1: Locate the thinking branch**

```bash
grep -n "thinking\|Thinking" packages/mobile/components/chat/AssistantMessage.tsx
```

You should find a `case 'thinking':` (around line 44 per the audit) that renders a Brain icon + "Thinking..." pill.

- [ ] **Step 2: Write the failing test**

```tsx
// Add to packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx
it('does NOT render thinking blocks', () => {
  const msg: DisplayMessage = {
    id: 'm1',
    chatId: 'c1',
    type: 'assistant',
    timestamp: new Date().toISOString(),
    content: [{ type: 'thinking', thinking: 'Some long internal monologue...' }],
  };
  const { queryByText } = render(<AssistantMessage message={msg} />);
  expect(queryByText(/Thinking/i)).toBeNull();
  expect(queryByText(/Some long internal monologue/)).toBeNull();
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: FAIL — "Thinking..." or full text renders.

- [ ] **Step 4: Remove the `case 'thinking':` branch**

Delete the entire branch from the ContentBlock switch. The default case will return `null`, hiding the block.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/AssistantMessage.tsx \
        packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx
git commit -m "fix(mobile): hide thinking blocks (parity with desktop, issue #31)"
```

---

## Task 3: Render images in mobile assistant messages

**Files:**
- Modify: `packages/mobile/components/chat/AssistantMessage.tsx`

**Context:** Desktop shipped this in PR #237 (commit `99ae306c`). Mobile's UserMessage already handles images. Reuse the same approach in AssistantMessage.

- [ ] **Step 1: Inspect mobile UserMessage image handling for the pattern**

```bash
grep -A 12 "type === 'image'" packages/mobile/components/chat/UserMessage.tsx
```

Note the lightbox flow: `Image` source `data:${mediaType};base64,${data}`, `onPress` opens `ImageLightbox`.

- [ ] **Step 2: Write the failing test**

```tsx
// packages/mobile/components/chat/__tests__/AssistantMessage.test.tsx
it('renders image content blocks in assistant messages', () => {
  const msg: DisplayMessage = {
    id: 'm1',
    chatId: 'c1',
    type: 'assistant',
    timestamp: new Date().toISOString(),
    content: [
      { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    ],
  };
  const { getByTestId } = render(<AssistantMessage message={msg} />);
  expect(getByTestId('assistant-image-thumb')).toBeTruthy();
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: FAIL — no case for `image` in assistant context.

- [ ] **Step 4: Add `case 'image':` to ContentBlock**

```tsx
case 'image': {
  const uri = `data:${block.mediaType};base64,${block.data}`;
  return (
    <Pressable
      key={i}
      testID="assistant-image-thumb"
      onPress={() => openLightbox?.([{ mediaType: block.mediaType, data: block.data }], 0)}
      className="rounded-mf-card overflow-hidden mt-2"
    >
      <Image
        source={{ uri }}
        style={{ width: 200, height: 200 }}
        resizeMode="cover"
      />
    </Pressable>
  );
}
```

(Pass `openLightbox` from props or from context — match how `UserMessage` receives it. If `AssistantMessage` doesn't currently take a lightbox handler, add it as a prop and thread through from `MessageList`.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- AssistantMessage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/AssistantMessage.tsx
git commit -m "feat(mobile): render image blocks in assistant messages

Mirrors desktop PR #237. Uses the same base64 URI + lightbox pattern
already in mobile UserMessage."
```

---

## Task 4: Build the mobile CollapsibleToolCard

**Files:**
- Create: `packages/mobile/components/chat/tools/CollapsibleToolCard.tsx`
- Create: `packages/mobile/components/chat/tools/__tests__/CollapsibleToolCard.test.tsx`

**Context:** This is the foundation for every chat-stream card in Plan C. Same prop contract as desktop's `CollapsibleToolCard` (Plan A Tasks 5-6) so card components can share logic structure across platforms.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/mobile/components/chat/tools/__tests__/CollapsibleToolCard.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CollapsibleToolCard } from '../CollapsibleToolCard';

describe('CollapsibleToolCard (mobile)', () => {
  it('renders header always; body only when open', () => {
    const { getByText, queryByText, getByTestId } = render(
      <CollapsibleToolCard header={<Text>HDR</Text>}>
        <Text>BODY</Text>
      </CollapsibleToolCard>,
    );
    expect(getByText('HDR')).toBeTruthy();
    expect(queryByText('BODY')).toBeNull();
    fireEvent.press(getByTestId('mf-tool-card-header'));
    expect(getByText('BODY')).toBeTruthy();
  });

  it('renders subHeader in both states', () => {
    const { getByText, getByTestId } = render(
      <CollapsibleToolCard
        header={<Text>HDR</Text>}
        subHeader={<Text>SUB</Text>}
      >
        <Text>BODY</Text>
      </CollapsibleToolCard>,
    );
    expect(getByText('SUB')).toBeTruthy();
    fireEvent.press(getByTestId('mf-tool-card-header'));
    expect(getByText('SUB')).toBeTruthy();
  });

  it('respects defaultOpen', () => {
    const { getByText } = render(
      <CollapsibleToolCard defaultOpen header={<Text>HDR</Text>}>
        <Text>BODY</Text>
      </CollapsibleToolCard>,
    );
    expect(getByText('BODY')).toBeTruthy();
  });

  it('disables press when disabled=true', () => {
    const { queryByText, getByTestId } = render(
      <CollapsibleToolCard disabled header={<Text>HDR</Text>}>
        <Text>BODY</Text>
      </CollapsibleToolCard>,
    );
    fireEvent.press(getByTestId('mf-tool-card-header'));
    expect(queryByText('BODY')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- CollapsibleToolCard
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create the component**

```tsx
// packages/mobile/components/chat/tools/CollapsibleToolCard.tsx
import { useState, type ReactNode } from 'react';
import { View, Pressable } from 'react-native';

interface CollapsibleToolCardProps {
  /** 'primary' for file/command cards, 'compact' for read/search/metadata cards */
  variant?: 'primary' | 'compact';
  /** Outer wrapper className — defaults to standard rounded card */
  wrapperClassName?: string;
  /** Disable toggling (e.g. PlanCard with no result) */
  disabled?: boolean;
  /** Start expanded */
  defaultOpen?: boolean;
  /** Hide the toggle visual hint. (No icon on mobile by default; this is a contract parity prop.) */
  hideToggle?: boolean;
  /** Header content (icon + text) */
  header: ReactNode;
  /** Trailing-slot content (status dot, badges, action buttons) */
  trailing?: ReactNode;
  /** Always-visible secondary line */
  subHeader?: ReactNode;
  /** Body shown only when expanded */
  children?: ReactNode;
}

export function CollapsibleToolCard({
  variant = 'primary',
  wrapperClassName,
  disabled,
  defaultOpen = false,
  header,
  trailing,
  subHeader,
  children,
}: CollapsibleToolCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isPrimary = variant === 'primary';

  return (
    <View
      className={
        wrapperClassName ??
        'rounded-mf-card overflow-hidden border'
      }
      style={{ borderColor: '#43454a', backgroundColor: '#11121466' }}
    >
      <Pressable
        testID="mf-tool-card-header"
        onPress={() => !disabled && setOpen((v) => !v)}
        className={`flex-row items-center gap-2 px-3 ${isPrimary ? 'py-2' : 'py-1'}`}
      >
        <View className="flex-row items-center gap-2 flex-1 min-w-0">
          {header}
        </View>
        {trailing}
      </Pressable>
      {subHeader ? <View className="px-3 pb-1">{subHeader}</View> : null}
      {open && children ? (
        <View>
          <View className="h-px" style={{ backgroundColor: '#393b40' }} />
          <View className="px-3 py-2">{children}</View>
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- CollapsibleToolCard
```

Expected: PASS (4/4).

- [ ] **Step 5: Add an error-border variant via wrapperClassName**

For consistency with desktop's `cardStyle(result, isError)`, document the convention in a comment at the top of the file:

```tsx
// Usage notes:
//   - Default border: #43454a (mf-border equivalent)
//   - Error: pass wrapperClassName="rounded-mf-card overflow-hidden border"
//     and override style={{ borderColor: 'rgb(from var(--mf-chat-error) r g b / 0.3)' }}
//     OR use the helper in shared.ts (Plan C will introduce mobile shared.ts)
```

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/tools/CollapsibleToolCard.tsx \
        packages/mobile/components/chat/tools/__tests__/CollapsibleToolCard.test.tsx
git commit -m "feat(mobile): add CollapsibleToolCard matching desktop contract

Foundation for unified chat-stream cards (Plan C). Same prop shape as
desktop CollapsibleToolCard: header, trailing, subHeader (always
visible), children (open only), variant, defaultOpen, disabled."
```

---

## Task 5: Run typecheck + tests

- [ ] **Step 1: Mobile typecheck**

```bash
cd packages/mobile && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Mobile tests**

```bash
cd packages/mobile && pnpm test
```

Expected: all green.

---

## Task 6: Add a changeset

- [ ] **Step 1: Generate**

```bash
pnpm changeset
```

Select `@qlan-ro/mainframe-mobile` (or whatever the mobile package is named in `pnpm-workspace.yaml`). Bump: `patch` for the bug fixes; `minor` if the new `CollapsibleToolCard` ships as part of the same release (since it's a new exported component). Choose `minor`.

Summary:

```
Mobile bug fixes: task_group field names corrected, thinking pill removed,
assistant images now render. New CollapsibleToolCard component matching
desktop contract — foundation for unified chat-stream cards.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for mobile bug fixes + CollapsibleToolCard"
```

---

## Self-Review

- ✅ **Spec coverage:** Known Bugs §6 (SlashCommandCard dormant) doesn't apply here — that's a documentation note, no code change. Bugs §1, §2 (task_group fields) → Task 1. Bug §4 (thinking) → Task 2. Bug §3 + #16 (image in assistant) → Task 3. Bug §8 (mobile SkillLoadedCard equivalent) → deferred to Plan D. Bug §9 (mobile TasksSection) → deferred (separate work, todo #133).
- ✅ **Placeholder scan:** all code blocks are concrete. The error-border note in Task 4 references Plan C's `shared.ts` — that's a forward reference, not a placeholder; the workaround (inline style override) is shown.
- ✅ **Type consistency:** `agentId`, `taskArgs.description`, `mediaType`, `data`, `category` all match `packages/types/src/display.ts`.
- ✅ **Independence:** entirely separate from Plan A. Can ship in parallel.
