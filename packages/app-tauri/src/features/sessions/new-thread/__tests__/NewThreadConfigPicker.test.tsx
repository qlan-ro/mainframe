/**
 * NewThreadConfigPicker — behavior tests for the project-only picker.
 *
 * Strategy:
 *  - Mock `../../use-projects` so useProjects returns a fixed project list.
 *  - Mock `@assistant-ui/react` so useAuiState resolves to '__LOCALID_test123'
 *    via the threadListItem.id selector.
 *  - Mock `../../runtime/draft-config` exposing setDraftConfig as a spy.
 *  - Mock `../../runtime/new-thread-ready-store` exposing markReady as a spy.
 *
 * Behaviors covered:
 *  1. Only the project select is rendered (no adapter or permission selects).
 *  2. Send gate has data-ready="false" before any selection; setDraftConfig not called.
 *  3. Selecting a project sets data-ready="true" and calls setDraftConfig with
 *     ('__LOCALID_test123', { projectId:'p1', adapterId:'claude', permissionMode:'default' }).
 *  4. markReady is NOT called before a project is selected.
 *  5. Selecting a project marks the local id ready (calls markReady once).
 *  6. Draft is written before markReady (ordering guarantee).
 *  7. Heading text is "Choose a project to start".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Spies — declared before mocks so factories can close over them
// ---------------------------------------------------------------------------

const setDraftConfigSpy = vi.fn();
const markReadySpy = vi.fn();
const clearReadySpy = vi.fn();

// ---------------------------------------------------------------------------
// Mocks — must be registered before the component is imported
// ---------------------------------------------------------------------------

vi.mock('../../use-projects', () => ({
  useProjects: () => ({
    projects: [
      {
        id: 'p1',
        name: 'Mainframe',
        path: '/p/mainframe',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    loading: false,
  }),
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { threadListItem: { id: string } }) => unknown) =>
    selector({ threadListItem: { id: '__LOCALID_test123' } }),
}));

vi.mock('../../runtime/draft-config', () => ({
  setDraftConfig: (...args: unknown[]) => setDraftConfigSpy(...args),
}));

vi.mock('../../runtime/new-thread-ready-store', () => ({
  useNewThreadReady: {
    getState: () => ({
      markReady: (...args: unknown[]) => markReadySpy(...args),
      clearReady: (...args: unknown[]) => clearReadySpy(...args),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { NewThreadConfigPicker } = await import('../NewThreadConfigPicker');

// ---------------------------------------------------------------------------
// Reset spies between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setDraftConfigSpy.mockReset();
  markReadySpy.mockReset();
  clearReadySpy.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Only the project select is rendered — NO adapter or permission selects
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — only the project select is rendered', () => {
  it('renders the project select', () => {
    render(<NewThreadConfigPicker />);
    expect(screen.getByTestId('sessions-new-thread-project-select')).toBeTruthy();
  });

  it('does NOT render an adapter select', () => {
    render(<NewThreadConfigPicker />);
    expect(screen.queryByTestId('sessions-new-thread-adapter-select')).toBeNull();
  });

  it('does NOT render a permission select', () => {
    render(<NewThreadConfigPicker />);
    expect(screen.queryByTestId('sessions-new-thread-permission-select')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Heading text
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — heading text', () => {
  it('shows "Choose a project to start"', () => {
    render(<NewThreadConfigPicker />);
    expect(screen.getByText('Choose a project to start')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Send gate is data-ready="false" and setDraftConfig not called before selection
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — send gate is data-ready="false" before any selection', () => {
  it('data-ready="false" and setDraftConfig not called on initial render', () => {
    render(<NewThreadConfigPicker />);

    const gate = screen.getByTestId('sessions-new-thread-send-gate');
    expect(gate.getAttribute('data-ready')).toBe('false');
    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Selecting a project → data-ready="true" and setDraftConfig called
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — selecting a project sets ready and writes the draft', () => {
  it('data-ready becomes "true" after selecting a project', async () => {
    render(<NewThreadConfigPicker />);

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    const gate = screen.getByTestId('sessions-new-thread-send-gate');
    expect(gate.getAttribute('data-ready')).toBe('true');
  });

  it('calls setDraftConfig with {projectId, adapterId:"claude"} and no permissionMode (daemon applies defaultMode)', async () => {
    render(<NewThreadConfigPicker />);

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    expect(setDraftConfigSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_test123', {
      projectId: 'p1',
      adapterId: 'claude',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. markReady is NOT called before a project is selected
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — markReady not called before project selection', () => {
  it('markReady not called on initial render', () => {
    render(<NewThreadConfigPicker />);

    expect(markReadySpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Selecting a project marks the local id ready
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — selecting a project marks the local id ready', () => {
  it('calls markReady("__LOCALID_test123") exactly once after selecting a project', async () => {
    render(<NewThreadConfigPicker />);

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    expect(markReadySpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_test123');
  });
});

// ---------------------------------------------------------------------------
// 7. Draft is written before markReady (composer reads draft on mount)
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — draft written before markReady', () => {
  it('setDraftConfig is called before markReady so the draft exists when the composer mounts', async () => {
    const callOrder: string[] = [];
    setDraftConfigSpy.mockImplementation(() => callOrder.push('setDraftConfig'));
    markReadySpy.mockImplementation(() => callOrder.push('markReady'));

    render(<NewThreadConfigPicker />);

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    const draftIdx = callOrder.indexOf('setDraftConfig');
    const readyIdx = callOrder.indexOf('markReady');
    expect(draftIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeGreaterThan(draftIdx);
  });
});
