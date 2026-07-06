// packages/app-tauri/src/features/palette/__tests__/use-spotlight-results.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { parseQuery } from '../palette-modes';

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({ searchFiles: (...a: unknown[]) => mockSearchFiles(...a) }));
const mockGitStatus = vi.fn();
vi.mock('@/lib/api/git', () => ({ getGitStatus: (...a: unknown[]) => mockGitStatus(...a) }));
const mockSymbols = vi.fn().mockReturnValue({ symbols: [], loading: false });
vi.mock('../use-workspace-symbols', () => ({ useWorkspaceSymbols: (a: unknown) => mockSymbols(a) }));
const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

const { useSpotlightResults } = await import('../use-spotlight-results');

const sessions = [
  { id: 's1', remoteId: 's1', title: 'Build the palette' },
  { id: 's2', remoteId: 's2', title: 'Fix the editor' },
] as unknown as SessionItem[];

beforeEach(() => {
  mockSearchFiles.mockReset();
  mockGitStatus.mockReset();
  mockEmit.mockReset();
});

describe('useSpotlightResults', () => {
  it('file mode: filters sessions by title and includes file rows (not re-filtered)', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'z.ts', path: 'src/z.ts', type: 'file', exact: false }]);
    const { result } = renderHook(() =>
      useSpotlightResults({
        parsed: parseQuery('palette'),
        port: 1,
        projectId: 'p',
        sessions,
        switchToThread: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'file')).toBe(true));
    const types = result.current.rows.map((r) => r.type);
    // Only the title-matching session survives; the unrelated file row is kept verbatim.
    expect(result.current.rows.filter((r) => r.type === 'session').map((r) => r.id)).toEqual(['s1']);
    expect(result.current.rows.find((r) => r.type === 'file')?.id).toBe('src/z.ts');
    expect(types).toContain('file');
  });

  it('command mode: returns filtered command rows', () => {
    const { result } = renderHook(() =>
      useSpotlightResults({
        parsed: parseQuery('> settings'),
        port: 1,
        projectId: 'p',
        sessions,
        switchToThread: vi.fn(),
      }),
    );
    expect(result.current.rows.map((r) => r.id)).toEqual(['settings']);
    expect(result.current.rows[0]!.type).toBe('command');
  });

  it('changes mode: maps git status to change rows with status label', async () => {
    mockGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('#'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'change')).toBe(true));
    const row = result.current.rows.find((r) => r.type === 'change')!;
    expect(row.id).toBe('src/a.ts');
    expect(row.status).toBe('M');
  });

  it('session row run() switches thread and activates chat', () => {
    const switchToThread = vi.fn();
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery(''), port: 1, projectId: 'p', sessions, switchToThread }),
    );
    result.current.rows.find((r) => r.type === 'session')!.run();
    expect(switchToThread).toHaveBeenCalledWith('s1');
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'chat' });
  });

  it('file row run() emits open-file intent', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'z.ts', path: 'src/z.ts', type: 'file', exact: false }]);
    const { result } = renderHook(() =>
      useSpotlightResults({
        parsed: parseQuery('palette'),
        port: 1,
        projectId: 'p',
        sessions,
        switchToThread: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'file')).toBe(true));
    result.current.rows.find((r) => r.type === 'file')!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/z.ts' });
  });

  it('symbol row run() emits open-file intent with line and character', async () => {
    mockSymbols.mockReturnValue({ symbols: [{ name: 'Foo', kind: 12, path: 'src/Foo.ts', line: 4 }], loading: false });
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('@Foo'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'symbol')).toBe(true));
    result.current.rows.find((r) => r.type === 'symbol')!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/Foo.ts', line: 4, character: 0 });
    mockSymbols.mockReturnValue({ symbols: [], loading: false });
  });

  it('change row run() emits open-diff intent', async () => {
    mockGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('#'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'change')).toBe(true));
    result.current.rows.find((r) => r.type === 'change')!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-diff', path: 'src/a.ts' });
  });
});
