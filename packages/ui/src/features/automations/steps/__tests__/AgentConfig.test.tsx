/**
 * AgentConfig — prompt ChipField (slash), model; More options: worktree,
 * auto-approve, timeout, permission, Expect results (A2), FailureToggle
 * (ts153 wf2-stepconfig.jsx `WfAgentConfig`, ported onto `AskAgentStep`).
 *
 * ts153's "Attachments" and free-text "Budget cap" have no counterpart on
 * the ratified `AskAgentStep` (no `attachments` field at all; `timeoutMinutes:
 * number` replaces the free-text cap) — this component and its test
 * deliberately drop/adapt those, contract wins over the prototype. TDD:
 * test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AskAgentStep } from '../../contract';
import { AgentConfig } from '../AgentConfig';

const BASE_STEP: AskAgentStep = { id: 'a', kind: 'ask_agent', prompt: [] };

describe('AgentConfig — essentials', () => {
  it('renders the prompt ChipField bound to step.prompt', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-prompt'));
    await user.keyboard('Plan my day');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, prompt: ['Plan my day'] });
  });

  it('renders a model select that patches step.model', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    const select = screen.getByTestId('automations-agent-a-model');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    await user.selectOptions(select, options[1]!);
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, model: options[1] });
  });
});

describe('AgentConfig — More options: worktree', () => {
  it('shows "Run in a fresh worktree" when no worktree is set; clicking it seeds one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-worktree-add'));
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, worktree: { baseBranch: 'main', branchName: [] } });
  });

  it('renders base + branch inputs when a worktree is set, and editing base patches baseBranch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskAgentStep = { ...BASE_STEP, worktree: { baseBranch: 'main', branchName: [] } };
    render(<AgentConfig step={step} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.type(screen.getByTestId('automations-agent-a-worktree-base'), '!');
    expect(onChange).toHaveBeenLastCalledWith({
      ...step,
      worktree: { baseBranch: 'main!', branchName: [] },
    });
  });

  it('removing the worktree clears it back to undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskAgentStep = { ...BASE_STEP, worktree: { baseBranch: 'main', branchName: [] } };
    render(<AgentConfig step={step} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-worktree-remove'));
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, worktree: undefined });
  });
});

describe('AgentConfig — More options: auto-approve', () => {
  it('toggles an entry into step.autoApprove on click, and out again on a second click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-approve-edits'));
    expect(onChange).toHaveBeenLastCalledWith({ ...BASE_STEP, autoApprove: ['edits'] });
  });

  it('removes an already-active entry on a second click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskAgentStep = { ...BASE_STEP, autoApprove: ['edits', 'git'] };
    render(<AgentConfig step={step} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-approve-edits'));
    expect(onChange).toHaveBeenLastCalledWith({ ...step, autoApprove: ['git'] });
  });
});

describe('AgentConfig — More options: timeout + permission', () => {
  it('patches step.timeoutMinutes from the numeric input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.type(screen.getByTestId('automations-agent-a-timeout'), '4');
    expect(onChange).toHaveBeenLastCalledWith({ ...BASE_STEP, timeoutMinutes: 4 });
  });

  it('patches step.permissionMode from the select, offering the real execution modes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.selectOptions(screen.getByTestId('automations-agent-a-permission'), 'acceptEdits');
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, permissionMode: 'acceptEdits' });
  });
});

describe('AgentConfig — More options: expect results + failure toggle', () => {
  it('renders ExpectResultsBuilder bound to step.expects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-expects-add'));
    const call = onChange.mock.calls[0]?.[0] as AskAgentStep | undefined;
    expect(call?.expects).toHaveLength(1);
  });

  it('renders FailureToggle, patching step.keepGoing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-keepgoing'));
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, keepGoing: true });
  });
});
