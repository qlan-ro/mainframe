/**
 * ActionConfig — picked-action header + Change; embeds ActionCatalog when
 * unpicked (ts153 wf2-stepconfig.jsx `WfActionConfig`, ported onto the
 * contract's `RunActionStep` — `actionId`/`credential`/`params`/`outputAs`
 * are all top-level, never nested under an `args` bag). TDD: test written
 * first, implemented after.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsStore } from '../../data/use-automations-store';
import { ACTION_CATALOG_FIXTURE } from '../../fixtures/action-catalog';
import type { RunActionStep } from '../../contract';
import { ActionConfig } from '../ActionConfig';

/**
 * Holds the step the way the editor does. The param fields are fully
 * controlled, so a static `step` prop would feed every keystroke back the
 * original value and only the last character would survive.
 */
function StatefulActionConfig({ step, onChange }: { step: RunActionStep; onChange: (next: RunActionStep) => void }) {
  const [current, setCurrent] = useState(step);
  return (
    <ActionConfig
      step={current}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
      tokens={[]}
      catalog={ACTION_CATALOG_FIXTURE}
      testId="automations-action-a"
    />
  );
}

describe('ActionConfig — unpicked', () => {
  it('embeds the ActionCatalog when actionId is empty, and picking sets actionId', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: '', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-catalog')).toBeInTheDocument();
    await user.click(screen.getByTestId('automations-action-a-catalog-action-run_command'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'run_command' }));
  });

  it('embeds the catalog when actionId points at an unknown action (deleted/unrecognized)', () => {
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'not.a.real.action', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-catalog')).toBeInTheDocument();
  });
});

describe('ActionConfig — picked, no credential (run_command)', () => {
  it('renders the header with the action title and a Change button', () => {
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'run_command', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-header')).toHaveTextContent('Run a command');
    expect(screen.getByTestId('automations-action-a-change')).toBeInTheDocument();
  });

  it('clicking Change re-opens the catalog and picking a different action replaces actionId and clears params', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: RunActionStep = {
      id: 'a',
      kind: 'run_action',
      actionId: 'run_command',
      params: { script: ['echo hi'] },
    };
    render(
      <ActionConfig
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    await user.click(screen.getByTestId('automations-action-a-change'));
    await user.click(screen.getByTestId('automations-action-a-catalog-action-files.read'));
    expect(onChange).toHaveBeenCalledWith({ id: 'a', kind: 'run_action', actionId: 'files.read', params: {} });
  });

  it('renders AutoForm bound to step.params and forwards param edits via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'files.read', params: {} };
    render(<StatefulActionConfig step={step} onChange={onChange} />);
    await user.click(screen.getByTestId('automations-action-a-form-path'));
    await user.keyboard('~/notes/log.md');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({
      id: 'a',
      kind: 'run_action',
      actionId: 'files.read',
      params: { path: ['~/notes/log.md'] },
    });
  });

  it('does not render a credential row for run_command (auth: none)', () => {
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'run_command', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.queryByTestId('automations-action-a-credential-connect')).not.toBeInTheDocument();
  });

  it('renders the CommandPreview for run_command, reflecting params.script', () => {
    const step: RunActionStep = {
      id: 'a',
      kind: 'run_action',
      actionId: 'run_command',
      params: { script: ['echo hi'] },
    };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-preview-text')).toHaveTextContent('echo hi');
  });

  it('does not render CommandPreview for a non-run_command action', () => {
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
    expect(screen.queryByTestId('automations-action-a-preview-text')).not.toBeInTheDocument();
  });

  it('renders FailureToggle under More options, patching step.keepGoing', async () => {
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
    await user.click(screen.getByTestId('automations-action-a-more'));
    await user.click(screen.getByTestId('automations-action-a-keepgoing'));
    expect(onChange).toHaveBeenCalledWith({ ...step, keepGoing: true });
  });
});

describe('ActionConfig — picked, credential required (notion.add_row)', () => {
  it('renders a CredentialConnect row using the catalog credentialLabelHint, patching step.credential', async () => {
    const user = userEvent.setup();
    useAutomationsStore.setState({ credentials: [] });
    const onChange = vi.fn();
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'notion.add_row', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.getByTestId('automations-action-a-credential-connect')).toHaveTextContent('Connect Notion…');
    await user.click(screen.getByTestId('automations-action-a-credential-connect'));
    expect(onChange).toHaveBeenCalledWith({ ...step, credential: 'Notion' });
  });

  it('asks for no credential on a GitHub action — the `gh` CLI holds that token', () => {
    useAutomationsStore.setState({ credentials: [] });
    const step: RunActionStep = { id: 'a', kind: 'run_action', actionId: 'github.create_pr', params: {} };
    render(
      <ActionConfig
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={ACTION_CATALOG_FIXTURE}
        testId="automations-action-a"
      />,
    );
    expect(screen.queryByTestId('automations-action-a-credential-connect')).not.toBeInTheDocument();
  });
});
