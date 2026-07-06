/**
 * SessionsNewButton — behavior tests for the "All view" project-picker's
 * lifted open state (use-new-session-picker-target).
 *
 * The picker must open both from its own "+" trigger click AND from an
 * external `useNewSessionPickerTarget.setOpen(true)` call (the seam the
 * global ⌘N hotkey and the zero-session boot fallback use) — so the SAME
 * anchored popover serves every entry point, never a second instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';

const switchToNewThread = vi.fn();
const mainThreadIdMock = { current: null as string | null };

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAssistantRuntime: () => ({
      threads: {
        getState: () => ({ newThreadId: '__LOCALID_1', mainThreadId: mainThreadIdMock.current }),
        switchToNewThread,
      },
    }),
  };
});

import { useNewSessionPickerTarget } from '../use-new-session-picker-target';
import { SessionsNewButton } from '../SessionsNewButton';

const projects: Project[] = [{ id: 'p1', name: 'Alpha', path: '/a' } as Project];

function renderAllView() {
  return render(
    <SessionsNewButton
      filterProjectId={null}
      filterProjectName={null}
      projects={projects}
      sessionCounts={{ p1: 0 }}
      onAddProject={vi.fn()}
    />,
  );
}

beforeEach(() => {
  switchToNewThread.mockReset();
  useNewSessionPickerTarget.setState({ open: false });
});

describe('SessionsNewButton — All view, clicking the "+" trigger', () => {
  it('opens the picker via the shared store', () => {
    renderAllView();
    fireEvent.click(screen.getByTestId('sessions-new-button'));

    expect(screen.getByTestId('sessions-new-picker')).toBeInTheDocument();
    expect(useNewSessionPickerTarget.getState().open).toBe(true);
  });
});

describe('SessionsNewButton — All view, externally driven open', () => {
  it('opens the anchored popover when useNewSessionPickerTarget.setOpen(true) is called externally', () => {
    renderAllView();
    expect(screen.queryByTestId('sessions-new-picker')).toBeNull();

    act(() => {
      useNewSessionPickerTarget.getState().setOpen(true);
    });

    expect(screen.getByTestId('sessions-new-picker')).toBeInTheDocument();
  });
});

describe('SessionsNewButton — All view, picking a project closes the shared store', () => {
  it('sets the store back to closed after a project pick', () => {
    renderAllView();
    fireEvent.click(screen.getByTestId('sessions-new-button'));
    fireEvent.click(screen.getByTestId('sessions-new-picker-project-p1'));

    expect(useNewSessionPickerTarget.getState().open).toBe(false);
  });
});
