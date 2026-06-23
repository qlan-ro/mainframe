import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarResize } from '../useSidebarResize';
import { useUiPrefs } from '@/store/ui-prefs';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from '../SidebarShell';

beforeEach(() => {
  useUiPrefs.setState({ sidebarWidth: SIDEBAR_EXPANDED_WIDTH });
});

describe('useSidebarResize persistence', () => {
  it('initializes width from the persisted ui-prefs value', () => {
    useUiPrefs.setState({ sidebarWidth: 420 });
    const { result } = renderHook(() => useSidebarResize(true));
    expect(result.current.sidebarWidth).toBe(420);
  });

  it('expand() commits SIDEBAR_EXPANDED_WIDTH to ui-prefs', () => {
    useUiPrefs.setState({ sidebarWidth: SIDEBAR_COLLAPSED_WIDTH });
    const { result } = renderHook(() => useSidebarResize(true));
    act(() => result.current.expand());
    expect(useUiPrefs.getState().sidebarWidth).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  it('starts collapsed when the persisted width is the collapsed width', () => {
    useUiPrefs.setState({ sidebarWidth: SIDEBAR_COLLAPSED_WIDTH });
    const { result } = renderHook(() => useSidebarResize(true));
    expect(result.current.dragCollapsed).toBe(true);
  });
});
