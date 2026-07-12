/**
 * StepSummary — per-verb collapsed summary line shown under a StepCard's
 * title (ts153 wf2-editor.jsx `WfStepCard`'s inline `summary` computation,
 * extracted). TDD: test written first, component implemented after.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActionCatalogEntry } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { StepSummary } from '../StepSummary';

const CATALOG: ActionCatalogEntry[] = [
  {
    id: 'run_command',
    title: 'Run a command',
    group: 'builtin',
    auth: 'none',
    paramsSchema: {},
    outputs: [{ name: 'output', type: 'text' }],
  },
];

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

describe('StepSummary', () => {
  it('renders "No prompt yet" for an empty ask_agent prompt', () => {
    render(<StepSummary step={{ id: 's1', kind: 'ask_agent', prompt: [] }} tokens={[]} catalog={CATALOG} />);
    expect(screen.getByText('No prompt yet')).toBeInTheDocument();
  });

  it('renders literal text and a token chip for a non-empty ask_agent prompt', () => {
    render(
      <StepSummary
        step={{
          id: 's1',
          kind: 'ask_agent',
          prompt: ['Say hi to ', { token: { stepId: 'builtin', output: 'today' } }],
        }}
        tokens={[TODAY]}
        catalog={CATALOG}
      />,
    );
    expect(screen.getByText('Say hi to', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders "No message yet" for an empty notify message', () => {
    render(<StepSummary step={{ id: 's1', kind: 'notify', message: [] }} tokens={[]} catalog={CATALOG} />);
    expect(screen.getByText('No message yet')).toBeInTheDocument();
  });

  it('renders the field count and labels for ask_me', () => {
    render(
      <StepSummary
        step={{
          id: 's1',
          kind: 'ask_me',
          title: 'Daily check-in',
          fields: [
            { key: 'mood', label: 'Mood', type: 'text' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ],
        }}
        tokens={[]}
        catalog={CATALOG}
      />,
    );
    expect(screen.getByText('2 fields · Mood, Notes')).toBeInTheDocument();
  });

  it('renders the catalog title once an action is picked', () => {
    render(
      <StepSummary
        step={{ id: 's1', kind: 'run_action', actionId: 'run_command', params: {} }}
        tokens={[]}
        catalog={CATALOG}
      />,
    );
    expect(screen.getByText('Run a command')).toBeInTheDocument();
  });

  it('renders "Pick an action" when no actionId is chosen yet', () => {
    render(
      <StepSummary step={{ id: 's1', kind: 'run_action', actionId: '', params: {} }} tokens={[]} catalog={CATALOG} />,
    );
    expect(screen.getByText('Pick an action')).toBeInTheDocument();
  });
});
