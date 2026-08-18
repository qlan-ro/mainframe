/**
 * RetryBody — the attempt count, and the side-effect warning. The warning
 * names the actual non-idempotent actions in the body (not a blanket
 * warning) and disappears when every step in the body is idempotent — that
 * is the only place a user learns a retry will double-fire a step.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, AutomationStep, RetryBlock } from '../../contract';
import { RetryBody } from '../RetryBody';

const CREATE_PR: ActionCatalogEntry = {
  id: 'github.create_pr',
  title: 'Open a pull request',
  group: 'connector',
  auth: 'none',
  paramsSchema: {},
  outputs: [],
  idempotent: false,
};

const ADD_ROW: ActionCatalogEntry = {
  id: 'notion.add_row',
  title: 'Add a Notion row',
  group: 'connector',
  auth: 'token',
  paramsSchema: {},
  outputs: [],
  idempotent: false,
};

const READ_FILE: ActionCatalogEntry = {
  id: 'files.read',
  title: 'Read a file',
  group: 'builtin',
  auth: 'none',
  paramsSchema: {},
  outputs: [],
  idempotent: true,
};

function runAction(id: string, actionId: string): AutomationStep {
  return { id, kind: 'run_action', actionId, params: {} };
}

function setup(maxAttempts: number, steps: AutomationStep[] = [], catalog: ActionCatalogEntry[] = []) {
  const onChange = vi.fn();
  const initial: RetryBlock = { id: 'guard', kind: 'retry', maxAttempts, steps };
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <RetryBody
        step={value}
        onChange={(patch) => {
          onChange(patch);
          setValue((v) => ({ ...v, ...patch }));
        }}
        tokens={[]}
        catalog={catalog}
        issues={[]}
        depth={0}
      />
    );
  }
  render(<Host />);
  return { onChange };
}

describe('RetryBody', () => {
  it('names the non-idempotent actions in the body', () => {
    setup(3, [runAction('a', 'github.create_pr'), runAction('b', 'notion.add_row')], [CREATE_PR, ADD_ROW]);
    expect(screen.getByTestId('automations-retry-warning-guard')).toHaveTextContent(
      'Retrying will run these again: Open a pull request, Add a Notion row.',
    );
  });

  it('says nothing when every step in the body is idempotent', () => {
    setup(3, [runAction('a', 'files.read')], [READ_FILE]);
    expect(screen.queryByTestId('automations-retry-warning-guard')).not.toBeInTheDocument();
  });

  it('says nothing for an empty body', () => {
    setup(3, [], []);
    expect(screen.queryByTestId('automations-retry-warning-guard')).not.toBeInTheDocument();
  });

  it('treats an unresolved actionId as non-idempotent, named by its raw id', () => {
    setup(3, [runAction('a', 'deleted.action')], []);
    expect(screen.getByTestId('automations-retry-warning-guard')).toHaveTextContent(
      'Retrying will run these again: deleted.action.',
    );
  });

  it('says plainly that one attempt is no retry', () => {
    setup(1);
    expect(screen.getByText(/no retry/i)).toBeInTheDocument();
  });

  it('stores an edited attempt count', async () => {
    const { onChange } = setup(3);
    const field = screen.getByTestId('automations-retry-attempts-guard');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    expect(onChange).toHaveBeenLastCalledWith({ maxAttempts: 5 });
  });

  it('reports a cleared count as zero so validation can reject it', async () => {
    const { onChange } = setup(3);
    await userEvent.clear(screen.getByTestId('automations-retry-attempts-guard'));
    expect(onChange).toHaveBeenLastCalledWith({ maxAttempts: 0 });
  });
});
