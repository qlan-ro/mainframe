/** Dragging a session tab onto the chat opens it in the workspace (W9). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabDragStore } from '@/features/session-tabs/tab-drag-store';
import { useLayoutStore } from '@/store/layout';

const threads = {
  getState: () => ({ mainThreadId: 'main', threadItems: [{ id: 'other', remoteId: 'other', title: 'Other' }] }),
};
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads }),
  useAuiState: (select: (s: unknown) => unknown) => select({ threads: threads.getState() }),
}));

import { SessionDropLayer } from '../SessionDropLayer';

const target = () => screen.queryByTestId('session-drop-workspace');
const drag = (id: string | null) => useTabDragStore.setState({ draggingId: id });

beforeEach(() => {
  drag(null);
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'main',
  });
});

describe('SessionDropLayer', () => {
  it.each([[null], ['main'], ['__LOCALID_1']])('offers nothing while %s is dragged', (id) => {
    drag(id);
    render(<SessionDropLayer />);
    expect(target()).toBeNull();
  });

  it('opens the dropped session beside the conversation', () => {
    drag('other');
    render(<SessionDropLayer />);
    fireEvent.pointerUp(target()!);
    expect(useLayoutStore.getState().run!.panes[0]!.tabs.map((tab) => tab.chatId)).toEqual(['other']);
  });

  it('lights under the pointer', () => {
    drag('other');
    render(<SessionDropLayer />);
    fireEvent.pointerEnter(target()!);
    expect(target()).toHaveAttribute('data-hovered', 'true');
    fireEvent.pointerLeave(target()!);
    expect(target()).not.toHaveAttribute('data-hovered');
  });
});
