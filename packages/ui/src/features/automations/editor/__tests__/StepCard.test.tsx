/**
 * StepCard — leaf card chrome: grip, icon, title, summary, issue strip,
 * "Set up" disclosure (ts153 wf2-editor.jsx `WfStepCard`'s non-block
 * branch). TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, AutomationStep } from '../../contract';
import type { ValidationIssue } from '../../domain/validate';
import { StepCard } from '../StepCard';

const NO_CATALOG: ActionCatalogEntry[] = [];

describe('StepCard — issue strip', () => {
  it("shows the issue strip only when there is an issue pinned to this step's id", () => {
    const step: AutomationStep = { id: 'a', kind: 'notify', message: [] };
    const issues: ValidationIssue[] = [{ stepId: 'b', level: 'error', msg: 'Some other step is broken.' }];
    render(
      <StepCard
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={issues}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.queryByText('Some other step is broken.')).not.toBeInTheDocument();
  });

  it("renders the issue message when it is pinned to this step's id", () => {
    const step: AutomationStep = { id: 'a', kind: 'notify', message: [] };
    const issues: ValidationIssue[] = [{ stepId: 'a', level: 'error', msg: 'No message yet.' }];
    render(
      <StepCard
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={issues}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('No message yet.')).toBeInTheDocument();
  });

  it('renders only the issues pinned to this step when multiple steps have issues', () => {
    const step: AutomationStep = { id: 'a', kind: 'notify', message: [] };
    const issues: ValidationIssue[] = [
      { stepId: 'a', level: 'error', msg: 'Issue for a.' },
      { stepId: 'b', level: 'error', msg: 'Issue for b.' },
      { stepId: 'a', level: 'warning', msg: 'Second issue for a.' },
    ];
    render(
      <StepCard
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={issues}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('Issue for a.')).toBeInTheDocument();
    expect(screen.getByText('Second issue for a.')).toBeInTheDocument();
    expect(screen.queryByText('Issue for b.')).not.toBeInTheDocument();
  });
});

describe('StepCard — title editing', () => {
  it('renders an editable title input for ask_me, bound to step.title', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AutomationStep = { id: 'a', kind: 'ask_me', title: 'Daily check-in', fields: [] };
    render(
      <StepCard
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={[]}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    const input = screen.getByTestId('automations-step-title-a');
    expect(input).toHaveValue('Daily check-in');
    await user.type(input, '!');
    expect(onChange).toHaveBeenCalledWith({ ...step, title: 'Daily check-in!' });
  });

  it('renders the static verb label, not an editable input, for ask_agent', () => {
    const step: AutomationStep = { id: 'a', kind: 'ask_agent', prompt: [] };
    render(
      <StepCard
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={[]}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('Ask agent')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('StepCard — deletion and setup toggle', () => {
  it('clicking delete calls onChange(null)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AutomationStep = { id: 'a', kind: 'notify', message: [] };
    render(
      <StepCard
        step={step}
        onChange={onChange}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={[]}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('automations-step-delete-a'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('toggles the "Set up" disclosure open and closed', async () => {
    const user = userEvent.setup();
    const step: AutomationStep = { id: 'a', kind: 'notify', message: [] };
    render(
      <StepCard
        step={step}
        onChange={vi.fn()}
        tokens={[]}
        catalog={NO_CATALOG}
        issues={[]}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('automations-step-config-a')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('automations-step-setup-a'));
    expect(screen.getByTestId('automations-step-config-a')).toBeInTheDocument();
    await user.click(screen.getByTestId('automations-step-setup-a'));
    expect(screen.queryByTestId('automations-step-config-a')).not.toBeInTheDocument();
  });
});
