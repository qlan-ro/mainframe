import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToolRow } from '@/features/chat/messages/turn/ToolRow';
import type { ToolPart, TurnUnit } from '@/features/chat/view-model/turn/types';
import { ActiveDaemonProvider } from '@/features/daemon/active-daemon-context';
import { registerSideChat, unregisterSideChat } from '@/features/side-chat/side-chat-ids';
import { OwnFiles } from '@/features/workspace-chat/OwnFiles';
import { getFileTree } from '@/lib/api/files';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useFilesStore } from '@/store/files';
import { subscribeToFileIntents } from '@/store/intent-subscriber';
import { useLayoutStore } from '@/store/layout';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { FileTree } from '../FileTree';

vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAuiState: (select: (state: unknown) => unknown) =>
    select({
      thread: {},
      threads: {
        threadItems: [
          { id: 'parent', custom: { projectId: 'p1', worktreePath: '/wt/current' } },
          { id: 'other-tab', custom: { projectId: 'p1', worktreePath: '/wt/other' } },
          { id: 'other-project', custom: { projectId: 'p2', worktreePath: '/wt/current' } },
        ],
      },
    }),
}));
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({
    projects: [
      { id: 'p1', path: '/repo' },
      { id: 'p2', path: '/other-repo' },
    ],
  }),
}));
vi.mock('@/lib/api/files', () => ({ getFileTree: vi.fn() }));
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({ disposeDaemonSession: vi.fn() }));
vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { setPort: vi.fn(), connect: vi.fn() } }));
vi.mock('@/lib/lsp', () => ({ rebindLspToActiveDaemon: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/daemon/reset-daemon-scoped-stores', () => ({ resetDaemonScopedStores: vi.fn() }));

const daemon = getActiveDaemon();
const scopeKey = 'p1:/wt/current';
const file = { type: 'file', name: 'a.ts', path: 'src/a.ts' } as const;
const newFile = { type: 'file', name: 'new.ts', path: 'src/new.ts' } as const;
const open = () => isWorkspaceFilesPanelOpen(useWorkspaceFilesPanel.getState().openByScope, scopeKey);
let unsubscribe: () => void;

function RowAction({ path }: { path: string }) {
  const part = {
    type: 'tool-call',
    toolName: 'Read',
    toolCallId: 'file',
    args: { file_path: path },
    argsText: '',
    status: { type: 'complete' },
  } as ToolPart;
  const unit = { key: 'file', part } as TurnUnit;
  return (
    <TooltipProvider>
      <ToolRow unit={unit} part={part} />
    </TooltipProvider>
  );
}

function TreePanel() {
  const visible = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, scopeKey));
  return (
    <div hidden={!visible} data-testid="files-panel">
      <FileTree port={1} projectId="p1" chatId="parent" />
    </div>
  );
}

function show(chatId: string, path: string = file.path) {
  render(
    <ActiveDaemonProvider>
      <OwnFiles chatId={chatId}>
        <RowAction path={path} />
      </OwnFiles>
      <TreePanel />
    </ActiveDaemonProvider>,
  );
}

beforeEach(() => {
  useLayoutStore.setState({ layout: { top: ['chat'], topFlex: {} }, run: null });
  useWorkspaceFilesPanel.setState({ openByScope: {} });
  useFilesStore.setState({ revealTarget: null });
  useActiveBasesStore.getState().setActiveBases({ worktreePath: '/wt/current', projectPath: '/repo' }, scopeKey, {
    projectId: 'p1',
    chatId: 'parent',
    daemonId: daemon.id,
    port: 1,
  });
  vi.mocked(getFileTree)
    .mockReset()
    .mockImplementation(async (_port, _project, directory) =>
      directory === 'src' ? [file] : [{ name: 'src', path: 'src', type: 'directory' }],
    );
  Element.prototype.scrollIntoView = vi.fn();
  registerSideChat('side', 'parent');
  unsubscribe = subscribeToFileIntents();
});

afterEach(() => {
  unsubscribe();
  unregisterSideChat('side');
  setActiveDaemon(daemon);
});

it.each([
  ['side chat', 'side'],
  ['sub-agent tab with its owning chat', 'parent'],
])('opens closed Files and highlights the target from a %s', async (_surface, chatId) => {
  show(chatId);
  expect(open()).toBe(false);
  fireEvent.click(screen.getByTestId('chat-row-open-file-file'));
  expect(await screen.findByTestId('file-tree-row-src/a.ts')).toHaveAttribute('data-highlighted', 'true');
  expect(screen.getByTestId('files-panel')).toBeVisible();
  expect(getFileTree).toHaveBeenCalledWith(1, 'p1', 'src', 'parent');
});

it.each([
  ['another worktree', 'other-tab', file.path],
  ['another project at the same path', 'other-project', file.path],
  ['a missing file', 'parent', 'src/missing.ts'],
  ['the project root outside the current worktree', 'parent', '/repo/src/a.ts'],
])('keeps Files closed for %s', async (_surface, chatId, path) => {
  show(chatId, path);
  await act(async () => fireEvent.click(screen.getByTestId('chat-row-open-file-file')));
  expect(screen.getByTestId('files-panel')).not.toBeVisible();
  expect(screen.queryByTestId('file-tree-row-src/a.ts')).toBeNull();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it('reconciles an already expanded directory before reopening Files and scrolling to the new file', async () => {
  show('parent', newFile.path);
  act(() => useWorkspaceFilesPanel.getState().setOpen(true));
  fireEvent.click(await screen.findByTestId('file-tree-row-src'));
  expect(await screen.findByTestId('file-tree-row-src/a.ts')).toBeVisible();
  act(() => useWorkspaceFilesPanel.getState().setOpen(false));
  expect(screen.queryByTestId('file-tree-row-src/new.ts')).toBeNull();

  vi.mocked(getFileTree).mockImplementation(async (_port, _project, directory) =>
    directory === 'src' ? [file, newFile] : [{ name: 'src', path: 'src', type: 'directory' }],
  );
  const rowsOnOpen: (HTMLElement | null)[] = [];
  const stopWatching = useWorkspaceFilesPanel.subscribe(() => {
    if (open()) rowsOnOpen.push(screen.queryByTestId('file-tree-row-src/new.ts'));
  });
  try {
    fireEvent.click(screen.getByTestId('chat-row-open-file-file'));
    const row = await screen.findByTestId('file-tree-row-src/new.ts');
    expect(row).toBeVisible();
    expect(row).toHaveAttribute('data-highlighted', 'true');
    expect(rowsOnOpen).toEqual([row]);
    await waitFor(() => expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(row));
  } finally {
    stopWatching();
  }
});

it('discards a reveal pending when the daemon switches, even at identical paths', async () => {
  let resolveListing!: (entries: [typeof file]) => void;
  vi.mocked(getFileTree).mockImplementation(async (_port, _project, directory) =>
    directory === 'src'
      ? new Promise((resolve) => {
          resolveListing = resolve;
        })
      : [{ name: 'src', path: 'src', type: 'directory' }],
  );
  show('parent');
  await act(async () => fireEvent.click(screen.getByTestId('chat-row-open-file-file')));
  await act(async () => {
    setActiveDaemon({ ...daemon, id: 'remote', kind: 'remote', baseUrl: 'https://fixture.invalid' });
    resolveListing([file]);
  });
  expect(screen.getByTestId('files-panel')).not.toBeVisible();
  expect(screen.queryByTestId('file-tree-row-src/a.ts')).toBeNull();
});
