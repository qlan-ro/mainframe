/**
 * Tab model unit tests — behavior-based, hardcoded expectations.
 * Tests pure reducer logic for openTab / closeTab / activateTab / reorderTabs
 * and the preview-vs-permanent semantics from openTargetWS (04-engine.jsx).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useTabsStore } from '../tabs';
import type { EditorTabModel } from '../tabs';

function store() {
  return useTabsStore.getState();
}

function tabs() {
  return store().tabs;
}

function activeId() {
  return store().activeTabId;
}

beforeEach(() => {
  // Reset to empty state before each test.
  useTabsStore.setState({ tabs: [], activeTabId: null });
});

// ── openTab: preview-vs-permanent semantics ─────────────────────────────────

describe('openTab — preview mode', () => {
  it('opens a preview tab and sets it as active', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });
    expect(tabs()).toHaveLength(1);
    const t = tabs()[0] as EditorTabModel;
    expect(t.path).toBe('/a.ts');
    expect(t.mode).toBe('preview');
    expect(activeId()).toBe(t.id);
  });

  it('a second open-file REUSES the existing preview slot (replaces it)', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });
    const firstId = tabs()[0]!.id;

    store().openTab({ path: '/b.ts', title: 'b.ts', kind: 'code' }, { mode: 'preview' });

    // Still only one tab — the preview slot was replaced.
    expect(tabs()).toHaveLength(1);
    const t = tabs()[0] as EditorTabModel;
    expect(t.path).toBe('/b.ts');
    expect(t.id).not.toBe(firstId);
    expect(t.mode).toBe('preview');
    expect(activeId()).toBe(t.id);
  });

  it('opening a file that is already open focuses it without adding a duplicate', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });
    const id = tabs()[0]!.id;

    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });

    expect(tabs()).toHaveLength(1);
    expect(activeId()).toBe(id);
  });

  it('opening an already-open file with permanent promotes it', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });
    const id = tabs()[0]!.id;

    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.id).toBe(id);
    expect(tabs()[0]!.mode).toBe('permanent');
  });
});

describe('openTab — permanent mode', () => {
  it('opens a permanent tab', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.mode).toBe('permanent');
  });

  it('permanent tab does NOT replace an existing preview slot — both coexist', () => {
    store().openTab({ path: '/preview.ts', title: 'preview.ts', kind: 'code' }, { mode: 'preview' });
    store().openTab({ path: '/perm.ts', title: 'perm.ts', kind: 'code' }, { mode: 'permanent' });

    expect(tabs()).toHaveLength(2);
    expect(tabs().find((t) => t.path === '/preview.ts')?.mode).toBe('preview');
    expect(tabs().find((t) => t.path === '/perm.ts')?.mode).toBe('permanent');
  });
});

// ── promoteTab ───────────────────────────────────────────────────────────────

describe('promoteTab', () => {
  it('promotes a preview tab to permanent (double-click behaviour)', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'preview' });
    const id = tabs()[0]!.id;

    store().promoteTab(id);

    expect(tabs()[0]!.mode).toBe('permanent');
    expect(tabs()[0]!.id).toBe(id);
  });

  it('promoting an already-permanent tab is a no-op', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    const id = tabs()[0]!.id;
    store().promoteTab(id);
    expect(tabs()[0]!.mode).toBe('permanent');
    expect(tabs()[0]!.id).toBe(id);
  });
});

// ── closeTab ─────────────────────────────────────────────────────────────────

describe('closeTab', () => {
  it('closes a tab and the list shrinks', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    store().openTab({ path: '/b.ts', title: 'b.ts', kind: 'code' }, { mode: 'permanent' });
    const idA = tabs()[0]!.id;

    store().closeTab(idA);

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('/b.ts');
  });

  it('closing the active tab moves focus to the previous tab', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    store().openTab({ path: '/b.ts', title: 'b.ts', kind: 'code' }, { mode: 'permanent' });
    const idA = tabs()[0]!.id;
    const idB = tabs()[1]!.id;

    // b is active (most recently opened)
    expect(activeId()).toBe(idB);
    store().closeTab(idB);

    expect(activeId()).toBe(idA);
  });

  it('closing the last tab sets activeTabId to null', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    const id = tabs()[0]!.id;
    store().closeTab(id);
    expect(tabs()).toHaveLength(0);
    expect(activeId()).toBeNull();
  });
});

// ── activateTab ──────────────────────────────────────────────────────────────

describe('activateTab', () => {
  it('sets the active tab to the given id', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    store().openTab({ path: '/b.ts', title: 'b.ts', kind: 'code' }, { mode: 'permanent' });
    const idA = tabs()[0]!.id;

    store().activateTab(idA);
    expect(activeId()).toBe(idA);
  });
});

// ── reorderTabs ──────────────────────────────────────────────────────────────

describe('reorderTabs', () => {
  it('moves a tab from one position to another', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    store().openTab({ path: '/b.ts', title: 'b.ts', kind: 'code' }, { mode: 'permanent' });
    store().openTab({ path: '/c.ts', title: 'c.ts', kind: 'code' }, { mode: 'permanent' });

    const idA = tabs()[0]!.id;
    const idB = tabs()[1]!.id;
    const idC = tabs()[2]!.id;

    // Move A (index 0) to index 2 (after C).
    store().reorderTabs(0, 2);

    expect(tabs()[0]!.id).toBe(idB);
    expect(tabs()[1]!.id).toBe(idC);
    expect(tabs()[2]!.id).toBe(idA);
  });

  it('reordering with same source and destination is a no-op', () => {
    store().openTab({ path: '/a.ts', title: 'a.ts', kind: 'code' }, { mode: 'permanent' });
    const before = [...tabs()];
    store().reorderTabs(0, 0);
    expect(tabs()).toEqual(before);
  });
});

// ── diff / skill / viewer kinds ──────────────────────────────────────────────

describe('tab kinds', () => {
  it('opens a diff tab', () => {
    store().openTab(
      { path: '/a.ts', title: 'a.ts (diff)', kind: 'diff', original: 'old\n', modified: 'new\n' },
      { mode: 'permanent' },
    );
    expect(tabs()[0]!.kind).toBe('diff');
  });

  it('opens a skill tab', () => {
    store().openTab({ path: '/skill.md', title: 'my-skill', kind: 'skill' }, { mode: 'permanent' });
    expect(tabs()[0]!.kind).toBe('skill');
  });

  it('opens a viewer tab', () => {
    store().openTab({ path: '/image.png', title: 'image.png', kind: 'viewer' }, { mode: 'permanent' });
    expect(tabs()[0]!.kind).toBe('viewer');
  });
});
