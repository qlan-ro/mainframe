/**
 * ActionConfig — the outputAs Text/Lines segment, and the daemon-shaped
 * catalog entry regression net (split out of ActionConfig.test.tsx to stay
 * under the file line cap). `schema.hasOutputAs` gates the segment for
 * `run_command` AND `files.read` — the two actions whose params accept it
 * (`engine/run_action_verb.rs`'s `ACTIONS_WITH_OUTPUT_AS`) — not just
 * `run_command` alone.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACTION_CATALOG_FIXTURE } from '../../fixtures/action-catalog';
import type { ActionCatalogEntry, RunActionStep } from '../../contract';
import { ActionConfig } from '../ActionConfig';

/**
 * Verbatim shape of `GET /api/automation-actions` for `run_command` (Part 0
 * of the 2026-08-18 automations-provider-connections plan): `paramsSchema`
 * is real JSON Schema — no `fields` inside it — and `fields`/`hasOutputAs`
 * are the sibling field schema. Before the fix, `ActionConfig` read
 * `action.paramsSchema.fields` (undefined on this shape) and rendered no
 * script field at all.
 */
const DAEMON_SHAPED_RUN_COMMAND: ActionCatalogEntry = {
  id: 'run_command',
  title: 'Run command',
  group: 'builtin',
  auth: 'none',
  outputs: [
    { name: 'output', type: 'text' },
    { name: 'exitCode', type: 'number' },
  ],
  idempotent: false,
  paramsSchema: {
    type: 'object',
    properties: {
      script: { type: 'array', minItems: 1 },
      runIn: { type: 'string', enum: ['project root', 'worktree', 'custom'] },
      customPath: { type: 'string' },
      outputAs: { type: 'string', enum: ['text', 'lines'] },
    },
    required: ['script', 'runIn'],
    additionalProperties: false,
  },
  fields: [
    { key: 'script', label: 'Script', control: 'code' },
    { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] },
  ],
  hasOutputAs: true,
};

describe('ActionConfig — daemon-shaped catalog entry (regression: A. run_action rendered an empty form)', () => {
  it('renders the run_command script field from a daemon-shaped catalog entry', () => {
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'run_command', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={[DAEMON_SHAPED_RUN_COMMAND]}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-form-script')).toBeInTheDocument();
    expect(screen.getByTestId('automations-action-a-form-runIn')).toBeInTheDocument();
  });
});

describe('ActionConfig — outputAs segment', () => {
  it('renders the outputAs Text/Lines segment for run_command, patching step.outputAs', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'run_command', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    await user.click(screen.getByTestId('automations-action-a-outputas-lines'));
    expect(onChange).toHaveBeenCalledWith({ ...step, outputAs: 'lines' });
  });

  it('renders the outputAs Text/Lines segment for files.read too — the other action whose params accept it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'files.read', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    await user.click(screen.getByTestId('automations-action-a-outputas-lines'));
    expect(onChange).toHaveBeenCalledWith({ ...step, outputAs: 'lines' });
  });

  it('does not render outputAs for an action that has no outputAs', () => {
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'files.append', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.queryByTestId('automations-action-a-outputas-lines')).not.toBeInTheDocument();
  });
});
