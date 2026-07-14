/**
 * AgentConfig — prompt ChipField (slash), attachments, provider+model
 * picker; More options: worktree (branch picker), timeout, permission,
 * Expect results (A2), FailureToggle (ts153 wf2-stepconfig.jsx
 * `WfAgentConfig`, ported onto `AskAgentStep`).
 *
 * ts153's free-text "Budget cap" has no counterpart on the ratified
 * `AskAgentStep` — `timeoutMinutes: number` replaces it, contract wins over
 * the prototype. Attachments (image/file chips) WAS dropped in an earlier
 * pass as a deliberate contract-driven omission; the 2026-07-12
 * design-conformance pass reverses that and restores it (`AttachmentsField`,
 * `AskAgentStep.attachments?: string[]`).
 *
 * todo #234: the model list is now the live `useAdapters()` catalog (bullet
 * 7, replacing the hardcoded `AGENT_MODELS`/`AUTO_APPROVE_OPTIONS` arrays —
 * auto-approve is gone entirely, bullet 3), and the worktree base-branch
 * field is the shared `BranchSelect` picker fed by `getGitBranches`, scoped
 * to the automation's own resolved project (`store.activeProjectId`, bullet
 * 4) rather than a per-step project picker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import type { AskAgentStep } from '../../contract';
import { useAutomationsStore } from '../../data/use-automations-store';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { AgentConfig } from '../AgentConfig';

vi.mock('@/lib/api/git', () => ({
  getGitBranches: vi.fn(async () => ({ local: [{ name: 'main' }, { name: 'dev' }], current: 'main' })),
}));

const BASE_STEP: AskAgentStep = { id: 'a', kind: 'ask_agent', prompt: [] };

function adapter(id: string, name: string, installed: boolean, models: AdapterInfo['models']): AdapterInfo {
  return { id, name, description: '', installed, models, capabilities: { planMode: false } };
}

const CLAUDE = adapter('claude', 'Claude', true, [
  { id: 'sonnet-5', label: 'Sonnet 5', isDefault: true },
  { id: 'opus-4', label: 'Opus 4' },
]);
const CODEX = adapter('codex', 'Codex', true, [{ id: 'gpt-5', label: 'GPT-5', isDefault: true }]);

beforeEach(() => {
  useAutomationsStore.setState({ activeProjectId: 'proj-1' });
  resetAdapters();
  seedAdapters([CLAUDE, CODEX]);
});

afterEach(() => {
  resetAdapters();
});

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

  it('renders a provider+model picker fed by the live adapter catalog, defaulting to the first installed provider and its default model', () => {
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    expect(screen.getByTestId('automations-agent-a-provider')).toHaveValue('claude');
    expect(screen.getByTestId('automations-agent-a-model')).toHaveValue('sonnet-5');
  });

  it('picking a model patches step.model without touching adapterId', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.selectOptions(screen.getByTestId('automations-agent-a-model'), 'opus-4');
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, model: 'opus-4' });
  });

  it("picking a different provider patches step.adapterId and resets model to that provider's default", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.selectOptions(screen.getByTestId('automations-agent-a-provider'), 'codex');
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, adapterId: 'codex', model: undefined });
  });
});

describe('AgentConfig — More options: attachments', () => {
  it('adds a placeholder attachment to step.attachments on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-attachments-add'));
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, attachments: ['screenshot-1.png'] });
  });

  it('removes an attachment on click, leaving the rest', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskAgentStep = { ...BASE_STEP, attachments: ['a.png', 'b.md'] };
    render(<AgentConfig step={step} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));
    await user.click(screen.getByTestId('automations-agent-a-attachments-remove-0'));
    expect(onChange).toHaveBeenCalledWith({ ...step, attachments: ['b.md'] });
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

  it("renders a branch picker for base + a chip field for branch name, scoped to the automation's project; picking a branch patches baseBranch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskAgentStep = { ...BASE_STEP, worktree: { baseBranch: 'main', branchName: [] } };
    render(<AgentConfig step={step} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-more'));

    await waitFor(() =>
      expect(screen.getByTestId('automations-agent-a-worktree-base')).toHaveTextContent('main (current)'),
    );
    await user.click(screen.getByTestId('automations-agent-a-worktree-base'));
    await user.click(screen.getByTestId('automations-agent-a-worktree-base-option-dev'));

    expect(onChange).toHaveBeenLastCalledWith({ ...step, worktree: { baseBranch: 'dev', branchName: [] } });
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

it('renders no auto-approve affordance — permissionMode is the sole execution-scope control', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
  await user.click(screen.getByTestId('automations-agent-a-more'));
  expect(screen.queryByTestId('automations-agent-a-approve-edits')).not.toBeInTheDocument();
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
