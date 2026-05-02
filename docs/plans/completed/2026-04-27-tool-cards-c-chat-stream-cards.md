# Tool Cards Plan C — Chat-Stream Cards (U1–U11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the unified design to all 11 chat-stream tool cards on both desktop and mobile.

**Architecture:** Per card: small desktop tweaks (move `StatusDot` from `statusDot` prop to `trailing` slot, add `hideToggle`, drop the per-extension FileTypeIcon where the spec says so) plus mobile build-out (rewrite `ToolCardRouter` cases to use the new `CollapsibleToolCard` from Plan B, add file content / search results / line numbers etc that mobile previously didn't show).

**Tech Stack:** TypeScript, React, NativeWind, lucide-react / lucide-react-native, vitest. Both packages.

**Spec reference:** `docs/plans/2026-04-06-tool-card-rendering-audit.md` — sections U1 through U11.

**Depends on:** Plan A (CollapsibleToolCard contract changes, hidden-tools refactor) and Plan B (mobile CollapsibleToolCard, bug fixes).

**⚠️ Working directory:** Desktop work in this `feat-tool-cards` worktree; mobile work in `/Users/doruchiulan/Projects/qlan/mainframe/packages/mobile/` (main checkout) — same as Plan B.

---

## File Structure

| File | Plan-C role |
|---|---|
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/{Bash,EditFile,WriteFile,ReadFile,Search,Task,TaskGroup,ToolGroup,Plan,AskUserQuestionTool,DefaultTool}Card.tsx` | One small edit each — `statusDot → null`, push the dot into `trailing`, add `hideToggle` |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/{EditFile,WriteFile}Card.tsx` | Prepend `Pencil(15)` icon before existing `FileTypeIcon` |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SearchCard.tsx` | Restructure: `toolName` in header, `pattern · in <path>` in `subHeader` |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskCard.tsx` | Restructure: header keeps `Bot agent-type model … usage ●`; `description` moves to subheader; tooltip source switches `description → prompt`, with 600-char trim |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx` | Drop the explicit Maximize2/Minimize2 toggle |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/ReadFileCard.tsx` | Swap `Eye(15)` → `FileText(15) + "Read"` label |
| `packages/mobile/components/chat/tools/shared.tsx` | New file: `StatusDot`, `ErrorDot`, `cardErrorBorder`, `shortenPath`, `formatDuration`, `formatTokens` (shared utilities mirroring desktop) |
| `packages/mobile/components/chat/tools/{Bash,EditFile,WriteFile,ReadFile,Search,Task,TaskGroup,ToolGroup,Plan,AskUserQuestionTool,DefaultTool}Card.tsx` | New file per card: full mobile component built on the Plan-B `CollapsibleToolCard` |
| `packages/mobile/components/chat/tools/index.tsx` | Rewrite `ToolCardRouter` switch to dispatch to the new components |

---

## Task 1: Mobile shared utilities (`shared.tsx`)

**Files:**
- Create: `packages/mobile/components/chat/tools/shared.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/shared.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/mobile/components/chat/tools/__tests__/shared.test.tsx
import { render } from '@testing-library/react-native';
import { StatusDot, ErrorDot, shortenPath, formatTokens, formatDuration } from '../shared';

describe('mobile tools/shared', () => {
  it('shortenPath keeps last 3 segments', () => {
    expect(shortenPath('a/b/c/d/e.ts')).toBe('c/d/e.ts');
    expect(shortenPath('short.ts')).toBe('short.ts');
  });

  it('formatTokens uses k/M suffixes', () => {
    expect(formatTokens(123)).toBe('123');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formatDuration uses s and m', () => {
    expect(formatDuration(2400)).toBe('2s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(60_000)).toBe('1m');
  });

  it('StatusDot renders pending pulse / success / error', () => {
    const pending = render(<StatusDot result={undefined} isError={false} />);
    expect(pending.getByTestId('mf-status-dot-pending')).toBeTruthy();
    const ok = render(<StatusDot result="done" isError={false} />);
    expect(ok.getByTestId('mf-status-dot-success')).toBeTruthy();
    const err = render(<StatusDot result="failed" isError={true} />);
    expect(err.getByTestId('mf-status-dot-error')).toBeTruthy();
  });

  it('ErrorDot only renders on error', () => {
    const none = render(<ErrorDot isError={false} />);
    expect(none.toJSON()).toBeNull();
    const yes = render(<ErrorDot isError={true} />);
    expect(yes.getByTestId('mf-status-dot-error')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- shared
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create shared.tsx**

```tsx
// packages/mobile/components/chat/tools/shared.tsx
import { View } from 'react-native';

export function StatusDot({
  result,
  isError,
}: {
  result?: unknown;
  isError?: boolean;
}) {
  if (result === undefined) {
    return (
      <View
        testID="mf-status-dot-pending"
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: '#a1a1aa66', opacity: 0.6 }}
      />
    );
  }
  if (isError) {
    return (
      <View
        testID="mf-status-dot-error"
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: '#ef4444' }}
      />
    );
  }
  return (
    <View
      testID="mf-status-dot-success"
      className="w-2 h-2 rounded-full"
      style={{ backgroundColor: '#22c55e' }}
    />
  );
}

export function ErrorDot({ isError }: { isError?: boolean }) {
  if (!isError) return null;
  return (
    <View
      testID="mf-status-dot-error"
      className="w-2 h-2 rounded-full"
      style={{ backgroundColor: '#ef4444' }}
    />
  );
}

export const ERROR_BORDER_COLOR = 'rgba(239, 68, 68, 0.3)'; // mf-chat-error/30 equivalent
export const DEFAULT_BORDER_COLOR = '#43454a';

export function shortenPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return parts.slice(-3).join('/');
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export interface ToolCallProps {
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- shared
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/components/chat/tools/shared.tsx \
        packages/mobile/components/chat/tools/__tests__/shared.test.tsx
git commit -m "feat(mobile): add tools/shared.tsx with StatusDot, formatters

Mirrors desktop shared.tsx contract — StatusDot, ErrorDot, shortenPath,
formatTokens, formatDuration. Foundation for the per-tool unified cards."
```

---

## Task 2: U1 BashCard — desktop tweaks

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/BashCard.tsx`

- [ ] **Step 1: Read current BashCard**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/BashCard.tsx
```

- [ ] **Step 2: Update the CollapsibleToolCard call**

The change pattern (apply throughout this plan):
- Set `statusDot={undefined}`
- Move `<StatusDot ... />` into `trailing` (rightmost element)
- Add `hideToggle`

For BashCard specifically:

```tsx
<CollapsibleToolCard
  hideToggle
  wrapperClassName={cardStyle(result, isError)}
  header={
    <>
      <Terminal size={15} className="text-mf-text-secondary shrink-0" />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-mf-body text-mf-text-primary truncate" tabIndex={0}>
            {truncatedCmd}
          </span>
        </TooltipTrigger>
        <TooltipContent>{command}</TooltipContent>
      </Tooltip>
    </>
  }
  trailing={<StatusDot result={result} isError={isError} />}
  subHeader={
    description ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="px-3 pb-1.5 -mt-0.5 text-mf-small text-mf-text-secondary truncate pl-[52px]" tabIndex={0}>
            {description}
          </div>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    ) : undefined
  }
>
  {/* expanded body unchanged */}
</CollapsibleToolCard>
```

- [ ] **Step 3: Add a snapshot/render test**

```tsx
// packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/BashCard.test.tsx
import { render } from '@testing-library/react';
import { BashCard } from '../BashCard';

describe('BashCard (unified)', () => {
  it('puts the status dot in the trailing slot, not before the icon', () => {
    const { container } = render(
      <BashCard args={{ command: 'ls' }} result="ok" isError={false} />,
    );
    // Status dot should appear after the header content (rightmost)
    const button = container.querySelector('button')!;
    const dot = button.querySelector('[data-testid="mf-status-dot"], .bg-mf-success');
    const terminalIcon = button.querySelector('.lucide-terminal, svg[class*="terminal"]');
    expect(dot).toBeTruthy();
    expect(terminalIcon).toBeTruthy();
    // dot's compareDocumentPosition vs icon: dot must come AFTER
    expect(
      terminalIcon!.compareDocumentPosition(dot!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not render the Maximize2 toggle icon', () => {
    const { container } = render(
      <BashCard args={{ command: 'ls' }} result={undefined} isError={false} />,
    );
    expect(container.querySelector('.lucide-maximize-2')).toBeNull();
  });

  it('renders subHeader description when collapsed', () => {
    const { getByText } = render(
      <BashCard
        args={{ command: 'ls', description: 'list files' }}
        result={undefined}
        isError={false}
      />,
    );
    expect(getByText('list files')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- BashCard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/BashCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/__tests__/BashCard.test.tsx
git commit -m "feat(desktop): apply U1 unified design to BashCard

statusDot moves to trailing slot, drop Maximize2/Minimize2 icon (whole
header row is the click target), subHeader visible in both states."
```

---

## Task 3: U1 BashCard — mobile build

**Files:**
- Create: `packages/mobile/components/chat/tools/BashCard.tsx`
- Test: `packages/mobile/components/chat/tools/__tests__/BashCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/mobile/components/chat/tools/__tests__/BashCard.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { BashCard } from '../BashCard';

describe('mobile BashCard (U1)', () => {
  it('collapsed by default, header shows command', () => {
    const { getByText, queryByText } = render(
      <BashCard args={{ command: 'npm test' }} result="PASS" isError={false} />,
    );
    expect(getByText('npm test')).toBeTruthy();
    expect(queryByText('PASS')).toBeNull();
  });

  it('expands on header press to reveal output', () => {
    const { getByText, getByTestId } = render(
      <BashCard args={{ command: 'npm test' }} result="PASS\nDone" isError={false} />,
    );
    fireEvent.press(getByTestId('mf-tool-card-header'));
    expect(getByText(/PASS/)).toBeTruthy();
  });

  it('shows description subheader in both states', () => {
    const { getByText, getByTestId } = render(
      <BashCard
        args={{ command: 'npm test', description: 'Run tests' }}
        result="PASS"
        isError={false}
      />,
    );
    expect(getByText('Run tests')).toBeTruthy();
    fireEvent.press(getByTestId('mf-tool-card-header'));
    expect(getByText('Run tests')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/mobile && pnpm test -- BashCard
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create the component**

```tsx
// packages/mobile/components/chat/tools/BashCard.tsx
import { View, Text, ScrollView } from 'react-native';
import { Terminal } from 'lucide-react-native';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot, ERROR_BORDER_COLOR, DEFAULT_BORDER_COLOR, type ToolCallProps } from './shared';

const TRUNCATE = 80;

export function BashCard({ args, result, isError }: ToolCallProps) {
  const command = String(args.command ?? '');
  const description = args.description ? String(args.description) : '';
  const truncatedCmd = command.length > TRUNCATE ? command.slice(0, TRUNCATE) + '…' : command;
  const resultText = typeof result === 'string' ? result : '';
  const borderColor = isError && result !== undefined ? ERROR_BORDER_COLOR : DEFAULT_BORDER_COLOR;

  return (
    <CollapsibleToolCard
      wrapperClassName="rounded-mf-card overflow-hidden border"
      header={
        <>
          <Terminal size={15} color="#a1a1aa" />
          <Text
            className="font-mono text-mf-text-primary text-xs flex-1"
            numberOfLines={1}
          >
            {truncatedCmd}
          </Text>
        </>
      }
      trailing={<StatusDot result={result} isError={isError} />}
      subHeader={
        description ? (
          <Text className="text-mf-text-secondary text-xs" numberOfLines={1}>
            {description}
          </Text>
        ) : undefined
      }
    >
      {resultText ? (
        <ScrollView style={{ maxHeight: 400 }}>
          {resultText.split('\n').map((line, i) => (
            <Text
              key={i}
              style={{
                color: line.startsWith('✓') ? '#22c55e' : '#a1a1aa',
                fontFamily: 'monospace',
                fontSize: 11,
              }}
            >
              {line}
            </Text>
          ))}
        </ScrollView>
      ) : null}
    </CollapsibleToolCard>
  );
}

// Note: borderColor override for error state requires CollapsibleToolCard
// to accept a style prop; if it doesn't (per Plan B Task 4), use the
// inline workaround:
//   wrap in a parent <View style={{ borderColor }}> instead.
// Plan B's CollapsibleToolCard hardcodes border in style — see Plan B Task 4
// for the exact escape hatch (or extend the component to accept style).
```

> **Implementation note for the engineer:** the simplest path is to extend `CollapsibleToolCard` to accept an optional `borderColor` prop. Add it to Plan B Task 4 retroactively if needed (one-line addition). For now, if `CollapsibleToolCard` doesn't expose it, wrap the card in an outer `View` with the border style and pass `wrapperClassName="rounded-mf-card overflow-hidden"` (no `border` class) so the inner doesn't double-border.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/mobile && pnpm test -- BashCard
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/components/chat/tools/BashCard.tsx \
        packages/mobile/components/chat/tools/__tests__/BashCard.test.tsx
git commit -m "feat(mobile): U1 BashCard built on CollapsibleToolCard

Collapsed by default. Subheader (description) shown in both states.
Output revealed on header press. Status dot in trailing slot. Error
border on isError + result."
```

---

## Tasks 4–12: per-card tasks

The remaining 10 cards follow an identical pattern:

1. **Desktop tweak task** — same shape as Task 2: in the existing card's `CollapsibleToolCard` call, set `statusDot={undefined}`, push `<StatusDot/>` (or `<ErrorDot/>` for compact variants) into `trailing`, add `hideToggle`. Add a 3-assertion test (status-dot-position, no-toggle-icon, subHeader-visibility).
2. **Mobile build task** — create `<CardName>.tsx` from scratch using `CollapsibleToolCard` + `shared.tsx`, mirror desktop's content (with `Text`/`View`/`Pressable` instead of `div`/`span`), match the unified-design diagram exactly.

For each card below, the diagram from `2026-04-06-tool-card-rendering-audit.md` U-section is the contract. **Read the corresponding U-entry before starting that task.**

### Task 4: U2 EditFileCard

**Desktop changes** (file: `packages/desktop/.../EditFileCard.tsx`):
- Add `hideToggle`. Move `StatusDot` into `trailing` AFTER the existing diff badges and `ExternalLink` button.
- **Header:** prepend `<Pencil size={15} className="text-mf-text-secondary shrink-0" />` BEFORE the existing `<FileTypeIcon ...>` (both icons present).

**Mobile build** (file: `packages/mobile/.../EditFileCard.tsx`):
- Use `CollapsibleToolCard` with `defaultOpen` (matches `defaultOpen=true` on desktop).
- Header: `Pencil(15)` + `FileTypeIcon` (or `FileText` if `FileTypeIcon` doesn't exist on mobile yet — port it or fallback to `FileText`) + `ClickableFilePath` (path tap opens file in… for mobile, no-op or share sheet — for now, just text).
- Trailing: `+N` `-N` badges + `StatusDot` (NO `ExternalLink` button — desktop only per spec).
- Body: line-numbered diff. Reuse the existing mobile EditCard's hunk-rendering logic but ADD line numbers (`<View w-8 right-aligned>` per side).

**Steps per task** (apply for each of Tasks 4–12):
- [ ] Step 1: Write failing test (3-5 assertions covering the unified design changes)
- [ ] Step 2: Run test → FAIL
- [ ] Step 3: Implement desktop tweak (or mobile component)
- [ ] Step 4: Run test → PASS
- [ ] Step 5: Commit with message `feat(desktop|mobile): apply U<N> unified design to <CardName>`

### Task 5: U3 WriteFileCard

**Desktop:** same as EditFileCard (Pencil + FileTypeIcon, statusDot to trailing, `hideToggle`).
**Mobile:** new component. Use `CollapsibleToolCard` (`defaultOpen`). Header: `Pencil + FileText + path`. Trailing: `+N` badge + `StatusDot`. Body: line-by-line all-green added content with line numbers + `+` column.

### Task 6: U4 ReadFileCard

**Desktop:** swap header — replace `<Eye size={15} className="text-mf-text-secondary/40" />` + `<ClickableFilePath />` with `<FileText size={15} className="text-mf-text-secondary/40" />` + `<Text>Read</Text>` + `<ClickableFilePath />`. Move `StatusDot` (success+error, not just `ErrorDot`) into `trailing`. Add `hideToggle`. Add outer border via `wrapperClassName="border border-mf-divider rounded-mf-card overflow-hidden"`.

**Mobile:** new component. `CollapsibleToolCard` (compact). Header: `FileText(14)` + "Read" label + path. Body when expanded: line-numbered file content from `result.content` (split by `\n`).

### Task 7: U5 SearchCard

**Desktop:** restructure header — current is `Search + toolName + pattern` all in header. Move `pattern` into `subHeader`, format as `"<pattern>" · in <path>` if `args.path` is set; else just `"<pattern>"`. Add `hideToggle`. Move `ErrorDot` → `StatusDot` (success too) into `trailing`. Add outer border via `wrapperClassName`.

**Mobile:** new component. Same restructure: header has `Search + toolName`, subHeader has formatted pattern + optional path. Body: results from `result.content`.

### Task 8: U6 TaskCard

**Desktop:** refactor to two-row layout. Header row: `Bot + agentType + model + flex spacer + usage stats + StatusDot`. SubHeader: `description` (currently in header). Tooltip: source switches from `args.description` → `args.prompt`, with 600-char trim:

```tsx
const promptForTooltip = (() => {
  const p = String(args.prompt ?? args.description ?? '');
  if (!p) return null;
  return p.length > 600 ? p.slice(0, 600) + '…' : p;
})();
```

Wrap the subHeader in `<Tooltip>` with `<TooltipContent className="max-w-[480px] whitespace-pre-wrap">{promptForTooltip}</TooltipContent>`. Skip rendering the tooltip if `promptForTooltip === null`. TaskCard is NOT a CollapsibleToolCard — keep it as a standalone two-row `<div>`.

**Mobile:** new TaskCard. Same two-row layout. Use a simple `<View>` (not `CollapsibleToolCard` since this card doesn't collapse). Tooltip on mobile: long-press handler → show in a sheet, OR simpler: a chevron icon that opens an inline expandable section. Recommended for v1: long-press shows the trimmed prompt in an alert/modal using `Alert.alert` or a `<Modal>`. Document the trade-off in a code comment.

### Task 9: U7 TaskGroupCard

**Desktop:** custom collapsible (not CollapsibleToolCard). Drop the explicit `<Maximize2/>` and `<Minimize2/>` render — use a `<button>` wrapping the whole header row with `onPress=setOpen(!open)`. No icon. Children rendering unchanged.

**Mobile:** new TaskGroupCard. Custom layout (not CollapsibleToolCard since the children render as their own cards via recursive ToolCardRouter). Use `<Pressable>` for the header. Fix the bug from Plan B Task 1 if not already fixed (read `block.agentId`, `block.taskArgs.description`).

### Task 10: U8 ToolGroupCard

**Desktop:** add `hideToggle`. Move aggregate ErrorDot → into `trailing` (combined `StatusDot` if any child errored — error; else success). Add outer border via `wrapperClassName`.

**Mobile:** new component. Use `CollapsibleToolCard` (compact). Header: `Layers(15) + summary` (e.g. "Read 3 files · Searched 2 patterns"). Body when expanded: itemized list of children (each row = small icon + label).

### Task 11: U9 PlanCard

**Desktop:** add `hideToggle`. Move `ErrorDot` → `StatusDot` in `trailing`. Add outer border. Keep `disabled={!resultText}` behavior.

**Mobile:** new component. `CollapsibleToolCard` (compact, `disabled={!resultText}`). Header: `FileText(15) + "Updated plan"`. Body: pre-wrap `resultText` with `maxHeight: 200`.

### Task 12: U10 AskUserQuestionToolCard (answered/historical)

**Desktop:** add `hideToggle`. Move `StatusDot` into `trailing`. Add outer border. Behavior unchanged otherwise.

**Mobile:** new component. `CollapsibleToolCard` (compact, `disabled={!answered}`). Header: `HelpCircle(15) + question header + " — " + short answer preview`. Body: per-question, render the question text and option badges (selected with `Check` icon + accent background, unselected with muted background).

### Task 13: U11 DefaultToolCard

**Desktop:** add `hideToggle`. Move `StatusDot` into `trailing`. (Outer border already present via `cardStyle`.)

**Mobile:** new component. `CollapsibleToolCard` (primary). Header: `Wrench(15) + toolName`. Body: ARGUMENTS + RESULT sections (uppercase labels, mono-font content) — same shape as desktop, mirror with React Native primitives.

---

## Task 14: Wire mobile ToolCardRouter to dispatch to the new components

**Files:**
- Modify: `packages/mobile/components/chat/tools/index.tsx`

- [ ] **Step 1: Replace the switch body**

Replace each existing `case` in `ToolCardRouter` with a delegation to the new component:

```tsx
import { BashCard } from './BashCard';
import { EditFileCard } from './EditFileCard';
import { WriteFileCard } from './WriteFileCard';
import { ReadFileCard } from './ReadFileCard';
import { SearchCard } from './SearchCard';
import { TaskCard } from './TaskCard';
import { PlanCard } from './PlanCard';
import { AskUserQuestionToolCard } from './AskUserQuestionToolCard';
import { DefaultToolCard } from './DefaultToolCard';

export function ToolCardRouter({ toolCall }: ToolCardRouterProps) {
  const { name, input, result, category } = toolCall;
  if (category === 'hidden') return null;

  const props = { args: input, result: result?.content, isError: result?.isError };

  switch (name) {
    case 'Bash':                return <BashCard {...props} />;
    case 'Edit':                return <EditFileCard {...props} />;
    case 'Write':               return <WriteFileCard {...props} />;
    case 'Read':                return <ReadFileCard {...props} />;
    case 'Glob':
    case 'Grep':                return <SearchCard toolName={name} {...props} />;
    case 'Agent':
    case 'Task':                return <TaskCard {...props} />;
    case 'ExitPlanMode':        return <PlanCard {...props} />;
    case 'AskUserQuestion':     return <AskUserQuestionToolCard {...props} />;
    // Skill rendered via SkillLoadedCard system message; SlashCommandCard fallback
    // is handled by DefaultToolCard for the rare model-driven case.
    default:                    return <DefaultToolCard toolName={name} {...props} />;
  }
}
```

(`_TaskGroup` and `_ToolGroup` virtual types may also need branches — add `TaskGroupCard` and `ToolGroupCard` imports + cases. Pills U12/U14/U15/U16 are handled in Plan D and will be added on top of this switch.)

- [ ] **Step 2: Run mobile tests**

```bash
cd packages/mobile && pnpm test
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/components/chat/tools/index.tsx
git commit -m "refactor(mobile): ToolCardRouter dispatches to U1-U11 components

Replaces the old switch + inline EditCard/BashCard with calls into the
new per-card components. CompactToolPill is no longer the default
fallback — DefaultToolCard takes over."
```

---

## Task 15: Workspace tests + build + changeset

- [ ] **Step 1: Typecheck**

```bash
pnpm --filter @qlan-ro/mainframe-desktop typecheck
cd packages/mobile && pnpm typecheck
```

- [ ] **Step 2: Tests**

```bash
pnpm test
```

- [ ] **Step 3: Build desktop**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

- [ ] **Step 4: Changeset**

```bash
pnpm changeset
```

Select `@qlan-ro/mainframe-desktop` and `@qlan-ro/mainframe-mobile`. Bump: `minor` (visual + behavioral changes across many components, no breaking external API).

Summary:

```
Unified chat-stream tool cards (U1-U11). Status dot moves to trailing
slot. Drop Maximize2/Minimize2 toggle (whole row clickable). Outer
border on compact variants. Edit/Write get Pencil action icon. Read
swaps Eye → FileText + "Read" label. Search restructures pattern into
subheader. TaskCard moves description to subheader with 600-char prompt
tooltip. Mobile gains full content for Read/Search/Plan/AskUserQuestion/
Default cards.
```

- [ ] **Step 5: Commit changeset**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for U1-U11 unified chat-stream cards"
```

---

## Self-Review

- ✅ **Spec coverage:** U1-U11 each get one task pair (desktop tweak + mobile build). DORMANT cards (SlashCommandCard, TaskProgressCard) excluded per spec convention.
- ✅ **Placeholder scan:** Tasks 4-13 use the same pattern as Tasks 2-3 (which are fully expanded). The "follow Task 2/3 pattern" reference is explicit and the per-card spec changes are listed concretely. The diagrams in the spec U-sections provide the exact JSX shapes; engineers must read the U-entry before each task per the explicit instruction.
- ✅ **Type consistency:** `ToolCallProps`, `StatusDot`, `ErrorDot`, `formatTokens`, `formatDuration`, `shortenPath` all named consistently. `ToolCardRouter` switch cases match the daemon-emitted tool names (`Bash`, `Edit`, `Write`, etc.) verified against `Plan A` adapter spec.
- ✅ **Risk note:** Tasks 4-13 are intentionally less verbose than Tasks 2-3 because each card's spec already lives in the audit doc as a complete diagram. If a downstream agent struggles, expand each task to full TDD steps mirroring Task 2/3 — the pattern is identical.
