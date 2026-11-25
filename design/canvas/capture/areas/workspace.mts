// Workspace: its tabs, the chats and agents that open in it, files, viewers, run output and errors.
// Workspace-Branch and Workspace-ReviewStates are older captures (README, Known limits).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import { createTauriChat } from '../../../../packages/e2e/helpers/tauri/setup.js';
import { openWork } from '../../../../packages/e2e/helpers/tauri/transcript.js';
import {
  escape,
  fail,
  openTab,
  openWorkspaceFiles,
  parkPointer,
  renameChat,
  seedWorkbench,
  stubUsage,
  WORKSPACE_FILES,
} from '../seed.mts';
import { WORK_DIR } from '../isolation.mts';
import type { CaptureArea, CaptureContext } from '../types.mts';

const TAB_FILES = ['use-quota.ts', 'CLAUDE.md', 'quota.rs', 'UsageCapsule.tsx'];

const NOTES = `# Quota windows

Every provider reports **two** windows.

| Window | Resets | Shown as |
| --- | --- | --- |
| Session | every 5 hours | \`5-hour\` |
| Weekly | Monday 09:00 | \`Weekly\` |

- [x] Read the reset time from the provider
- [ ] Warn at 80 %

\`\`\`ts
export const useQuota = () => ({ percent: 42 });
\`\`\`
`;

const VIEWER_FILES: Record<string, string> = {
  ...WORKSPACE_FILES,
  'docs/quota.md': NOTES,
  'usage.csv': 'provider,window,percent,resets\nClaude,session,42,3h\nClaude,weekly,61,2d 4h\nCodex,session,18,4h\n',
  'logo.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" rx="24" fill="#0b6fdc"/><circle cx="120" cy="80" r="44" fill="#fff"/></svg>\n',
};

/** A session whose reply is done, in atlas-web, with its tab kept. */
async function talkedSession(ctx: CaptureContext, prompt: string, title: string): Promise<string> {
  const { page } = ctx;
  const { atlas, chats } = await seedWorkbench(page, WORKSPACE_FILES);
  const id = await createTauriChat(page, atlas, 'acceptEdits');
  await sendMessage(page, prompt);
  await waitForIdle(page, 60_000);
  await renameChat(page, id, title);
  await openTab(page, id);
  ctx.vars['chat'] = id;
  ctx.vars['other'] = chats[3]!;
  await parkPointer(page);
  return id;
}

/** One file open with the docked tree. */
async function fileBesideTree(page: CaptureContext['page'], file: string): Promise<void> {
  await openWorkspaceFiles(page, [file]);
  await parkPointer(page);
}

const area: CaptureArea = {
  boards: [
    {
      file: 'Workspace-Chats',
      title: 'Workspace — chats beside the conversation',
      subtitle: 'Every secondary chat is a workspace tab (W9). The chat column holds one conversation.',
      width: 3100,
    },
    {
      file: 'Workspace-Agent',
      title: 'Workspace — agent tab',
      subtitle: 'A sub-agent or a delegated task: title, kind, status, Stop while live, brief, steps, result (W8).',
      width: 3100,
    },
    {
      file: 'Chat-SideChat',
      title: 'Workspace — side chat',
      subtitle: 'The side chat is a workspace tab (W9). Closing the tab keeps it; Discard deletes it, and asks first.',
      width: 3100,
    },
    {
      file: 'Workspace-Tabs',
      title: 'Workspace — tabs in the title bar',
      subtitle: 'The title bar’s workspace segment: tabs, `+`, Files (W2, W3).',
      width: 2300,
    },
    {
      file: 'Workspace-Files',
      title: 'Workspace — files and editor',
      subtitle: 'A file beside the docked tree (W2, W3).',
      width: 3100,
    },
    {
      file: 'Workspace-Viewers',
      title: 'Workspace — file viewers',
      subtitle: 'What is not code opens in a viewer.',
      width: 2000,
    },
    {
      file: 'Workspace-Run',
      title: 'Workspace — empty, process and URL entry',
      subtitle: 'Terminals and previews are native views the capture has no source for.',
      width: 3100,
    },
    {
      file: 'Workspace-Review',
      title: 'Workspace — review changes',
      subtitle: 'The review of the session’s changes.',
      width: 1600,
    },
    {
      file: 'Workspace-ReviewError',
      title: 'Workspace — review could not load',
      subtitle: 'The error is muted rose (`fail`, S6).',
      width: 1600,
    },
  ],
  groups: [
    {
      board: 'Workspace-Chats',
      launch: { recordingKey: 'messaging', mockFork: true },
      before: stubUsage,
      seed: async (ctx) => {
        await talkedSession(ctx, 'What is 2 + 2? Reply with just the number.', 'Where is greeting defined?');
      },
      states: [
        {
          id: 'fork-tab',
          caption:
            '**A fork, beside its parent.** “Fork from here” opens it as a tab; the parent stays the conversation and the session panel parks (W6). The header moves it to the chat column, or opens its side chat.',
          setup: async ({ page }) => {
            await page.getByTestId('chat-assistant-message').first().hover();
            await page.getByTestId('chat-assistant-message-fork').first().click();
            await page
              .locator('[data-testid^="workspace-conversation-chat-"] [data-testid="chat-user-message"]')
              .first()
              .waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
        {
          id: 'fork-tab-dark',
          caption: '**Dark.**',
          theme: 'dark',
        },
        {
          id: 'session-menu',
          caption: '**Any session can open here**: ⌘-click, a drag, ⌘⇧\\, or this menu.',
          crop: [300, 0, 720, 420],
          setup: async ({ page, vars }) => {
            await openTab(page, vars['other']!);
            await openTab(page, vars['chat']!);
            await page.getByTestId(`session-tab-${vars['other']}`).click({ button: 'right' });
            await page.getByTestId('session-tab-ctx-open-workspace').waitFor();
          },
        },
        {
          id: 'session-tab',
          caption:
            '**Two chats in the workspace.** A fork and a session, each with its glyph. The sidebar tints the one that shows.',
          setup: async ({ page }) => {
            await page.getByTestId('session-tab-ctx-open-workspace').click();
            await page.locator('[data-testid^="workspace-tab-chat-"]').nth(1).waitFor();
            await parkPointer(page);
          },
          wait: 900,
        },
        {
          id: 'drop-target',
          caption: '**Dragging a session tab.** Its drop target is the half of the chat where the workspace opens.',
          crop: [317, 0, 560, 640],
          setup: async ({ page, vars }) => {
            const tab = (await page.getByTestId(`session-tab-${vars['other']}`).boundingBox())!;
            await page.mouse.move(tab.x + 40, tab.y + 12);
            await page.mouse.down();
            await page.mouse.move(tab.x + 60, tab.y + 40, { steps: 4 });
            const target = page.getByTestId('session-drop-workspace');
            await target.waitFor();
            const box = (await target.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 4 });
          },
        },
      ],
    },
    {
      board: 'Workspace-Chats',
      launch: { recordingKey: 'messaging', mockFork: true },
      viewport: { width: 1180, height: 800 },
      before: stubUsage,
      seed: async (ctx) => {
        await talkedSession(ctx, 'What is 2 + 2? Reply with just the number.', 'Where is greeting defined?');
      },
      states: [
        {
          id: 'fork-1180',
          caption: '**1180 px.** Half the area right of the sidebar, never under 320 px; the chat keeps 360 (W4).',
          setup: async ({ page }) => {
            await page.getByTestId('chat-assistant-message').first().hover();
            await page.getByTestId('chat-assistant-message-fork').first().click();
            await page
              .locator('[data-testid^="workspace-conversation-chat-"] [data-testid="chat-user-message"]')
              .first()
              .waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
      ],
    },
    {
      board: 'Workspace-Agent',
      launch: { recordingKey: 'task-subagent' },
      before: stubUsage,
      seed: async (ctx) => {
        const { page } = ctx;
        await talkedSession(ctx, 'Delegate finding the greeting export to a subagent', 'Find the greeting export');
        await sendMessage(page, 'Thanks — what did it find?');
        await waitForIdle(page, 60_000);
        await renameChat(page, ctx.vars['chat']!, 'Find the greeting export');
      },
      states: [
        {
          id: 'subagent-done',
          caption: '**A sub-agent.** From “Open in workspace” on its row, or from the Activity section. Read-only.',
          setup: async ({ page }) => {
            await openWork(page, 0);
            await page.locator('[data-testid^="chat-task-open-"]').click();
            await page.locator('[data-testid^="workspace-agent-result-"]').waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
        { id: 'subagent-dark', caption: '**Dark.**', crop: [860, 0, 580, 640], theme: 'dark' },
      ],
    },
    {
      board: 'Workspace-Agent',
      launch: { recordingKey: 'mcp-delegate-stop' },
      before: stubUsage,
      seed: async (ctx) => {
        const { page } = ctx;
        const { atlas } = await seedWorkbench(page, WORKSPACE_FILES);
        const id = await createTauriChat(page, atlas, 'acceptEdits');
        await sendMessage(page, 'Delegate a long task, I will stop you after');
        await page
          .locator('[data-testid="chat-tool-delegate-task-card-receipt"] [data-status="running"]')
          .waitFor({ timeout: 60_000 });
        await renameChat(page, id, 'Race review of the diff');
      },
      states: [
        {
          id: 'task-running',
          caption:
            '**A delegated task, running.** Its robot is filled, its kind line names the provider (T1c), and Stop is immediate (K4).',
          setup: async ({ page }) => {
            await page.locator('[data-testid^="chat-tool-delegate-task-open-"]').click();
            await page.locator('[data-testid^="workspace-chat-stop-"]').waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
        {
          id: 'task-stopped',
          caption: '**Stopped.** The status says so and Stop goes.',
          crop: [860, 0, 580, 320],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-chat-stop-"]').click();
            await page
              .locator('[data-testid^="workspace-chat-status-"][data-status="cancelled"]')
              .waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
      ],
    },
    {
      board: 'Workspace-Agent',
      launch: { recordingKey: 'mcp-delegate' },
      before: stubUsage,
      seed: async (ctx) => {
        const { page } = ctx;
        const { atlas } = await seedWorkbench(page, WORKSPACE_FILES);
        const id = await createTauriChat(page, atlas, 'acceptEdits');
        await sendMessage(page, 'Delegate a race review of the diff to a child chat');
        await page.getByTestId('chat-absorbed-message').waitFor({ state: 'attached', timeout: 60_000 });
        await waitForIdle(page, 60_000);
        await renameChat(page, id, 'Race review of the diff');
      },
      states: [
        {
          id: 'task-done',
          caption:
            '**A delegated task, done.** Its own chat: the prompt it was given is the brief, its last message the result.',
          setup: async ({ page }) => {
            await openWork(page, 0);
            await page.locator('[data-testid^="chat-tool-delegate-task-open-"]').first().click();
            await page
              .locator('[data-testid^="workspace-chat-status-"][data-status="completed"]')
              .waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 900,
        },
      ],
    },
    {
      board: 'Chat-SideChat',
      launch: { recordingKey: 'messaging' },
      before: stubUsage,
      seed: async (ctx) => {
        await talkedSession(ctx, 'What is 2 + 2? Reply with just the number.', 'Where is greeting defined?');
      },
      states: [
        {
          id: 'side-chat-tab',
          caption:
            '**Side chat, in its tab.** The header’s side-chat button opens it, and takes the tab away again while it is in front.',
          setup: async ({ page, vars }) => {
            await page.getByTestId(`side-chat-toggle-${vars['chat']}`).click();
            await page.locator('[data-testid^="side-chat-header-"]').waitFor();
            await parkPointer(page);
          },
          wait: 900,
        },
        { id: 'side-chat-dark', caption: '**Dark.**', crop: [860, 0, 580, 900], theme: 'dark' },
        {
          id: 'side-chat-discard',
          caption: '**Discard asks first.** It is the only action that deletes the side chat.',
          setup: async ({ page }) => {
            await page.locator('[data-testid^="side-chat-discard-"]').click();
            await page.getByTestId('side-chat-discard-dialog').waitFor();
          },
          wait: 600,
        },
        {
          id: 'side-chat-hidden',
          caption: '**Tab closed.** The side chat, and a message typed but not sent, are kept; the button stays blue.',
          crop: [317, 48, 1123, 180],
          setup: async ({ page, vars }) => {
            await page.getByTestId('side-chat-discard-dialog').getByRole('button', { name: 'Cancel' }).click();
            await page.getByTestId(`side-chat-toggle-${vars['chat']}`).click();
            await page.getByTestId('workspace-surface').waitFor({ state: 'detached' });
            await parkPointer(page);
          },
          wait: 900,
        },
      ],
    },
    {
      board: 'Workspace-Files',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, VIEWER_FILES);
        await openTab(page, chats.at(-1)!);
        await fileBesideTree(page, 'UsageCapsule.tsx');
        await page.getByTestId('workspace-files-open').click();
        await parkPointer(page);
      },
      states: [
        { id: 'file-tree', caption: '**A file and the docked tree** (W3). The tree pushes the content.', wait: 1_200 },
        { id: 'file-tree-dark', caption: '**Dark.**', theme: 'dark' },
      ],
    },
    {
      board: 'Workspace-Viewers',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, VIEWER_FILES);
        await openTab(page, chats.at(-1)!);
      },
      states: [
        {
          id: 'viewer-markdown',
          caption: '**Markdown.**',
          crop: [860, 0, 580, 640],
          setup: ({ page }) => fileBesideTree(page, 'quota.md'),
          wait: 1_200,
        },
        {
          id: 'viewer-csv',
          caption: '**CSV.**',
          crop: [860, 0, 580, 640],
          setup: ({ page }) => fileBesideTree(page, 'usage.csv'),
          wait: 1_200,
        },
        {
          id: 'viewer-svg',
          caption: '**SVG.**',
          crop: [860, 0, 580, 640],
          // The file picker leaves images out, so the tree opens it.
          setup: async ({ page }) => {
            await page.getByTestId('workspace-files-open').click();
            await page.getByTestId('file-tree-row-logo.svg').dblclick();
            await page.getByTestId('viewer-svg').waitFor();
            await page.getByTestId('workspace-files-collapse').click();
            await parkPointer(page);
          },
          wait: 1_200,
        },
      ],
    },
    {
      board: 'Workspace-Run',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, {
          ...WORKSPACE_FILES,
          '.mainframe/launch.json': JSON.stringify({
            version: '1.0',
            configurations: [
              { name: 'worker', runtimeExecutable: 'sh', runtimeArgs: ['-c', 'echo listening on 8080; sleep 600'] },
              { name: 'typecheck', runtimeExecutable: 'true', runtimeArgs: [] },
            ],
          }),
        });
        await openTab(page, chats.at(-1)!);
      },
      states: [
        {
          id: 'run-empty',
          caption:
            '**Opened with nothing in it (W5).** Closing the last tab collapses the workspace instead of showing this.',
          setup: async ({ page }) => {
            await page.getByTestId('surface-rail-workspace').click();
            await page.getByTestId('workspace-empty-state').waitFor();
            await parkPointer(page);
          },
          wait: 900,
        },
        {
          id: 'run-console',
          caption: '**A launched process.** Its output fills the panel; the tab has its Stop (W7).',
          setup: async ({ page }) => {
            await page.getByTestId('workspace-picker-launch-worker').click();
            await page.locator('[data-testid^="workspace-tab-stop-"]').waitFor({ timeout: 15_000 });
            await parkPointer(page);
          },
          wait: 1_500,
        },
        {
          id: 'run-url-entry',
          caption: '**URL…** The entry takes the tabs’ place: a native webview would cover a floating one (W7).',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-tab-strip-add-"]').click();
            await page.locator('[data-testid^="workspace-pane-open-url-"]').click();
            await page.getByTestId('workspace-url-entry-input').waitFor();
          },
          wait: 600,
        },
      ],
    },
    {
      board: 'Workspace-Tabs',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, {
          ...WORKSPACE_FILES,
          '.mainframe/launch.json': JSON.stringify({
            version: '1.0',
            configurations: [
              { name: 'ui-dev', runtimeExecutable: 'sleep', runtimeArgs: ['600'] },
              { name: 'typecheck', runtimeExecutable: 'true', runtimeArgs: [] },
            ],
          }),
        });
        await openTab(page, chats.at(-1)!);
      },
      states: [
        {
          id: 'workspace-empty',
          caption: '**Nothing open.** `+` and Files stay in the title bar; the panel is the empty state.',
          crop: [780, 0, 660, 640],
          setup: async ({ page }) => {
            await page.getByTestId('surface-rail-workspace').click();
            await page.getByTestId('workspace-empty-state').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'workspace-add-menu',
          caption: '**The `+` menu.** A file, a terminal (⌘J), a URL (⌘T) or a launch configuration.',
          crop: [780, 0, 660, 640],
          setup: async ({ page }) => {
            await page.getByTestId('workspace-tab-strip-add-empty').click();
            await page.getByTestId('workspace-add-menu-empty').waitFor();
          },
        },
        {
          id: 'workspace-tabs',
          caption: '**Four tabs.** The selected one keeps its whole title; the others shrink to 60 px.',
          crop: [780, 0, 660, 260],
          setup: async ({ page }) => {
            await escape(page);
            await openWorkspaceFiles(page, TAB_FILES);
            await parkPointer(page);
          },
        },
        {
          id: 'workspace-tab-hover',
          caption: '**Hover.** The close button lies over the end of the title, so it takes no space.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => page.locator('[data-testid^="workspace-tab-"][role="tab"]').first().hover(),
          wait: 800,
        },
        {
          id: 'workspace-tabs-overflow',
          caption: '**Overflow.** In a narrow panel the row scrolls, and the selected tab stays in view.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-tab-"][role="tab"]').first().click();
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(1010, 500, { steps: 4 });
            await page.mouse.up();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'workspace-narrow',
          caption: '**320 px panel.** A selected title longer than the row fades at its end; its close button stays.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-tab-"][role="tab"]').last().click();
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(1400, 500, { steps: 4 });
            await page.mouse.up();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'workspace-files',
          caption: '**Files on.** The toggle keeps a soft fill while the tree is docked.',
          crop: [780, 0, 660, 360],
          setup: async ({ page }) => {
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(800, 500, { steps: 4 });
            await page.mouse.up();
            await page.getByTestId('workspace-files-open').click();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Workspace-Review',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, WORKSPACE_FILES);
        const project = path.join(WORK_DIR, 'projects', 'atlas-web');
        writeFileSync(
          path.join(project, 'quota.rs'),
          'pub fn percent(now: u64, resets: u64) -> u8 {\n    if now >= resets {\n        return 0;\n    }\n    42\n}\n',
        );
        writeFileSync(path.join(project, 'notes.md'), '# Notes\n\nCheck the weekly reset.\n');
        await openTab(page, chats.at(-1)!);
      },
      states: [
        {
          id: 'review',
          caption: '**Review changes** (⌘⇧R).',
          setup: async ({ page }) => {
            await page.keyboard.press('ControlOrMeta+Shift+R');
            await page.getByRole('dialog').getByText('quota.rs').first().waitFor();
            await parkPointer(page);
          },
          wait: 1_500,
        },
      ],
    },
    {
      board: 'Workspace-ReviewError',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /\/git\/status(\?|$)/, 'not a git repository');
      },
      seed: async ({ page }) => {
        await seedWorkbench(page);
      },
      states: [
        {
          id: 'review-load-error',
          caption: '**Review could not read the repository.**',
          setup: async ({ page }) => {
            await page.keyboard.press('ControlOrMeta+Shift+R');
            await page.getByTestId('review-load-error').waitFor();
          },
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
