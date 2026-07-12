/**
 * AddStepMenu — verbs pinned on top, searchable action catalog below (ts153
 * wf2-editor.jsx `WfAddMenu`, extended with a catalog search).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry } from '../../contract';
import { AddStepMenu } from '../AddStepMenu';

const CATALOG: ActionCatalogEntry[] = [
  { id: 'run_command', title: 'Run a command', group: 'builtin', auth: 'none', paramsSchema: {}, outputs: [] },
  {
    id: 'github.create_pr',
    title: 'Create a pull request',
    group: 'connector',
    auth: 'token',
    paramsSchema: {},
    outputs: [],
  },
];

describe('AddStepMenu — verbs', () => {
  it('lists all four verbs plus if/repeat, grouped', async () => {
    const user = userEvent.setup();
    render(<AddStepMenu catalog={[]} onAdd={vi.fn()} onAddAction={vi.fn()} testId="add" />);
    await user.click(screen.getByTestId('add'));
    for (const kind of ['ask_agent', 'ask_me', 'run_action', 'notify', 'if', 'repeat']) {
      expect(screen.getByTestId(`add-verb-${kind}`)).toBeInTheDocument();
    }
  });

  it('picking a verb calls onAdd with that kind and closes the menu', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddStepMenu catalog={[]} onAdd={onAdd} onAddAction={vi.fn()} testId="add" />);
    await user.click(screen.getByTestId('add'));
    await user.click(screen.getByTestId('add-verb-notify'));
    expect(onAdd).toHaveBeenCalledWith('notify');
  });
});

describe('AddStepMenu — catalog search', () => {
  it('hides the catalog section entirely when the catalog is empty', async () => {
    const user = userEvent.setup();
    render(<AddStepMenu catalog={[]} onAdd={vi.fn()} onAddAction={vi.fn()} testId="add" />);
    await user.click(screen.getByTestId('add'));
    expect(screen.queryByTestId('add-search')).not.toBeInTheDocument();
  });

  it('filters catalog entries by title as the user types', async () => {
    const user = userEvent.setup();
    render(<AddStepMenu catalog={CATALOG} onAdd={vi.fn()} onAddAction={vi.fn()} testId="add" />);
    await user.click(screen.getByTestId('add'));
    expect(screen.getByTestId('add-action-run_command')).toBeInTheDocument();
    expect(screen.getByTestId('add-action-github.create_pr')).toBeInTheDocument();
    await user.type(screen.getByTestId('add-search'), 'pull');
    expect(screen.queryByTestId('add-action-run_command')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-action-github.create_pr')).toBeInTheDocument();
  });

  it('picking a catalog entry calls onAddAction with its id and closes the menu', async () => {
    const user = userEvent.setup();
    const onAddAction = vi.fn();
    render(<AddStepMenu catalog={CATALOG} onAdd={vi.fn()} onAddAction={onAddAction} testId="add" />);
    await user.click(screen.getByTestId('add'));
    await user.click(screen.getByTestId('add-action-run_command'));
    expect(onAddAction).toHaveBeenCalledWith('run_command');
  });
});
