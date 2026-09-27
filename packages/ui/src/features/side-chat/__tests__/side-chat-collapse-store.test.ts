// @vitest-environment jsdom
/**
 * side-chat-collapse-store — per-parent collapsed/expanded state, expanded by
 * default, persisted one localStorage key per parent (todo #344, UI rule 3).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSideChatCollapseStore } from '../side-chat-collapse-store';

beforeEach(() => {
  window.localStorage.clear();
  useSideChatCollapseStore.setState({ collapsedByParent: {} });
});

describe('isCollapsed', () => {
  it('is expanded by default for a parent with no recorded state', () => {
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(false);
  });

  it('reflects a value already persisted under this parent’s own key', () => {
    window.localStorage.setItem('mf:side-chat-collapsed:chat-parent', 'true');

    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(true);
  });
});

describe('setCollapsed', () => {
  it('persists under a key scoped to the parent id, not a shared blob', () => {
    useSideChatCollapseStore.getState().setCollapsed('chat-parent', true);

    expect(window.localStorage.getItem('mf:side-chat-collapsed:chat-parent')).toBe('true');
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(true);
  });

  it('does not affect another parent’s state', () => {
    useSideChatCollapseStore.getState().setCollapsed('chat-parent-a', true);

    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent-b')).toBe(false);
    expect(window.localStorage.getItem('mf:side-chat-collapsed:chat-parent-b')).toBeNull();
  });
});

describe('expand', () => {
  it('clears a collapsed parent back to expanded (AC 20 auto-expand)', () => {
    useSideChatCollapseStore.getState().setCollapsed('chat-parent', true);

    useSideChatCollapseStore.getState().expand('chat-parent');

    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(false);
  });
});

describe('toggle', () => {
  it('flips expanded to collapsed and back', () => {
    const store = useSideChatCollapseStore.getState();

    store.toggle('chat-parent');
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(true);

    store.toggle('chat-parent');
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(false);
  });
});
