# Tool Cards Plan D — Pill Family (U12, U14, U15, U16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the centered-pill family of cards: mobile port of `SkillLoadedCard` (desktop already shipped), new `WorktreeStatusPill` (U14), new `MCPToolCard` (U15), new `SchedulePill` (U16, covers `ScheduleWakeup` / `CronCreate` / `CronDelete` / `CronList` / `Monitor`).

**Architecture:** Shared visual language — centered, `rounded-full`, `bg-mf-hover/50`, no full-width row. Three of the four are new tools that currently fall through to `DefaultToolCard`. Shared mobile `Pill.tsx` primitive abstracts the centered rounded-full container so each pill component just configures icon + label + state.

**Tech Stack:** TypeScript, React, NativeWind, lucide-react / lucide-react-native.

**Spec reference:** `docs/plans/2026-04-06-tool-card-rendering-audit.md` — sections U12, U14, U15, U16, plus existing `SkillLoadedCard.tsx` as the desktop reference for the family.

**Depends on:** Plan B (mobile baseline) — though strictly only the mobile Markdown component for U12's expanded body.

**⚠️ Working directory:** Desktop work in this `feat-tool-cards` worktree; mobile work in `/Users/doruchiulan/Projects/qlan/mainframe/packages/mobile/` (main checkout).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/WorktreeStatusPill.tsx` | New: U14 desktop component |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/MCPToolCard.tsx` | New: U15 desktop component |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SchedulePill.tsx` | New: U16 desktop component |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx` | Register Worktree/Schedule/MCP UIs (latter two via wildcard / multi-name) |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx` | Add MCP wildcard branch (`startsWith('mcp__')`) and explicit branches for Worktree/Schedule tools |
| `packages/mobile/components/chat/tools/Pill.tsx` | New: shared centered-pill primitive |
| `packages/mobile/components/chat/tools/SkillLoadedCard.tsx` | New: U12 mobile port (replaces silent drop of `skill_loaded` system message) |
| `packages/mobile/components/chat/tools/WorktreeStatusPill.tsx` | New: U14 mobile component |
| `packages/mobile/components/chat/tools/MCPToolCard.tsx` | New: U15 mobile component |
| `packages/mobile/components/chat/tools/SchedulePill.tsx` | New: U16 mobile component |
| `packages/mobile/components/chat/tools/index.tsx` | Add cases for Worktree/Schedule + wildcard for `mcp__*` |
| `packages/mobile/components/chat/AssistantMessage.tsx` (or wherever system messages are routed) | Wire `meta.skillLoaded` to render `SkillLoadedCard` |

---

## Task 1: Mobile shared `Pill.tsx` primitive

**Files:**
- Create: `packages/mobile/components/chat/tools/Pill.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/Pill.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/mobile/components/chat/tools/__tests__/Pill.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Pill } from '../Pill';

describe('mobile Pill primitive', () => {
  it('renders centered pill content', () => {
    const { getByText } = render(<Pill><Text>HI</Text></Pill>);
    expect(getByText('HI')).toBeTruthy();
  });

  it('toggles expanded body on press when expandable', () => {
    const { getByTestId, queryByText, getByText } = render(
      <Pill body={<Text>BODY</Text>}>
        <Text>HEAD</Text>
      </Pill>,
    );
    expect(queryByText('BODY')).toBeNull();
    fireEvent.press(getByTestId('mf-pill'));
    expect(getByText('BODY')).toBeTruthy();
  });

  it('error variant does NOT toggle (no body) and renders red border', () => {
    const { getByTestId } = render(
      <Pill variant="error"><Text>FAIL</Text></Pill>,
    );
    expect(getByTestId('mf-pill-error-border')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test → FAIL**

```bash
cd packages/mobile && pnpm test -- Pill
```

- [ ] **Step 3: Create `Pill.tsx`**

```tsx
// packages/mobile/components/chat/tools/Pill.tsx
import { useState, type ReactNode } from 'react';
import { View, Pressable } from 'react-native';

interface PillProps {
  /** 'default' | 'error' — error renders a red border instead of bg */
  variant?: 'default' | 'error';
  /** Content rendered inside the rounded-full pill */
  children: ReactNode;
  /** Optional expandable body shown below the pill on press */
  body?: ReactNode;
}

export function Pill({ variant = 'default', children, body }: PillProps) {
  const [open, setOpen] = useState(false);
  const expandable = body != null;
  const isError = variant === 'error';

  return (
    <View className="flex-col items-center gap-2 my-1">
      <Pressable
        testID="mf-pill"
        disabled={!expandable}
        onPress={() => expandable && setOpen((v) => !v)}
        className="flex-row items-center gap-1.5 rounded-full px-3 py-1"
        style={{
          backgroundColor: isError ? 'transparent' : '#26272a80',
          borderWidth: isError ? 1 : 0,
          borderColor: isError ? 'rgba(239, 68, 68, 0.3)' : 'transparent',
        }}
      >
        {isError ? <View testID="mf-pill-error-border" /> : null}
        {children}
      </Pressable>
      {expandable && open ? (
        <View
          className="self-stretch rounded-mf-card overflow-hidden border"
          style={{ borderColor: '#393b40', backgroundColor: '#11121466' }}
        >
          <View className="px-3 py-2" style={{ maxHeight: 480 }}>
            {body}
          </View>
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Run the test → PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/components/chat/tools/Pill.tsx \
        packages/mobile/components/chat/tools/__tests__/Pill.test.tsx
git commit -m "feat(mobile): add Pill primitive for centered rounded-full cards

Foundation for U12/U14/U15/U16 pill family. Centered, rounded-full,
optional expandable body, error variant with red border."
```

---

## Task 2: U12 — Mobile port of SkillLoadedCard

**Files:**
- Create: `packages/mobile/components/chat/tools/SkillLoadedCard.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/SkillLoadedCard.test.tsx`
- Modify: `packages/mobile/components/chat/AssistantMessage.tsx` (or wherever `skill_loaded` system messages get routed)

- [ ] **Step 1: Read the desktop implementation as the contract**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SkillLoadedCard.tsx
```

Note: Zap icon, "Using skill: <name>" text, chevron right/down toggle, optional path tooltip, expanded body shows skill content as markdown.

- [ ] **Step 2: Write the failing test**

```tsx
// packages/mobile/components/chat/tools/__tests__/SkillLoadedCard.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { SkillLoadedCard } from '../SkillLoadedCard';

describe('mobile SkillLoadedCard (U12)', () => {
  it('shows "Using skill: <name>" label', () => {
    const { getByText } = render(
      <SkillLoadedCard skillName="brainstorming" path="/x/y" content="# Hi" />,
    );
    expect(getByText(/Using skill:/)).toBeTruthy();
    expect(getByText('brainstorming')).toBeTruthy();
  });

  it('toggles markdown body on press', () => {
    const { getByTestId, queryByText, getByText } = render(
      <SkillLoadedCard
        skillName="brainstorming"
        path="/x/y"
        content="# Hello world"
      />,
    );
    expect(queryByText('Hello world')).toBeNull();
    fireEvent.press(getByTestId('mf-pill'));
    // Markdown header renders as text
    expect(getByText(/Hello world/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test → FAIL**

- [ ] **Step 4: Create the component**

```tsx
// packages/mobile/components/chat/tools/SkillLoadedCard.tsx
import { Text, View } from 'react-native';
import { Zap } from 'lucide-react-native';
import { Pill } from './Pill';
import { MarkdownText } from '../MarkdownText';

interface Props {
  skillName: string;
  path: string;
  content: string;
}

export function SkillLoadedCard({ skillName, content }: Props) {
  return (
    <Pill body={<MarkdownText>{content}</MarkdownText>}>
      <Zap size={12} color="#a1a1aa" />
      <Text className="font-mono text-[11px] text-mf-text-secondary">
        Using skill: <Text className="text-mf-accent">{skillName}</Text>
      </Text>
    </Pill>
  );
}
```

(If `MarkdownText` is the existing mobile markdown renderer, it already takes `children` per Plan B context. If the API differs, pass `content` via the existing prop name — check `packages/mobile/components/chat/MarkdownText.tsx` first.)

- [ ] **Step 5: Wire into AssistantMessage / SystemMessage**

Find where mobile renders system messages with `skill_loaded` content. The desktop pattern:
- `convert-message.ts` extracts `meta.skillLoaded = { skillName, path, content }`
- `SystemMessage.tsx` reads `meta.skillLoaded` and renders `<SkillLoadedCard>` instead of plain text.

Apply the same pattern to mobile:

```tsx
// In whatever file dispatches system messages on mobile (likely AssistantMessage
// or a shared SystemMessage), find the skill_loaded handling:
const skillLoaded = message.content.find(
  (c): c is Extract<DisplayContent, { type: 'skill_loaded' }> =>
    c.type === 'skill_loaded',
);
if (skillLoaded) {
  return <SkillLoadedCard {...skillLoaded} />;
}
```

(If the mobile system-message dispatch path doesn't exist yet, create it in `MessageList.tsx` for the `'system'` case.)

- [ ] **Step 6: Run the test → PASS**

- [ ] **Step 7: Commit**

```bash
git add packages/mobile/components/chat/tools/SkillLoadedCard.tsx \
        packages/mobile/components/chat/tools/__tests__/SkillLoadedCard.test.tsx \
        packages/mobile/components/chat/AssistantMessage.tsx
git commit -m "feat(mobile): port SkillLoadedCard (U12)

Renders the 'Using skill: <name>' centered pill on skill activation.
Tap to expand markdown body. Mirrors desktop PR #237."
```

---

## Task 3: U14 — Worktree pills (desktop)

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/WorktreeStatusPill.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx`
- Test: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/WorktreeStatusPill.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/WorktreeStatusPill.test.tsx
import { render } from '@testing-library/react';
import { WorktreeStatusPill } from '../WorktreeStatusPill';

describe('WorktreeStatusPill (U14)', () => {
  it('Enter pending', () => {
    const { getByText } = render(
      <WorktreeStatusPill toolName="EnterWorktree" args={{ name: 'feat/x' }} />,
    );
    expect(getByText(/Entering worktree/)).toBeTruthy();
  });
  it('Enter done with branch name', () => {
    const { getByText } = render(
      <WorktreeStatusPill
        toolName="EnterWorktree"
        args={{ name: 'feat/x' }}
        result={{ content: JSON.stringify({ worktreePath: '/x', worktreeBranch: 'feat/x' }) }}
        isError={false}
      />,
    );
    expect(getByText(/Entered worktree/)).toBeTruthy();
    expect(getByText('feat/x')).toBeTruthy();
  });
  it('Exit done with action=remove', () => {
    const { getByText } = render(
      <WorktreeStatusPill
        toolName="ExitWorktree"
        args={{ action: 'remove' }}
        result={{ content: 'ok' }}
        isError={false}
      />,
    );
    expect(getByText(/Removed worktree/)).toBeTruthy();
  });
  it('Error renders red border', () => {
    const { container } = render(
      <WorktreeStatusPill
        toolName="EnterWorktree"
        args={{}}
        result={{ content: 'failed' }}
        isError={true}
      />,
    );
    expect(container.querySelector('.border-mf-chat-error\\/30, [class*="border-mf-chat-error"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- WorktreeStatusPill
```

- [ ] **Step 3: Create the component**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/WorktreeStatusPill.tsx
import { GitBranch } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

interface Props {
  toolName: 'EnterWorktree' | 'ExitWorktree';
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function parseEnterResult(result: Props['result']): { worktreePath?: string; worktreeBranch?: string } {
  const text = typeof result === 'string' ? result : result?.content ?? '';
  try { return JSON.parse(text); } catch { return {}; }
}

export function WorktreeStatusPill({ toolName, args, result, isError }: Props) {
  const isEnter = toolName === 'EnterWorktree';
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));

  let label: React.ReactNode;
  let tooltip: string | null = null;

  if (errored) {
    label = isEnter ? 'Failed to enter worktree' : 'Failed to exit worktree';
    tooltip = typeof result === 'object' ? result?.content ?? null : (result ?? null);
  } else if (pending) {
    label = isEnter ? 'Entering worktree…' : 'Exiting worktree…';
  } else if (isEnter) {
    const { worktreePath, worktreeBranch } = parseEnterResult(result);
    const name = String(args.name ?? worktreeBranch ?? worktreePath ?? '');
    label = (
      <>
        Entered worktree:{' '}
        <span className="text-mf-accent">{name}</span>
      </>
    );
    tooltip = worktreePath ?? null;
  } else {
    const action = String(args.action ?? 'keep');
    label = action === 'remove' ? 'Removed worktree' : 'Exited worktree (kept)';
  }

  const pill = (
    <span
      className={
        errored
          ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
          : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50'
      }
    >
      <GitBranch size={12} className="text-mf-text-secondary shrink-0" />
      <span className="font-mono text-[11px] text-mf-text-secondary">{label}</span>
      {pending ? (
        <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
      ) : errored ? (
        <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
      ) : null}
    </span>
  );

  return (
    <div className="flex justify-center my-1">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into the registry**

In `tool-ui-registry.tsx`:

```tsx
import { WorktreeStatusPill } from './tools/WorktreeStatusPill';

export const EnterWorktreeToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'EnterWorktree',
  render: ({ args, result, isError }) => (
    <WorktreeStatusPill toolName="EnterWorktree" args={args} result={result as never} isError={isError} />
  ),
});
export const ExitWorktreeToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'ExitWorktree',
  render: ({ args, result, isError }) => (
    <WorktreeStatusPill toolName="ExitWorktree" args={args} result={result as never} isError={isError} />
  ),
});
```

Add `EnterWorktreeToolUI` and `ExitWorktreeToolUI` to `AllToolUIs`.

In `render-tool-card.tsx`:

```tsx
if (toolName === 'EnterWorktree' || toolName === 'ExitWorktree') {
  return <WorktreeStatusPill toolName={toolName} args={args} result={result as never} isError={isError} />;
}
```

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/WorktreeStatusPill.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/WorktreeStatusPill.test.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx
git commit -m "feat(desktop): U14 WorktreeStatusPill for EnterWorktree/ExitWorktree

Centered rounded-full pill with GitBranch icon. Pending shows pulse,
done shows clean label, error shows red border + dot. Worktree name in
accent. Tooltip carries full path."
```

---

## Task 4: U14 — Worktree pills (mobile)

**Files:**
- Create: `packages/mobile/components/chat/tools/WorktreeStatusPill.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/WorktreeStatusPill.test.tsx`
- Modify: `packages/mobile/components/chat/tools/index.tsx`

- [ ] **Step 1: Write failing test**

Mirror Task 3's test for mobile (`@testing-library/react-native`, `getByText`, etc.).

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create the component**

```tsx
// packages/mobile/components/chat/tools/WorktreeStatusPill.tsx
import { Text } from 'react-native';
import { GitBranch } from 'lucide-react-native';
import { Pill } from './Pill';
import type { ToolCallProps } from './shared';

interface Props extends ToolCallProps {
  toolName: 'EnterWorktree' | 'ExitWorktree';
}

function parseEnterResult(result: unknown): { worktreePath?: string; worktreeBranch?: string } {
  const text = typeof result === 'string' ? result : '';
  try { return JSON.parse(text); } catch { return {}; }
}

export function WorktreeStatusPill({ toolName, args, result, isError }: Props) {
  const isEnter = toolName === 'EnterWorktree';
  const pending = result === undefined;
  const errored = !!isError && !pending;

  let labelLeft: string;
  let labelAccent: string | null = null;

  if (errored) {
    labelLeft = isEnter ? 'Failed to enter worktree' : 'Failed to exit worktree';
  } else if (pending) {
    labelLeft = isEnter ? 'Entering worktree…' : 'Exiting worktree…';
  } else if (isEnter) {
    const { worktreeBranch, worktreePath } = parseEnterResult(result);
    const name = String(args.name ?? worktreeBranch ?? worktreePath ?? '');
    labelLeft = 'Entered worktree:';
    labelAccent = name;
  } else {
    const action = String(args.action ?? 'keep');
    labelLeft = action === 'remove' ? 'Removed worktree' : 'Exited worktree (kept)';
  }

  return (
    <Pill variant={errored ? 'error' : 'default'}>
      <GitBranch size={12} color="#a1a1aa" />
      <Text className="font-mono text-[11px] text-mf-text-secondary">
        {labelLeft}
        {labelAccent ? <Text className="text-mf-accent"> {labelAccent}</Text> : null}
      </Text>
    </Pill>
  );
}
```

- [ ] **Step 4: Add cases to ToolCardRouter**

```tsx
case 'EnterWorktree':
case 'ExitWorktree':
  return <WorktreeStatusPill toolName={name} {...props} />;
```

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/tools/WorktreeStatusPill.tsx \
        packages/mobile/components/chat/tools/__tests__/WorktreeStatusPill.test.tsx \
        packages/mobile/components/chat/tools/index.tsx
git commit -m "feat(mobile): U14 WorktreeStatusPill"
```

---

## Task 5: U15 — MCP tool call pill (desktop)

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/MCPToolCard.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// __tests__/MCPToolCard.test.tsx
import { render, fireEvent } from '@testing-library/react';
import { MCPToolCard } from '../MCPToolCard';

describe('MCPToolCard (U15)', () => {
  it('parses server and tool from mcp__claude_ai_Notion__notion-search', () => {
    const { getByText } = render(
      <MCPToolCard toolName="mcp__claude_ai_Notion__notion-search" args={{ query: 'x' }} />,
    );
    expect(getByText(/Notion executing/)).toBeTruthy();
    expect(getByText('notion-search')).toBeTruthy();
  });

  it('strips claude_ai_ prefix and capitalizes server', () => {
    const { getByText } = render(
      <MCPToolCard toolName="mcp__pencil__batch_design" args={{}} />,
    );
    expect(getByText(/Pencil executing/)).toBeTruthy();
  });

  it('chevron expands ARGUMENTS + RESULT panel when result present', () => {
    const { getByRole, queryByText, getByText } = render(
      <MCPToolCard
        toolName="mcp__pencil__batch_design"
        args={{ x: 1 }}
        result={{ content: 'Done. 3 items.' }}
        isError={false}
      />,
    );
    expect(queryByText(/ARGUMENTS/)).toBeNull();
    fireEvent.click(getByRole('button'));
    expect(getByText(/ARGUMENTS/)).toBeTruthy();
    expect(getByText(/RESULT/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create the component**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/MCPToolCard.tsx
import { useState } from 'react';
import { Plug, ChevronRight, ChevronDown } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

interface Props {
  toolName: string;
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function parseToolName(toolName: string): { server: string; tool: string } {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return { server: 'mcp', tool: toolName };
  let server = m[1]!;
  if (server.startsWith('claude_ai_')) server = server.slice('claude_ai_'.length);
  server = server.charAt(0).toUpperCase() + server.slice(1);
  return { server, tool: m[2]! };
}

export function MCPToolCard({ toolName, args, result, isError }: Props) {
  const { server, tool } = parseToolName(toolName);
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));
  const [open, setOpen] = useState(false);
  const expandable = !pending && !errored;
  const Chevron = open ? ChevronDown : ChevronRight;

  const verb = errored ? 'failed:' : pending ? 'executing' : 'executed';
  const dot = pending ? (
    <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
  ) : errored ? (
    <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
  ) : null;

  const resultText = typeof result === 'string' ? result : result?.content ?? '';

  return (
    <div className="flex flex-col items-center gap-2 my-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => expandable && setOpen((v) => !v)}
            className={
              errored
                ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
                : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50 hover:bg-mf-hover/70 transition-colors'
            }
            disabled={!expandable}
          >
            <Plug size={12} className="text-mf-text-secondary shrink-0" />
            <span className="font-mono text-[11px] text-mf-text-secondary">
              {server} {verb} <span className="text-mf-accent">{tool}</span>
            </span>
            {dot}
            {expandable ? <Chevron size={12} className="text-mf-text-secondary/60 shrink-0" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent>{toolName}</TooltipContent>
      </Tooltip>

      {open && expandable ? (
        <div className="w-full rounded-mf-card border border-mf-divider bg-mf-hover/20 px-3 py-2 space-y-2">
          <div>
            <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">Arguments</span>
            <pre className="mt-1 text-mf-small font-mono text-mf-text-secondary overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {resultText ? (
            <div>
              <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">Result</span>
              <pre className="mt-1 text-mf-small font-mono text-mf-text-primary overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {resultText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add wildcard branch in render-tool-card.tsx**

```tsx
// At the top of renderToolCard, BEFORE the explicit name switch:
if (toolName.startsWith('mcp__')) {
  return <MCPToolCard toolName={toolName} args={args} result={result as never} isError={isError} />;
}
```

(Don't register via assistant-ui registry — the `mcp__*` namespace is dynamic; registry expects literal names. The render-tool-card wildcard is enough since assistant-ui falls back through to it.)

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/MCPToolCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/MCPToolCard.test.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx
git commit -m "feat(desktop): U15 MCPToolCard

Wildcard handler for mcp__* tool names. Centered Plug pill with
'<Server> executing/executed <tool>'. Server name normalized (strip
claude_ai_ prefix, capitalize). Expandable ARGUMENTS+RESULT panel.
Tooltip preserves the raw tool name for debugging."
```

---

## Task 6: U15 — MCP tool call pill (mobile)

**Files:**
- Create: `packages/mobile/components/chat/tools/MCPToolCard.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/MCPToolCard.test.tsx`
- Modify: `packages/mobile/components/chat/tools/index.tsx`

- [ ] **Step 1: Write failing test** (mirror Task 5)

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create**

```tsx
// packages/mobile/components/chat/tools/MCPToolCard.tsx
import { Text, View } from 'react-native';
import { Plug } from 'lucide-react-native';
import { Pill } from './Pill';
import type { ToolCallProps } from './shared';

interface Props extends ToolCallProps {
  toolName: string;
}

function parseToolName(toolName: string): { server: string; tool: string } {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return { server: 'mcp', tool: toolName };
  let server = m[1]!;
  if (server.startsWith('claude_ai_')) server = server.slice('claude_ai_'.length);
  server = server.charAt(0).toUpperCase() + server.slice(1);
  return { server, tool: m[2]! };
}

export function MCPToolCard({ toolName, args, result, isError }: Props) {
  const { server, tool } = parseToolName(toolName);
  const pending = result === undefined;
  const errored = !!isError && !pending;
  const expandable = !pending && !errored;
  const verb = errored ? 'failed:' : pending ? 'executing' : 'executed';
  const resultText = typeof result === 'string' ? result : '';

  const body = expandable ? (
    <View>
      <Text className="text-[10px] uppercase tracking-wide font-semibold text-mf-text-secondary mb-1">
        Arguments
      </Text>
      <Text className="text-[11px] font-mono text-mf-text-secondary">
        {JSON.stringify(args, null, 2)}
      </Text>
      {resultText ? (
        <>
          <Text className="text-[10px] uppercase tracking-wide font-semibold text-mf-text-secondary mt-2 mb-1">
            Result
          </Text>
          <Text className="text-[11px] font-mono text-mf-text-primary">{resultText}</Text>
        </>
      ) : null}
    </View>
  ) : null;

  return (
    <Pill variant={errored ? 'error' : 'default'} body={body}>
      <Plug size={12} color="#a1a1aa" />
      <Text className="font-mono text-[11px] text-mf-text-secondary">
        {server} {verb} <Text className="text-mf-accent">{tool}</Text>
      </Text>
    </Pill>
  );
}
```

- [ ] **Step 4: Wire ToolCardRouter wildcard**

```tsx
// At the top of the switch (or before it):
if (name.startsWith('mcp__')) {
  return <MCPToolCard toolName={name} {...props} />;
}
```

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/components/chat/tools/MCPToolCard.tsx \
        packages/mobile/components/chat/tools/__tests__/MCPToolCard.test.tsx \
        packages/mobile/components/chat/tools/index.tsx
git commit -m "feat(mobile): U15 MCPToolCard"
```

---

## Task 7: U16 — Schedule / Cron / Monitor pills (desktop)

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SchedulePill.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// __tests__/SchedulePill.test.tsx
import { render, fireEvent } from '@testing-library/react';
import { SchedulePill } from '../SchedulePill';

describe('SchedulePill (U16)', () => {
  it('ScheduleWakeup done shows formatted delay + reason', () => {
    const { getByText } = render(
      <SchedulePill
        toolName="ScheduleWakeup"
        args={{ delaySeconds: 300, reason: 'checking deploy', prompt: '/loop deploy' }}
        result="ok"
      />,
    );
    expect(getByText(/Will resume in 5m/)).toBeTruthy();
    expect(getByText(/checking deploy/)).toBeTruthy();
  });
  it('CronCreate done shows humanSchedule + recurring badge', () => {
    const { getByText } = render(
      <SchedulePill
        toolName="CronCreate"
        args={{ cron: '0 9 * * 1-5', prompt: '/check', recurring: true }}
        result={{ content: JSON.stringify({ id: 'a', humanSchedule: 'every weekday at 9am', recurring: true }) }}
        isError={false}
      />,
    );
    expect(getByText(/every weekday at 9am/)).toBeTruthy();
    expect(getByText(/recurring/)).toBeTruthy();
  });
  it('Monitor pending shows pulse', () => {
    const { container } = render(
      <SchedulePill
        toolName="Monitor"
        args={{ command: 'tail -f log', description: 'deploy progress' }}
      />,
    );
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create the component**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SchedulePill.tsx
import { useState } from 'react';
import {
  AlarmClock,
  CalendarClock,
  CalendarX,
  CalendarDays,
  Activity,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

type ScheduleTool = 'ScheduleWakeup' | 'CronCreate' | 'CronDelete' | 'CronList' | 'Monitor';

interface Props {
  toolName: ScheduleTool;
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function formatDelay(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function parseResult(result: Props['result']): { content: string; obj: Record<string, unknown> | null } {
  const content = typeof result === 'string' ? result : result?.content ?? '';
  try { return { content, obj: JSON.parse(content) }; } catch { return { content, obj: null }; }
}

const ICONS: Record<ScheduleTool, typeof AlarmClock> = {
  ScheduleWakeup: AlarmClock,
  CronCreate: CalendarClock,
  CronDelete: CalendarX,
  CronList: CalendarDays,
  Monitor: Activity,
};

export function SchedulePill({ toolName, args, result, isError }: Props) {
  const Icon = ICONS[toolName];
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));
  const [open, setOpen] = useState(false);
  const { obj, content } = parseResult(result);

  // Build label and (for CronList/Monitor) optional expandable body.
  let label: React.ReactNode = '';
  let tooltip: string | null = null;
  let body: React.ReactNode = null;

  if (errored) {
    label = `Failed: ${toolName}`;
    tooltip = content || null;
  } else if (pending) {
    if (toolName === 'ScheduleWakeup') label = 'Scheduling wakeup…';
    else if (toolName === 'CronCreate') label = 'Creating schedule…';
    else if (toolName === 'CronDelete') label = 'Removing schedule…';
    else if (toolName === 'CronList') label = 'Listing schedules…';
    else if (toolName === 'Monitor') {
      const desc = String(args.description ?? args.command ?? '');
      label = (
        <>
          Monitoring: <span className="text-mf-accent">{desc}</span>
        </>
      );
    }
  } else if (toolName === 'ScheduleWakeup') {
    const delay = Number(args.delaySeconds ?? 0);
    const reason = String(args.reason ?? '');
    label = (
      <>
        Will resume in <span className="text-mf-accent">{formatDelay(delay)}</span>
        {reason ? ` · ${reason}` : ''}
      </>
    );
    tooltip = String(args.prompt ?? '') || null;
  } else if (toolName === 'CronCreate') {
    const human = String(obj?.humanSchedule ?? args.cron ?? '');
    const recurring = obj?.recurring ?? args.recurring;
    const durable = obj?.durable;
    label = (
      <>
        Scheduled: <span className="text-mf-accent">{human}</span>
        {' · '}
        <span className="text-mf-text-secondary/60">{recurring ? 'recurring' : 'one-shot'}</span>
        {durable === false ? <span className="text-mf-text-secondary/60"> · session-only</span> : null}
      </>
    );
    tooltip = `${args.cron ?? ''}\n\n${args.prompt ?? ''}` || null;
  } else if (toolName === 'CronDelete') {
    label = (
      <>
        Removed schedule · <span className="font-mono text-mf-accent">{String(args.id ?? '')}</span>
      </>
    );
  } else if (toolName === 'CronList') {
    const jobs = Array.isArray(obj) ? obj : [];
    label = (
      <>
        Listed <span className="text-mf-accent">{jobs.length}</span> scheduled job
        {jobs.length === 1 ? '' : 's'}
      </>
    );
    if (jobs.length > 0) {
      body = (
        <div className="text-mf-small font-mono text-mf-text-secondary/60 space-y-1 max-h-[300px] overflow-y-auto">
          {jobs.map((j: Record<string, unknown>) => (
            <div key={String(j.id ?? '')}>
              <div>
                • <span className="text-mf-accent">{String(j.id ?? '')}</span>{' '}
                {String(j.humanSchedule ?? j.cron ?? '')}{' '}
                <span className="opacity-60">
                  ({j.recurring ? 'recurring' : 'one-shot'}{j.durable === false ? ', session-only' : ''})
                </span>
              </div>
              {j.prompt ? <div className="pl-3 opacity-60">prompt: {String(j.prompt)}</div> : null}
            </div>
          ))}
        </div>
      );
    }
  } else if (toolName === 'Monitor') {
    const desc = String(args.description ?? args.command ?? '');
    label = (
      <>
        Stopped monitoring: <span className="text-mf-accent">{desc}</span>
      </>
    );
    if (content) {
      body = (
        <pre className="text-mf-small font-mono text-mf-text-secondary/60 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {content}
        </pre>
      );
    }
  }

  const expandable = body != null && !pending && !errored;
  const Chevron = open ? ChevronDown : ChevronRight;

  const pill = (
    <button
      type="button"
      onClick={() => expandable && setOpen((v) => !v)}
      disabled={!expandable}
      className={
        errored
          ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
          : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50 hover:bg-mf-hover/70 transition-colors disabled:cursor-default'
      }
    >
      <Icon size={12} className="text-mf-text-secondary shrink-0" />
      <span className="font-mono text-[11px] text-mf-text-secondary">{label}</span>
      {pending ? (
        <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
      ) : errored ? (
        <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
      ) : null}
      {expandable ? <Chevron size={12} className="text-mf-text-secondary/60 shrink-0" /> : null}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-2 my-1">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent className="max-w-[480px] whitespace-pre-wrap">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
      {open && expandable ? (
        <div className="w-full rounded-mf-card border border-mf-divider bg-mf-hover/20 px-3 py-2">
          {body}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Register**

In `tool-ui-registry.tsx`:

```tsx
import { SchedulePill } from './tools/SchedulePill';

const SCHEDULE_TOOLS = ['ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'Monitor'] as const;
export const ScheduleToolUIs = SCHEDULE_TOOLS.map((toolName) =>
  makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: ({ args, result, isError }) => (
      <SchedulePill toolName={toolName} args={args} result={result as never} isError={isError} />
    ),
  }),
);
// add ...ScheduleToolUIs to AllToolUIs
```

In `render-tool-card.tsx`:

```tsx
const SCHEDULE_TOOLS = new Set(['ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'Monitor']);
if (SCHEDULE_TOOLS.has(toolName)) {
  return <SchedulePill toolName={toolName as never} args={args} result={result as never} isError={isError} />;
}
```

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SchedulePill.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/SchedulePill.test.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tool-ui-registry.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx
git commit -m "feat(desktop): U16 SchedulePill for ScheduleWakeup/Cron*/Monitor

Single pill component, branched by toolName. Distinct icon per tool.
CronList and Monitor expand to show job list / output buffer."
```

---

## Task 8: U16 — Mobile Schedule pill

**Files:**
- Create: `packages/mobile/components/chat/tools/SchedulePill.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/SchedulePill.test.tsx`
- Modify: `packages/mobile/components/chat/tools/index.tsx`

- [ ] **Step 1: Mirror desktop logic** with React Native primitives. Use `lucide-react-native` for icons. Reuse the `Pill` primitive from Task 1 with `body` for CronList/Monitor expanded content.
- [ ] **Step 2: Add ToolCardRouter cases:**

```tsx
case 'ScheduleWakeup':
case 'CronCreate':
case 'CronDelete':
case 'CronList':
case 'Monitor':
  return <SchedulePill toolName={name} {...props} />;
```

- [ ] **Step 3: Test → PASS, commit.**

```bash
git commit -m "feat(mobile): U16 SchedulePill"
```

---

## Task 9: Workspace tests + build + changeset

- [ ] **Step 1: Typecheck both packages**
- [ ] **Step 2: Run all tests**
- [ ] **Step 3: Build desktop**
- [ ] **Step 4: Generate changeset (`minor` for both packages):**

```
Pill family of tool cards: U12 mobile SkillLoadedCard port. U14
WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard
(wildcard for mcp__*). U16 SchedulePill (ScheduleWakeup, CronCreate,
CronDelete, CronList, Monitor).
```

- [ ] **Step 5: Commit.**

---

## Self-Review

- ✅ **Spec coverage:** U12 (Tasks 1-2 mobile only — desktop already shipped), U14 (Tasks 3-4), U15 (Tasks 5-6), U16 (Tasks 7-8).
- ✅ **Placeholder scan:** all components have full code. Mobile mirrors are explicitly told to "mirror desktop logic" with the desktop file as canonical reference — that's a valid pattern when the contracts are identical.
- ✅ **Type consistency:** `toolName` literal types match across desktop and mobile components. `parseToolName` and `parseResult` defined identically. `ICONS` table for SchedulePill uses lucide names.
- ✅ **Independence:** standalone — only depends on Plan B for the mobile MarkdownText component used in U12.
