/**
 * ZoneDropLayer — the drop targets of the drag-to-split gesture. What the layer
 * offers depends on the drag and on whether the surface is already split, and
 * what a drop DOES is visible in the zones store plus the aui switch.
 *
 * aui is mocked down to the two things the component reads: the active chat
 * (`mainThreadId`) and `threads.switchToThread`.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabDragStore } from '../tab-drag-store';
import { useZonesStore } from '../zones-store';

let mainThreadIdValue: string | null;
const switchToThread = vi.fn();

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAui: () => ({ threads: { switchToThread } }),
    useAuiState: (sel: (s: { threads: { mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { mainThreadId: mainThreadIdValue } }),
  };
});

import { ZoneDropLayer } from '../ZoneDropLayer';

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;
const drop = (testId: string) => fireEvent.pointerUp(screen.getByTestId(testId));

beforeEach(() => {
  switchToThread.mockReset();
  mainThreadIdValue = 'chat-a';
  useTabDragStore.setState({ draggingId: null });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('nothing to drop on', () => {
  it('renders no targets while no tab is being dragged', () => {
    const { container } = render(<ZoneDropLayer />);

    expect(container.firstChild).toBeNull();
  });

  it('renders no targets for an unsent draft — a draft cannot be a zone', () => {
    useTabDragStore.setState({ draggingId: '__LOCALID_1' });

    const { container } = render(<ZoneDropLayer />);

    expect(container.firstChild).toBeNull();
  });

  it('renders no targets when the dragged tab IS the active chat', () => {
    useTabDragStore.setState({ draggingId: 'chat-a' });

    const { container } = render(<ZoneDropLayer />);

    expect(container.firstChild).toBeNull();
  });

  it('renders no targets when the active chat is an unsent draft', () => {
    mainThreadIdValue = '__LOCALID_1';
    useTabDragStore.setState({ draggingId: 'chat-b' });

    const { container } = render(<ZoneDropLayer />);

    expect(container.firstChild).toBeNull();
  });
});

describe('single mode', () => {
  beforeEach(() => {
    useTabDragStore.setState({ draggingId: 'chat-b' });
  });

  it('offers one half-surface target', () => {
    render(<ZoneDropLayer />);

    expect(screen.getByTestId('zone-drop-split')).toHaveTextContent('Open in split');
    expect(screen.queryByTestId('zone-drop-left')).toBeNull();
    expect(screen.queryByTestId('zone-drop-right')).toBeNull();
  });

  it('splits the active chat against the dragged one, active on the left', () => {
    render(<ZoneDropLayer />);

    drop('zone-drop-split');

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(0);
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('split mode', () => {
  beforeEach(() => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
  });

  it('offers one target per zone and drops the open-in-split half', () => {
    useTabDragStore.setState({ draggingId: 'chat-c' });

    render(<ZoneDropLayer />);

    expect(screen.getByTestId('zone-drop-left')).toHaveTextContent('Show here');
    expect(screen.getByTestId('zone-drop-right')).toHaveTextContent('Show here');
    expect(screen.queryByTestId('zone-drop-split')).toBeNull();
  });

  it('retargets the UNFOCUSED zone without moving focus', () => {
    useTabDragStore.setState({ draggingId: 'chat-c' });
    render(<ZoneDropLayer />);

    drop('zone-drop-right');

    expect(zones()).toEqual(['chat-a', 'chat-c']);
    expect(focusedIndex()).toBe(0);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('follows the drop with focus when it lands on the FOCUSED zone', () => {
    // Replacing the focused slot would strand the active chat outside the
    // split, so the drop takes focus with it.
    useTabDragStore.setState({ draggingId: 'chat-c' });
    render(<ZoneDropLayer />);

    drop('zone-drop-left');

    expect(zones()).toEqual(['chat-c', 'chat-b']);
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-c');
  });

  it('follows the drop with focus on the right zone too', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    useTabDragStore.setState({ draggingId: 'chat-c' });
    render(<ZoneDropLayer />);

    drop('zone-drop-right');

    expect(zones()).toEqual(['chat-a', 'chat-c']);
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-c');
  });

  it('just focuses a chat that is already one of the two zones', () => {
    useTabDragStore.setState({ draggingId: 'chat-b' });
    render(<ZoneDropLayer />);

    drop('zone-drop-left');

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });
});
