# E2E Composer, Context Usage & Chat Status Tests — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three Playwright E2E test files covering composer attachments, context picker (@mentions + /commands), and chat session bar (status label + context usage).

**Architecture:** Each test file gets its own `launchApp()`/`closeApp()` lifecycle with a seeded test project. Tests use real AI round-trips (Haiku model). The ChatSessionBar needs `data-testid` attributes before the status/context tests can target it.

**Tech Stack:** Playwright, Electron, TypeScript, existing E2E fixtures (`launchApp`, `createTestProject`, `createTestChat`, `chat`, `waitForAIIdle`, `sendMessage`)

---

### Task 1: Add data-testid attributes to ChatSessionBar

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx`

**Step 1: Add four data-testid attributes**

Apply these edits to `ChatSessionBar.tsx`:

1. Root container (line ~95):
```tsx
// BEFORE:
<div className="h-7 flex items-center px-3 text-mf-status bg-mf-panel-bg shrink-0">
// AFTER:
<div data-testid="session-bar" className="h-7 flex items-center px-3 text-mf-status bg-mf-panel-bg shrink-0">
```

2. Adapter label (line ~100):
```tsx
// BEFORE:
<span className="text-mf-text-secondary">{adapterLabel}</span>
// AFTER:
<span data-testid="session-bar-adapter" className="text-mf-text-secondary">{adapterLabel}</span>
```

3. StatusIndicator wrapper (line ~118):
```tsx
// BEFORE:
<div className="flex items-center justify-center px-3">
// AFTER:
<div data-testid="session-bar-status" className="flex items-center justify-center px-3">
```

4. Context usage percentage (line ~135):
```tsx
// BEFORE:
{usagePct > 0 && <span className="text-mf-text-secondary tabular-nums">{usagePct}%</span>}
// AFTER:
{usagePct > 0 && <span data-testid="session-bar-context-pct" className="text-mf-text-secondary tabular-nums">{usagePct}%</span>}
```

**Step 2: Verify build**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx
git commit -m "feat(desktop): add data-testid attributes to ChatSessionBar for E2E"
```

---

### Task 2: Create composer attachment E2E tests

**Files:**
- Create: `packages/e2e/tests/30-composer-attachments.spec.ts`

**Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle } from '../helpers/wait.js';

// Minimal 1x1 red PNG — valid image, tiny payload
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

test.describe('§30 Composer attachments', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let testImagePath: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('attaching an image shows thumbnail in composer', async () => {
    const { page } = fixture;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    const thumb = page.locator('[data-testid="attachment-thumb"]');
    await thumb.waitFor({ timeout: 5_000 });
    await expect(thumb).toBeVisible();
  });

  test('removing attachment clears it from composer', async () => {
    const { page } = fixture;

    // Thumb still visible from prior test
    const thumb = page.locator('[data-testid="attachment-thumb"]');
    await expect(thumb).toBeVisible();

    // Hover to reveal remove button, then click
    const group = thumb.locator('..');
    await group.hover();
    await page.locator('[aria-label="Remove"]').first().click();

    await expect(thumb).not.toBeVisible({ timeout: 3_000 });
  });

  test('sending a message with attachment gets AI response', async () => {
    const { page } = fixture;

    // Re-attach
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="attachment-thumb"]').waitFor({ timeout: 5_000 });

    await sendMessage(page, 'I attached a test image. Reply with just "received".');
    await waitForAIIdle(page, 60_000);

    // Sent message should show image thumbnail
    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.waitFor({ timeout: 10_000 });
    await expect(messageThumb).toBeVisible();
  });
});
```

**Step 2: Run the test**

Run: `cd packages/e2e && npx playwright test tests/30-composer-attachments.spec.ts --reporter=list`
Expected: All 3 tests pass.

**Step 3: Commit**

```bash
git add packages/e2e/tests/30-composer-attachments.spec.ts
git commit -m "test(e2e): composer attachment tests — attach, remove, send with image"
```

---

### Task 3: Create context picker E2E tests

**Files:**
- Create: `packages/e2e/tests/31-composer-context-picker.spec.ts`

**Context the implementor needs:**
- Seeded project has files: `CLAUDE.md`, `index.ts`, `utils.ts`
- `/` in empty composer triggers "skills" filter mode in ContextPickerMenu
- `@` triggers "agents-files" mode; file search needs >= 1 char after `@`
- Items use `data-testid="picker-item-{type}-{identifier}"` (type = command, skill, file, agent)
- Selection uses `mousedown` (not `click`) — see `ContextPickerMenu.tsx` line ~261
- Claude CLI registers `/compact` and `/clear` as custom commands after first API call
- `chat()` helper calls `fill(text)` then Enter — `fill()` sets text instantly, picker regex only matches trailing `@word` or leading `/word`, so full sentences with `@` at the start won't have an open picker when Enter fires

**Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

test.describe('§31 Composer context picker', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
    // Boot CLI so it registers commands/skills
    await chat(fixture.page, 'Reply with just the word "ready".');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('typing / opens picker with commands', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // Claude CLI registers /compact and /clear
    const anyCommand = page.locator('[data-testid^="picker-item-command-"]').first();
    await expect(anyCommand).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
  });

  test('selecting a command inserts it into composer', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const firstCommand = page.locator('[data-testid^="picker-item-command-"]').first();
    await expect(firstCommand).toBeVisible({ timeout: 5_000 });
    await firstCommand.dispatchEvent('mousedown');

    // Composer should contain /<commandName> with trailing space
    await expect(composer).toHaveValue(/^\/\w+ $/, { timeout: 3_000 });

    // Clear for next test
    await composer.fill('');
  });

  test('typing @ with query opens picker with file results', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('@index');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const fileItem = page.locator('[data-testid^="picker-item-file-"]').first();
    await expect(fileItem).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await composer.fill('');
  });

  test('selecting a file inserts @mention into composer', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('@index');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const fileItem = page.locator('[data-testid^="picker-item-file-"]').first();
    await expect(fileItem).toBeVisible({ timeout: 5_000 });
    await fileItem.dispatchEvent('mousedown');

    // Composer should now have @<filepath> with trailing space
    await expect(composer).toHaveValue(/@\S+ $/, { timeout: 3_000 });

    await composer.fill('');
  });

  test('Escape closes the picker', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible({ timeout: 3_000 });
  });

  test('sending message with @mention references the file', async () => {
    // fill() sets text instantly — the @ is at position 0 but text continues with
    // non-@ words, so the picker regex (?:^|\s)@(\S*)$ won't match (last word
    // isn't @-prefixed). Enter sends the message, not picks an item.
    await chat(
      fixture.page,
      '@CLAUDE.md summarize this file in one sentence. Start reply with "Summary:"',
      60_000,
    );

    await expect(
      fixture.page.getByText('Summary:', { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

**Step 2: Run the test**

Run: `cd packages/e2e && npx playwright test tests/31-composer-context-picker.spec.ts --reporter=list`
Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add packages/e2e/tests/31-composer-context-picker.spec.ts
git commit -m "test(e2e): context picker tests — / commands, @ file mentions, Escape"
```

---

### Task 4: Create chat status & context usage E2E tests

**Files:**
- Create: `packages/e2e/tests/32-chat-status-context.spec.ts`

**Context the implementor needs:**
- `ChatSessionBar.tsx` has `data-testid` attrs added in Task 1
- StatusIndicator shows "Thinking" when `processState === 'working'`, nothing when idle
- Context percentage is `Math.min(100, Math.round((lastContextTokensInput / contextWindow) * 100))`
- The `%` span only renders when `usagePct > 0` — it won't be visible before first AI response
- `waitForAIIdle()` waits for `chat-status-working` (in ChatsPanel sidebar dot) to disappear
- We can check "Thinking" text inside `[data-testid="session-bar-status"]` while AI is working
- After a response, `[data-testid="session-bar-context-pct"]` should contain a `%` number

**Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle, chat } from '../helpers/wait.js';

test.describe('§32 Chat status & context usage', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('session bar shows adapter label', async () => {
    const { page } = fixture;

    const adapterLabel = page.locator('[data-testid="session-bar-adapter"]');
    await expect(adapterLabel).toBeVisible({ timeout: 5_000 });
    await expect(adapterLabel).toHaveText('Claude');
  });

  test('status shows "Thinking" while AI is working', async () => {
    const { page } = fixture;

    // Send a message that takes a moment to process
    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');

    // Check for "Thinking" in the status area — may appear briefly
    const statusArea = page.locator('[data-testid="session-bar-status"]');
    await expect(statusArea.getByText('Thinking')).toBeVisible({ timeout: 10_000 });

    // Wait for completion
    await waitForAIIdle(page, 60_000);
  });

  test('context usage percentage appears after AI response', async () => {
    const { page } = fixture;

    // After the first AI response, context usage should be non-zero
    const pct = page.locator('[data-testid="session-bar-context-pct"]');
    await expect(pct).toBeVisible({ timeout: 5_000 });
    const text = await pct.textContent();
    expect(text).toMatch(/^\d+%$/);
  });

  test('context usage increases with conversation length', async () => {
    const { page } = fixture;

    // Record current percentage
    const pct = page.locator('[data-testid="session-bar-context-pct"]');
    const beforeText = await pct.textContent();
    const beforeValue = parseInt(beforeText!.replace('%', ''), 10);

    // Send a longer message to grow context
    await chat(page, 'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.', 90_000);

    // Percentage should have increased
    await expect(pct).toBeVisible();
    const afterText = await pct.textContent();
    const afterValue = parseInt(afterText!.replace('%', ''), 10);
    expect(afterValue).toBeGreaterThan(beforeValue);
  });
});
```

**Step 2: Run the test**

Run: `cd packages/e2e && npx playwright test tests/32-chat-status-context.spec.ts --reporter=list`
Expected: All 4 tests pass.

**Step 3: Commit**

```bash
git add packages/e2e/tests/32-chat-status-context.spec.ts
git commit -m "test(e2e): chat status label and context usage progress tests"
```

---

### Task 5: Final verification and PR

**Step 1: Run all three test files together**

Run: `cd packages/e2e && npx playwright test tests/30-composer-attachments.spec.ts tests/31-composer-context-picker.spec.ts tests/32-chat-status-context.spec.ts --reporter=list`
Expected: All 13 tests pass (3 + 6 + 4).

**Step 2: Typecheck the desktop package**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Build succeeds.

**Step 3: Create PR**

Push branch and create PR with summary of all three test files and the ChatSessionBar data-testid additions.
