/**
 * NewThreadConfigPicker — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Mock `../../use-projects` so useProjects returns a fixed project list.
 *  - Mock `../../../../lib/api/adapters` so getAdapters resolves a fixed list
 *    where claude is installed=true and gemini is installed=false.
 *  - Mock `../../runtime/daemon-port-context` so useDaemonPort returns 31415.
 *  - Mock `@assistant-ui/react` so useAuiState resolves to '__LOCALID_test123'
 *    via the threadListItem.id selector.
 *  - Mock `../../runtime/draft-config` exposing setDraftConfig as a spy.
 *
 * Behaviors covered:
 *  1. After getAdapters resolves, all three select elements are in the document.
 *  2. Adapter select contains <option value="claude"> but NOT <option value="gemini">
 *     (gemini is installed=false and must be filtered out).
 *  3. Permission select has value 'default' on initial render and contains exactly
 *     the three ExecutionMode options: default, acceptEdits, yolo.
 *  4. Send gate has data-ready="false" before any selection; setDraftConfig not called.
 *  5. Selecting only a project keeps data-ready="false"; setDraftConfig not called.
 *  6. Selecting project + adapter sets data-ready="true" and calls setDraftConfig with
 *     ('__LOCALID_test123', { projectId:'p1', adapterId:'claude', permissionMode:'default' }).
 *  7. Changing permission mode after project+adapter re-calls setDraftConfig with
 *     ('__LOCALID_test123', { projectId:'p1', adapterId:'claude', permissionMode:'acceptEdits' }).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Spy on setDraftConfig — declared before mocks so the factory can close over it
// ---------------------------------------------------------------------------

const setDraftConfigSpy = vi.fn();
const getDraftConfigMock = vi.fn().mockReturnValue(undefined);
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

vi.mock('../../../../lib/api/adapters', () => ({
  getAdapters: () =>
    Promise.resolve([
      {
        id: 'claude',
        name: 'Claude',
        description: '',
        installed: true,
        models: [],
        capabilities: { planMode: true },
      },
      {
        id: 'gemini',
        name: 'Gemini',
        description: '',
        installed: false,
        models: [],
        capabilities: { planMode: false },
      },
    ]),
}));

vi.mock('../../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { threadListItem: { id: string } }) => unknown) =>
    selector({ threadListItem: { id: '__LOCALID_test123' } }),
}));

vi.mock('../../runtime/draft-config', () => ({
  setDraftConfig: (...args: unknown[]) => setDraftConfigSpy(...args),
  getDraftConfig: (...args: unknown[]) => getDraftConfigMock(...args),
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
  getDraftConfigMock.mockReset();
  getDraftConfigMock.mockReturnValue(undefined);
  markReadySpy.mockReset();
  clearReadySpy.mockReset();
});

// ---------------------------------------------------------------------------
// Helper — render and wait for getAdapters to resolve
// ---------------------------------------------------------------------------

async function renderAndWait() {
  render(<NewThreadConfigPicker />);
  await waitFor(() => {
    expect(screen.getByTestId('sessions-new-thread-adapter-select')).toBeTruthy();
  });
}

// ---------------------------------------------------------------------------
// 1. All three selects are rendered after getAdapters resolves
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — renders project, adapter, and permission selects', () => {
  it('all three data-testid selects are in the document after adapters load', async () => {
    await renderAndWait();

    expect(screen.getByTestId('sessions-new-thread-project-select')).toBeTruthy();
    expect(screen.getByTestId('sessions-new-thread-adapter-select')).toBeTruthy();
    expect(screen.getByTestId('sessions-new-thread-permission-select')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Only installed adapters listed — claude present, gemini absent
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — only installed adapters listed', () => {
  it('adapter select contains option value="claude" but not option value="gemini"', async () => {
    await renderAndWait();

    const adapterSelect = screen.getByTestId('sessions-new-thread-adapter-select');
    const optionValues = Array.from(adapterSelect.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );

    expect(optionValues).toContain('claude');
    expect(optionValues).not.toContain('gemini');
  });
});

// ---------------------------------------------------------------------------
// 3. Permission select defaults to 'default' and contains exactly the three modes
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — permission select default value and options', () => {
  it('value is "default" and options are exactly [default, acceptEdits, yolo]', async () => {
    await renderAndWait();

    const permSelect = screen.getByTestId('sessions-new-thread-permission-select') as HTMLSelectElement;
    expect(permSelect.value).toBe('default');

    const optionValues = Array.from(permSelect.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toEqual(['default', 'acceptEdits', 'yolo']);
  });
});

// ---------------------------------------------------------------------------
// 4. Send gate is data-ready="false" and setDraftConfig not called before selection
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — send gate is data-ready="false" before any selection', () => {
  it('data-ready="false" and setDraftConfig not called on initial render', async () => {
    await renderAndWait();

    const gate = screen.getByTestId('sessions-new-thread-send-gate');
    expect(gate.getAttribute('data-ready')).toBe('false');
    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Project only → still data-ready="false", setDraftConfig still not called
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — project only selected → still gated', () => {
  it('data-ready stays "false" and setDraftConfig not called after selecting only project', async () => {
    await renderAndWait();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    const gate = screen.getByTestId('sessions-new-thread-send-gate');
    expect(gate.getAttribute('data-ready')).toBe('false');
    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Project + adapter → data-ready="true" and setDraftConfig called with exact args
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — project + adapter → ready and draft written', () => {
  it('data-ready becomes "true" and setDraftConfig called with exact config', async () => {
    await renderAndWait();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-adapter-select'), 'claude');
    });

    const gate = screen.getByTestId('sessions-new-thread-send-gate');
    expect(gate.getAttribute('data-ready')).toBe('true');

    expect(setDraftConfigSpy).toHaveBeenCalledWith('__LOCALID_test123', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Changing permission mode after ready re-writes the draft
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — changing permission mode re-writes the draft', () => {
  it('setDraftConfig called with permissionMode="acceptEdits" after mode change', async () => {
    await renderAndWait();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-adapter-select'), 'claude');
    });

    setDraftConfigSpy.mockReset();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-permission-select'), 'acceptEdits');
    });

    expect(setDraftConfigSpy).toHaveBeenCalledWith('__LOCALID_test123', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'acceptEdits',
    });
  });
});

// ---------------------------------------------------------------------------
// 8. markReady is NOT called before project+adapter are both chosen
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — does not mark ready before config is complete', () => {
  it('markReady not called on initial render or with only a project selected', async () => {
    await renderAndWait();

    expect(markReadySpy).not.toHaveBeenCalled();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
    });

    expect(markReadySpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. Selecting project + adapter marks the local id ready (picker→composer switch)
// ---------------------------------------------------------------------------

describe('NewThreadConfigPicker — project + adapter marks the local id ready', () => {
  it('calls markReady("__LOCALID_test123") once the draft is complete', async () => {
    await renderAndWait();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-adapter-select'), 'claude');
    });

    expect(markReadySpy).toHaveBeenCalledWith('__LOCALID_test123');
  });

  it('writes the draft before marking ready (draft must exist when the composer mounts)', async () => {
    const callOrder: string[] = [];
    setDraftConfigSpy.mockImplementation(() => callOrder.push('setDraftConfig'));
    markReadySpy.mockImplementation(() => callOrder.push('markReady'));

    await renderAndWait();

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-project-select'), 'p1');
      await userEvent.selectOptions(screen.getByTestId('sessions-new-thread-adapter-select'), 'claude');
    });

    const draftIdx = callOrder.indexOf('setDraftConfig');
    const readyIdx = callOrder.indexOf('markReady');
    expect(draftIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeGreaterThan(draftIdx);
  });
});
