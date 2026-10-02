import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { FileTreeNode } from '../FileTreeNode';

vi.mock('@/lib/api/files', () => ({ getFileTree: vi.fn() }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => true }));

const folder: FileTreeEntry = { name: 'src', path: 'src', type: 'directory' };
const file: FileTreeEntry = { name: 'index.ts', path: 'index.ts', type: 'file' };
const child: FileTreeEntry = { name: 'child.ts', path: 'src/child.ts', type: 'file' };

function renderRows(entries = [folder, file]) {
  render(
    <>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          port={1}
          projectId="project"
          base="/workspace"
          revealPath={null}
          activeFilePath={null}
        />
      ))}
    </>,
  );
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function hover(name: string) {
  fireEvent.pointerMove(screen.getByText(name), { pointerType: 'mouse' });
}

function leave(name: string) {
  fireEvent.pointerLeave(screen.getByText(name), { pointerType: 'mouse' });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getFileTree).mockResolvedValue([child]);
  vi.mocked(emitSurfaceIntent).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([folder, file])('delays the full path for $type rows until 500ms', async (entry) => {
  renderRows([entry]);
  hover(entry.name);
  await advance(499);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  await advance(1);
  expect(screen.getByRole('tooltip')).toHaveTextContent(`/workspace/${entry.path}`);
  expect(screen.getByText(entry.name)).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
});

it('cancels an early departure and restarts the delay across rows', async () => {
  renderRows();
  hover('src');
  await advance(300);
  leave('src');
  hover('index.ts');
  await advance(300);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  leave('index.ts');
  await advance(500);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('requires a fresh delay when returning to an opened row through another row', async () => {
  renderRows();
  hover('src');
  await advance(500);
  expect(screen.getByRole('tooltip')).toHaveTextContent('/workspace/src');
  leave('src');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  hover('index.ts');
  await advance(100);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  leave('index.ts');
  hover('src');
  await advance(499);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  await advance(1);
  expect(screen.getByRole('tooltip')).toHaveTextContent('/workspace/src');
});

it.each([folder, file])('keeps $type path content pointer-transparent and dismisses on leave', async (entry) => {
  renderRows([entry]);
  hover(entry.name);
  await advance(500);
  expect(screen.getByRole('tooltip').closest('[data-slot="tooltip-content"]')).toHaveClass('pointer-events-none');
  leave(entry.name);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('expands and collapses on the first click before and after its hint opens', async () => {
  renderRows();
  fireEvent.click(screen.getByText('src'));
  await advance(0);
  expect(screen.getByTestId('file-tree-row-src/child.ts')).toBeInTheDocument();
  fireEvent.click(screen.getByText('src'));
  expect(screen.queryByTestId('file-tree-row-src/child.ts')).not.toBeInTheDocument();
  hover('src');
  await advance(500);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.click(screen.getByText('src'));
  await advance(0);
  expect(screen.getByTestId('file-tree-row-src/child.ts')).toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  leave('src');
  hover('src');
  await advance(500);
  fireEvent.click(screen.getByText('src'));
  expect(screen.queryByTestId('file-tree-row-src/child.ts')).not.toBeInTheDocument();
});

it('opens a file on the first click before and after its hint opens', async () => {
  renderRows();
  fireEvent.click(screen.getByText('index.ts'));
  expect(emitSurfaceIntent).toHaveBeenLastCalledWith({ type: 'open-file', path: 'index.ts' });
  hover('index.ts');
  await advance(500);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.click(screen.getByText('index.ts'));
  expect(emitSurfaceIntent).toHaveBeenCalledTimes(2);
  expect(emitSurfaceIntent).toHaveBeenLastCalledWith({ type: 'open-file', path: 'index.ts' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('retains row tab stops and keyboard activation without focusing inner labels', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  renderRows();
  await user.tab();
  expect(screen.getByTestId('file-tree-row-src')).toHaveFocus();
  expect(screen.getByText('src')).not.toHaveAttribute('tabindex');
  await user.keyboard('{Enter}');
  expect(screen.getByTestId('file-tree-row-src/child.ts')).toBeInTheDocument();
  await user.keyboard(' ');
  expect(screen.queryByTestId('file-tree-row-src/child.ts')).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByTestId('file-tree-row-index.ts')).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'index.ts' });
});

it('dismisses a visible path hint with Escape', async () => {
  renderRows();
  hover('src');
  await advance(500);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
