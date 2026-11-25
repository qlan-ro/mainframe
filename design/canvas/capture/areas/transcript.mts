// Transcript: rows, markers, times and every state of a turn. The turns are the recording `transcript-rows`.
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import { createTauriChat } from '../../../../packages/e2e/helpers/tauri/setup.js';
import { parkPointer, renameChat, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea, CaptureContext, Crop } from '../types.mts';
import type { Locator, Page } from '../../../../packages/e2e/node_modules/@playwright/test/index.mjs';

const TURNS = [
  'Why does the usage capsule stay at 100% after the weekly reset?',
  'Fix it and add a test.',
  'Set up the follow-ups.',
  'Now explore it with an agent.',
];
const VIEWPORT = { width: 1440, height: 1500 };
/** The chat column, from the session header to the composer. */
const COLUMN: Crop = [316, 48, 824, 1452];

async function seedTurns({ page }: CaptureContext): Promise<void> {
  await seedWorkbench(page);
  for (const turn of TURNS) {
    await sendMessage(page, turn);
    await waitForIdle(page);
  }
  await parkPointer(page);
}

const header = (page: Page, index: number) => page.locator('[data-testid^="chat-work-toggle-"]').nth(index);

/** The last turn is off screen, so the virtualized list has no row for it, until the thread is scrolled to it. */
async function scrollBottom(page: Page): Promise<void> {
  await page.getByTestId('chat-thread-viewport').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
}

async function openTurn(page: Page, toggle: Locator): Promise<void> {
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await toggle.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await parkPointer(page);
}

async function scrollTop(page: Page): Promise<void> {
  await page.getByTestId('chat-thread-viewport').evaluate((el) => el.scrollTo(0, 0));
  await parkPointer(page);
}

const area: CaptureArea = {
  boards: [
    {
      file: 'Chat-Thread',
      title: 'Chat — transcript',
      subtitle: 'One work row per turn, events as pills, times in hover footers (T1–T1g).',
      width: 2600,
    },
    { file: 'Chat-Window', title: 'Chat — populated window', width: 1440, bare: true },
    {
      file: 'Chat-States',
      title: 'Chat — transcript states',
      subtitle: 'Rows opened, markers opened, footers and failures.',
      width: 2600,
    },
    {
      file: 'Chat-States-Failures',
      title: 'Chat — failed work',
      subtitle: 'Failed steps are muted rose (`fail`, S6). Red stays inside terminal text.',
      width: 1900,
    },
  ],
  groups: [
    {
      board: 'Chat-Thread',
      launch: { recordingKey: 'transcript-rows' },
      viewport: VIEWPORT,
      before: stubUsage,
      seed: (ctx) => seedTurns(ctx),
      states: [
        {
          id: 'at-rest',
          caption: '**A thread at rest.** One work row per turn, folded; a retried failure reads “1 failed, retried”.',
          crop: COLUMN,
          setup: async ({ page }) => scrollTop(page),
        },
        {
          id: 'rows',
          caption: '**The work, open.** Glyph, verb, target, receipt; a failed call opens by itself.',
          crop: COLUMN,
          setup: async ({ page }) => openTurn(page, header(page, 1)),
        },
        {
          id: 'markers',
          caption: '**Markers.** Skills, schedules, monitors, worktrees and notifications stay outside the fold.',
          crop: COLUMN,
          setup: async ({ page }) => {
            await page.getByTestId('chat-marker-skill').scrollIntoViewIfNeeded();
            await parkPointer(page);
          },
        },
        {
          id: 'rows-dark',
          caption: '**Dark.**',
          crop: COLUMN,
          theme: 'dark',
          setup: async ({ page }) => openTurn(page, header(page, 1)),
        },
      ],
    },
    {
      // A delegated task came back: its result is in its own row, and the header has no tasks chip (S4, T1f).
      board: 'Chat-Window',
      launch: { recordingKey: 'mcp-delegate' },
      before: stubUsage,
      seed: async ({ page }) => {
        const { atlas } = await seedWorkbench(page);
        const parent = await createTauriChat(page, atlas, 'acceptEdits');
        await sendMessage(page, 'Delegate a race review of the diff to a child chat');
        await page.getByText('The child chat found no data races in the diff.').waitFor({ timeout: 60_000 });
        await waitForIdle(page, 60_000);
        await renameChat(page, parent, 'Race review of the diff');
        await openTurn(page, header(page, 0));
      },
      states: [{ id: 'chat-window' }],
    },
    {
      board: 'Chat-States',
      launch: { recordingKey: 'transcript-rows' },
      viewport: VIEWPORT,
      before: stubUsage,
      seed: (ctx) => seedTurns(ctx),
      states: [
        {
          id: 'diff',
          caption: '**An edit, open.** Ink on the tint; colour only in the +/− column.',
          crop: COLUMN,
          setup: async ({ page }) => {
            await openTurn(page, header(page, 1));
            await page
              .locator('[data-testid^="chat-row-"] > [data-file-path$="codex.ts"] [aria-expanded]')
              .first()
              .click();
            await page.locator('[data-testid^="chat-row-"] > [data-file-path$="codex.test.ts"] [aria-expanded]').click();
            await parkPointer(page);
          },
        },
        {
          id: 'marker-open',
          caption: '**A marker, open.** The skill’s SKILL.md in a card under its pill.',
          crop: COLUMN,
          setup: async ({ page }) => {
            await page.getByTestId('chat-marker-skill').click();
            await page.getByTestId('chat-marker-cronlist').click();
            await parkPointer(page);
          },
        },
        {
          id: 'agent-open',
          caption: '**A sub-agent, open.** Prompt, steps and result; the turn names its agents.',
          crop: COLUMN,
          setup: async ({ page }) => {
            await scrollBottom(page);
            await openTurn(page, page.locator('[data-testid^="chat-work-toggle-"]').last());
            await page.getByTestId('chat-row-toolu_row_agent-toggle').click();
            await parkPointer(page);
          },
        },
        {
          id: 'footer',
          caption: '**The footer.** Time, Copy, Fork and More, on hover or keyboard focus.',
          crop: COLUMN,
          setup: async ({ page }) => {
            await scrollTop(page);
            await page.getByTestId('chat-assistant-message').first().hover();
          },
        },
      ],
    },
    {
      board: 'Chat-States-Failures',
      launch: { recordingKey: 'bash-exit-code' },
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await sendMessage(page, 'Run the test suite, then run a bad command');
        await waitForIdle(page);
        await parkPointer(page);
      },
      states: [
        { id: 'failed-tool', caption: '**A failed step.** The header counts it in rose.', crop: [317, 48, 824, 852] },
        {
          id: 'failed-tool-open',
          caption: '**Opened on it.** An unresolved failure is open; the terminal keeps its own red.',
          crop: [317, 48, 824, 852],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="chat-work-failed-"]').first().click();
            await page.waitForTimeout(2400);
            await parkPointer(page);
          },
        },
      ],
    },
  ],
};

export default area;
