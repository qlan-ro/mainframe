/**
 * TagPopoverHost — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. Closed by default: target===null → sessions-tag-popover-stub absent (open=false).
 *  2. Opens for a target: open('t1', ['alpha','beta']) → stub present; capturedProps has
 *     open=true, chatId='t1', port=31415, currentTags=['alpha','beta'].
 *  3. Threads passed as snapshots: capturedProps.threads deep-equals the fixed two-item
 *     list (id + custom.tags only).
 *  4. onClose clears target: calling capturedProps.onClose() → target===null; stub gone.
 *  5. onCascade applies setChatTags per update + reloads: one update → setChatTagsSpy
 *     called once with (31415,'t1',['alpha2','beta']); reloadSpy called once afterward.
 *  6. onCascade empty list → no setChatTags, no reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { TagRegistry } from '../use-tag-registry';
import type { TagCascadeUpdate } from '../build-tag-cascade';

// ---------------------------------------------------------------------------
// Captured props — set by the TagPopover stub below
// ---------------------------------------------------------------------------

interface CapturedTagPopoverProps {
  open: boolean;
  chatId: string;
  port: number;
  currentTags: string[];
  threads: { id: string; custom: { tags: string[] } }[];
  onClose: () => void;
  onCascade: (updates: TagCascadeUpdate[]) => void;
  registry: TagRegistry;
}

let capturedProps: CapturedTagPopoverProps | null = null;

// ---------------------------------------------------------------------------
// Fake AUI state fixture — fixed threadItems
// ---------------------------------------------------------------------------

const fakeAuiState = {
  threads: {
    threadItems: [
      { id: 't1', remoteId: 't1', custom: { tags: ['alpha', 'beta'] } },
      { id: 't2', remoteId: 't2', custom: { tags: ['gamma'] } },
    ],
  },
};

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

const setChatTagsSpy = vi.fn();
const reloadSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../use-tag-registry', () => ({
  useTagRegistry: () =>
    ({
      tags: [],
      loading: false,
      refresh: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      colorOf: vi.fn().mockReturnValue('blue' as const),
    }) satisfies TagRegistry,
}));

vi.mock('@/lib/api/tags', () => ({
  setChatTags: (...args: Parameters<typeof setChatTagsSpy>) => setChatTagsSpy(...args),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof fakeAuiState) => unknown) => sel(fakeAuiState),
  useAssistantRuntime: () => ({
    threads: { reload: reloadSpy },
  }),
}));

vi.mock('../TagPopover', () => ({
  TagPopover: (props: CapturedTagPopoverProps) => {
    capturedProps = props;
    return props.open ? <div data-testid="sessions-tag-popover-stub" /> : null;
  },
}));

// ---------------------------------------------------------------------------
// Import under test — AFTER mocks
// ---------------------------------------------------------------------------

import { TagPopoverHost } from '../TagPopoverHost';
import { useTagPopoverTarget } from '../use-tag-popover-target';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedProps = null;
  vi.clearAllMocks();
  setChatTagsSpy.mockResolvedValue([]);
  reloadSpy.mockResolvedValue(undefined);
  // Ensure the store starts closed before each test
  act(() => {
    useTagPopoverTarget.getState().close();
  });
});

// ---------------------------------------------------------------------------
// 1. Closed by default
// ---------------------------------------------------------------------------

describe('TagPopoverHost — closed by default', () => {
  it('sessions-tag-popover-stub is absent when target is null', () => {
    render(<TagPopoverHost port={31415} />);
    expect(screen.queryByTestId('sessions-tag-popover-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Opens for a target
// ---------------------------------------------------------------------------

describe('TagPopoverHost — opens for a target', () => {
  it('renders the stub and passes correct props after open("t1", ["alpha","beta"])', () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['alpha', 'beta'], null);
    });

    expect(screen.getByTestId('sessions-tag-popover-stub')).toBeTruthy();
    expect(capturedProps?.open).toBe(true);
    expect(capturedProps?.chatId).toBe('t1');
    expect(capturedProps?.port).toBe(31415);
    expect(capturedProps?.currentTags).toEqual(['alpha', 'beta']);
  });
});

// ---------------------------------------------------------------------------
// 2b. Live tags override stale snapshot (regression: host must not forward snapshot)
// ---------------------------------------------------------------------------

describe('TagPopoverHost — currentTags reflects live thread data, not the open() snapshot', () => {
  it('passes live tags ["alpha","beta"] when opened with stale snapshot ["stale-snapshot-only"] for t1', () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['stale-snapshot-only'], null);
    });

    expect(capturedProps?.currentTags).toEqual(['alpha', 'beta']);
  });
});

// ---------------------------------------------------------------------------
// 3. Threads passed as snapshots (id + custom.tags only)
// ---------------------------------------------------------------------------

describe('TagPopoverHost — threads prop is a snapshot of live thread items', () => {
  it('capturedProps.threads deep-equals the two-item fixture', () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['alpha', 'beta'], null);
    });

    expect(capturedProps?.threads).toEqual([
      { id: 't1', custom: { tags: ['alpha', 'beta'] } },
      { id: 't2', custom: { tags: ['gamma'] } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. onClose clears target
// ---------------------------------------------------------------------------

describe('TagPopoverHost — onClose clears the target', () => {
  it('target becomes null and stub is removed when onClose is called', () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['alpha', 'beta'], null);
    });

    expect(screen.getByTestId('sessions-tag-popover-stub')).toBeTruthy();

    act(() => {
      capturedProps?.onClose();
    });

    expect(useTagPopoverTarget.getState().target).toBeNull();
    expect(screen.queryByTestId('sessions-tag-popover-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. onCascade applies setChatTags per update + reloads
// ---------------------------------------------------------------------------

describe('TagPopoverHost — onCascade calls setChatTags per update then reload', () => {
  it('setChatTagsSpy called once with (31415,"t1",["alpha2","beta"]) and reloadSpy called once', async () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['alpha', 'beta'], null);
    });

    act(() => {
      capturedProps?.onCascade([{ id: 't1', newTags: ['alpha2', 'beta'] }]);
    });

    await waitFor(() => {
      expect(setChatTagsSpy).toHaveBeenCalledTimes(1);
    });
    expect(setChatTagsSpy).toHaveBeenCalledWith(31415, 't1', ['alpha2', 'beta']);

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. onCascade empty list → no setChatTags, no reload
// ---------------------------------------------------------------------------

describe('TagPopoverHost — onCascade with empty list does nothing', () => {
  it('setChatTagsSpy not called and reloadSpy not called when updates=[]', async () => {
    render(<TagPopoverHost port={31415} />);

    act(() => {
      useTagPopoverTarget.getState().open('t1', ['alpha', 'beta'], null);
    });

    act(() => {
      capturedProps?.onCascade([]);
    });

    // Give any pending microtasks time to resolve
    await Promise.resolve();

    expect(setChatTagsSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
