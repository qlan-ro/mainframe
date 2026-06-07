/**
 * TagPopover — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1.  Renders data-testid="sessions-tag-popover" when open=true.
 *  2.  Renders data-testid="sessions-tag-popover-search" input.
 *  3.  sessions-tag-toggle-alpha has aria-checked="true" when currentTags=['alpha'].
 *  4.  sessions-tag-toggle-alpha has aria-checked="false" when currentTags=[].
 *  5.  Clicking toggle when currentTags=[] calls setChatTags(31415,'chat-1',['alpha']).
 *  6.  Clicking toggle when currentTags=['alpha'] calls setChatTags(31415,'chat-1',[]).
 *  7.  Typing 'newt' shows sessions-tag-popover-create with text 'Create tag "newt"'.
 *  8.  Clicking create calls registry.create('newt', undefined) then
 *      setChatTags(31415,'chat-1',['newt']).
 *  9.  Typing existing 'alpha' does NOT show the create button (exact match).
 *  10. Typing 'a' does NOT show the create button (too-short nameError).
 *  11. Typing 'mf:system' shows the error 'Tag names may not use the mf: prefix'
 *      and no create button.
 *  12. Typing 'x'.repeat(25) does NOT show the create button (too-long).
 *  13. Typing 'AB' then clicking create calls registry.create('ab', undefined)
 *      (lowercased before send).
 *  14. Rename cascade: fire contextMenu on sessions-tag-registry-row-alpha, click
 *      sessions-tag-registry-rename → sessions-tag-rename-input appears prefilled
 *      'alpha'; type 'alpha2', press Enter → registry.update('alpha',{rename:'alpha2'})
 *      then onCascade([{id:'t1', newTags:['alpha2','beta']}]).
 *  15. Delete cascade: fire contextMenu, click sessions-tag-registry-delete →
 *      sessions-tag-delete-confirm appears; click sessions-tag-delete-confirm-ok →
 *      registry.remove('alpha') then onCascade([{id:'t1', newTags:['beta']}]).
 *  16. Delete cancel: click sessions-tag-delete-confirm-cancel → registry.remove
 *      NOT called, onCascade NOT called.
 *  17. Recolor does NOT cascade: fire contextMenu, click sessions-tag-registry-recolor
 *      → sessions-tag-recolor-panel appears; click sessions-tag-color-red →
 *      registry.update('alpha',{color:'red'}) called, onCascade NOT called.
 *  18. Pressing Escape on the search input calls onClose once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TagRegistry } from '../use-tag-registry';
import type { ThreadTagSnapshot, TagCascadeUpdate } from '../build-tag-cascade';

// ---------------------------------------------------------------------------
// Mock setChatTags — hoisted so the factory runs before imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/tags', () => ({
  setChatTags: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { setChatTags } from '@/lib/api/tags';
import { TagPopover } from '../TagPopover';

const mockSetChatTags = vi.mocked(setChatTags);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALPHA_TAG = { name: 'alpha', color: 'blue' as const, createdAt: 'x' };

/** Two threads where t1 has ['alpha','beta'] and t2 has ['gamma']. */
const TWO_THREADS: ThreadTagSnapshot[] = [
  { id: 't1', custom: { tags: ['alpha', 'beta'] } },
  { id: 't2', custom: { tags: ['gamma'] } },
];

// ---------------------------------------------------------------------------
// Factory — builds a controllable fake TagRegistry
// ---------------------------------------------------------------------------

function makeRegistry(tags = [ALPHA_TAG]): TagRegistry {
  return {
    tags,
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    colorOf: vi.fn().mockReturnValue('blue' as const),
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPopover(overrides: {
  open?: boolean;
  currentTags?: string[];
  registry?: TagRegistry;
  threads?: ThreadTagSnapshot[];
  onCascade?: (u: TagCascadeUpdate[]) => void;
  onClose?: () => void;
}) {
  const registry = overrides.registry ?? makeRegistry();
  const onCascade = overrides.onCascade ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  render(
    <TagPopover
      open={overrides.open ?? true}
      onClose={onClose}
      chatId="chat-1"
      port={31415}
      currentTags={overrides.currentTags ?? []}
      registry={registry}
      threads={overrides.threads ?? TWO_THREADS}
      onCascade={onCascade}
    />,
  );

  return { registry, onCascade, onClose };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSetChatTags.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// 1. Renders sessions-tag-popover when open=true
// ---------------------------------------------------------------------------

describe('TagPopover — renders root test-id when open', () => {
  it('renders data-testid="sessions-tag-popover" when open=true', () => {
    renderPopover({ open: true });
    expect(screen.getByTestId('sessions-tag-popover')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Renders sessions-tag-popover-search input
// ---------------------------------------------------------------------------

describe('TagPopover — renders search input', () => {
  it('renders data-testid="sessions-tag-popover-search"', () => {
    renderPopover({});
    expect(screen.getByTestId('sessions-tag-popover-search')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. sessions-tag-toggle-alpha aria-checked="true" when currentTags=['alpha']
// ---------------------------------------------------------------------------

describe('TagPopover — toggle aria-checked reflects currentTags', () => {
  it('sessions-tag-toggle-alpha has aria-checked="true" when currentTags=[\'alpha\']', () => {
    renderPopover({ currentTags: ['alpha'] });
    const toggle = screen.getByTestId('sessions-tag-toggle-alpha');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  // 4. sessions-tag-toggle-alpha aria-checked="false" when currentTags=[]
  it('sessions-tag-toggle-alpha has aria-checked="false" when currentTags=[]', () => {
    renderPopover({ currentTags: [] });
    const toggle = screen.getByTestId('sessions-tag-toggle-alpha');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking toggle when currentTags=[] calls setChatTags(31415,'chat-1',['alpha'])
// ---------------------------------------------------------------------------

describe('TagPopover — clicking toggle when tag is off applies the tag', () => {
  it('calls setChatTags(31415, "chat-1", ["alpha"]) exactly once', async () => {
    renderPopover({ currentTags: [] });

    await userEvent.click(screen.getByTestId('sessions-tag-toggle-alpha'));

    expect(mockSetChatTags).toHaveBeenCalledTimes(1);
    expect(mockSetChatTags).toHaveBeenCalledWith(31415, 'chat-1', ['alpha']);
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking toggle when currentTags=['alpha'] calls setChatTags(31415,'chat-1',[])
// ---------------------------------------------------------------------------

describe('TagPopover — clicking toggle when tag is on removes the tag', () => {
  it('calls setChatTags(31415, "chat-1", []) exactly once', async () => {
    renderPopover({ currentTags: ['alpha'] });

    await userEvent.click(screen.getByTestId('sessions-tag-toggle-alpha'));

    expect(mockSetChatTags).toHaveBeenCalledTimes(1);
    expect(mockSetChatTags).toHaveBeenCalledWith(31415, 'chat-1', []);
  });
});

// ---------------------------------------------------------------------------
// 7. Typing 'newt' shows sessions-tag-popover-create with text Create tag "newt"
// ---------------------------------------------------------------------------

describe('TagPopover — typing a new name shows the create button', () => {
  it('shows sessions-tag-popover-create with text including \'Create tag "newt"\'', async () => {
    renderPopover({});
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'newt');

    const createBtn = screen.getByTestId('sessions-tag-popover-create');
    expect(createBtn).toBeTruthy();
    expect(createBtn.textContent).toContain('Create tag "newt"');
  });
});

// ---------------------------------------------------------------------------
// 8. Clicking create calls registry.create('newt', undefined) then setChatTags
// ---------------------------------------------------------------------------

describe('TagPopover — clicking create creates the tag and applies it', () => {
  it('calls registry.create("newt", undefined) then setChatTags(31415,"chat-1",["newt"])', async () => {
    const registry = makeRegistry([]);
    renderPopover({ registry, currentTags: [] });
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'newt');
    await userEvent.click(screen.getByTestId('sessions-tag-popover-create'));

    expect(registry.create).toHaveBeenCalledTimes(1);
    expect(registry.create).toHaveBeenCalledWith('newt', undefined);
    expect(mockSetChatTags).toHaveBeenCalledTimes(1);
    expect(mockSetChatTags).toHaveBeenCalledWith(31415, 'chat-1', ['newt']);
  });
});

// ---------------------------------------------------------------------------
// 9. Typing existing 'alpha' does NOT show the create button (exact match)
// ---------------------------------------------------------------------------

describe('TagPopover — typing an existing tag name suppresses the create button', () => {
  it('does NOT render sessions-tag-popover-create when query exactly matches "alpha"', async () => {
    renderPopover({});
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'alpha');

    expect(screen.queryByTestId('sessions-tag-popover-create')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Typing 'a' does NOT show create (too-short nameError)
// ---------------------------------------------------------------------------

describe('TagPopover — single-character query suppresses create (too-short)', () => {
  it('does NOT render sessions-tag-popover-create when query is "a"', async () => {
    renderPopover({});
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'a');

    expect(screen.queryByTestId('sessions-tag-popover-create')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Typing 'mf:system' shows mf: prefix error and no create button
// ---------------------------------------------------------------------------

describe('TagPopover — reserved mf: prefix shows error and suppresses create', () => {
  it('shows "Tag names may not use the mf: prefix" and no create button', async () => {
    renderPopover({});
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'mf:system');

    expect(screen.getByText('Tag names may not use the mf: prefix')).toBeTruthy();
    expect(screen.queryByTestId('sessions-tag-popover-create')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Typing 'x'.repeat(25) does NOT show create (too-long)
// ---------------------------------------------------------------------------

describe('TagPopover — 25-character query suppresses create (too-long)', () => {
  it('does NOT render sessions-tag-popover-create when query is 25 chars', async () => {
    renderPopover({});
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'x'.repeat(25));

    expect(screen.queryByTestId('sessions-tag-popover-create')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. Typing 'AB' then clicking create calls registry.create('ab', undefined)
// ---------------------------------------------------------------------------

describe('TagPopover — uppercase input is lowercased before create', () => {
  it('calls registry.create("ab", undefined) when query is "AB"', async () => {
    const registry = makeRegistry([]);
    renderPopover({ registry });
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.type(search, 'AB');
    await userEvent.click(screen.getByTestId('sessions-tag-popover-create'));

    expect(registry.create).toHaveBeenCalledTimes(1);
    expect(registry.create).toHaveBeenCalledWith('ab', undefined);
  });
});

// ---------------------------------------------------------------------------
// 14. Rename cascade
// ---------------------------------------------------------------------------

describe('TagPopover — rename cascade: update + onCascade with renamed tag', () => {
  it('registry.update("alpha",{rename:"alpha2"}) called then onCascade([{id:"t1",newTags:["alpha2","beta"]}])', async () => {
    const registry = makeRegistry();
    const onCascade = vi.fn();
    renderPopover({ registry, threads: TWO_THREADS, onCascade });

    // Open the context menu on the registry row
    fireEvent.contextMenu(screen.getByTestId('sessions-tag-registry-row-alpha'));

    // Click rename
    await userEvent.click(screen.getByTestId('sessions-tag-registry-rename'));

    // Rename input appears prefilled with 'alpha'
    const renameInput = screen.getByTestId('sessions-tag-rename-input');
    expect(renameInput).toBeTruthy();
    expect((renameInput as HTMLInputElement).value).toBe('alpha');

    // Clear and type the new name, then commit with Enter
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, 'alpha2');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(registry.update).toHaveBeenCalledTimes(1);
    });
    expect(registry.update).toHaveBeenCalledWith('alpha', { rename: 'alpha2' });

    expect(onCascade).toHaveBeenCalledTimes(1);
    expect(onCascade).toHaveBeenCalledWith([{ id: 't1', newTags: ['alpha2', 'beta'] }]);
  });
});

// ---------------------------------------------------------------------------
// 15. Delete cascade
// ---------------------------------------------------------------------------

describe('TagPopover — delete cascade: remove + onCascade without the deleted tag', () => {
  it('registry.remove("alpha") called then onCascade([{id:"t1",newTags:["beta"]}])', async () => {
    const registry = makeRegistry();
    const onCascade = vi.fn();
    renderPopover({ registry, threads: TWO_THREADS, onCascade });

    // Open context menu
    fireEvent.contextMenu(screen.getByTestId('sessions-tag-registry-row-alpha'));

    // Click delete
    await userEvent.click(screen.getByTestId('sessions-tag-registry-delete'));

    // Confirm dialog appears
    expect(screen.getByTestId('sessions-tag-delete-confirm')).toBeTruthy();

    // Click the confirm OK button
    await userEvent.click(screen.getByTestId('sessions-tag-delete-confirm-ok'));

    await waitFor(() => {
      expect(registry.remove).toHaveBeenCalledTimes(1);
    });
    expect(registry.remove).toHaveBeenCalledWith('alpha');

    expect(onCascade).toHaveBeenCalledTimes(1);
    expect(onCascade).toHaveBeenCalledWith([{ id: 't1', newTags: ['beta'] }]);
  });
});

// ---------------------------------------------------------------------------
// 16. Delete cancel does NOT call remove or onCascade
// ---------------------------------------------------------------------------

describe('TagPopover — delete cancel: no remove, no cascade', () => {
  it('does NOT call registry.remove or onCascade when cancel is clicked', async () => {
    const registry = makeRegistry();
    const onCascade = vi.fn();
    renderPopover({ registry, threads: TWO_THREADS, onCascade });

    fireEvent.contextMenu(screen.getByTestId('sessions-tag-registry-row-alpha'));
    await userEvent.click(screen.getByTestId('sessions-tag-registry-delete'));
    await userEvent.click(screen.getByTestId('sessions-tag-delete-confirm-cancel'));

    expect(registry.remove).not.toHaveBeenCalled();
    expect(onCascade).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 17. Recolor does NOT cascade
// ---------------------------------------------------------------------------

describe('TagPopover — recolor: registry.update called, onCascade NOT called', () => {
  it('calls registry.update("alpha",{color:"red"}) and does NOT call onCascade', async () => {
    const registry = makeRegistry();
    const onCascade = vi.fn();
    renderPopover({ registry, threads: TWO_THREADS, onCascade });

    fireEvent.contextMenu(screen.getByTestId('sessions-tag-registry-row-alpha'));
    await userEvent.click(screen.getByTestId('sessions-tag-registry-recolor'));

    // Recolor panel appears
    expect(screen.getByTestId('sessions-tag-recolor-panel')).toBeTruthy();

    // Click the red swatch
    await userEvent.click(screen.getByTestId('sessions-tag-color-red'));

    await waitFor(() => {
      expect(registry.update).toHaveBeenCalledTimes(1);
    });
    expect(registry.update).toHaveBeenCalledWith('alpha', { color: 'red' });
    expect(onCascade).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 18. Pressing Escape on search input calls onClose once
// ---------------------------------------------------------------------------

describe('TagPopover — Escape on search input calls onClose', () => {
  it('calls onClose exactly once when Escape is pressed on the search input', async () => {
    const onClose = vi.fn();
    renderPopover({ onClose });
    const search = screen.getByTestId('sessions-tag-popover-search');

    await userEvent.click(search);
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
