/**
 * AgentConfig — the Agent step's composer-shaped card (todo #234 T16): a
 * prompt field with a chip toolbar beneath it (model, permission, worktree)
 * and an advanced disclosure. The chips and the advanced fields are unit
 * tested in `steps/agent/__tests__/`; this suite covers the card itself,
 * the wiring that merges each part's patch into the whole step, and that
 * the prompt field's `/` skills are sourced from the step's own
 * `adapterId` — mocking `@/lib/api/projects`/`skills`/`files` like
 * `fields/__tests__/TriggerTextField.test.tsx` does.
 *
 * No Send button: an automation step is configured, never sent — the card
 * borrows the composer's shape, not its submit affordance.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdapterInfo, Project, Skill } from '@qlan-ro/mainframe-types';
import type { AskAgentStep } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { useAutomationsStore } from '../../data/use-automations-store';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { AgentConfig, type AgentConfigProps } from '../AgentConfig';

vi.mock('@/lib/api/git', () => ({
  getGitBranches: vi.fn(async () => ({ local: [{ name: 'main' }, { name: 'dev' }], current: 'main' })),
}));
vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn() }));
vi.mock('@/lib/api/skills', () => ({ getSkills: vi.fn() }));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn(async () => []),
  getFileTree: vi.fn(async () => []),
  browseFilesystem: vi.fn(async () => []),
}));

import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';

const PROJECT_ID = 'proj-1';
const PROJECT_PATH = '/proj';

const PROJECT_FIXTURE: Project = {
  id: PROJECT_ID,
  name: 'P',
  path: PROJECT_PATH,
  createdAt: '2026-06-06T00:00:00.000Z',
  lastOpenedAt: '2026-06-06T00:00:00.000Z',
};

const SKILL_FIXTURE: Skill = {
  id: 'skill-1',
  adapterId: 'codex',
  name: 'my-skill',
  displayName: 'My Skill',
  description: 'Does something useful',
  scope: 'project',
  filePath: '/proj/.codex/skills/my-skill.md',
  content: '# My Skill',
  invocationName: 'my-skill',
};

const BASE_STEP: AskAgentStep = { id: 'a', kind: 'ask_agent', prompt: [] };
const TOKENS: TokenDescriptor[] = [
  {
    ref: { stepId: 'trigger', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'trigger',
    source: 'Trigger',
  },
];

/** `TriggerTextField` is genuinely controlled — multi-character typing needs the value fed back. */
function Field(
  props: Omit<AgentConfigProps, 'onChange' | 'step'> & {
    initial: AskAgentStep;
    onChange?: AgentConfigProps['onChange'];
  },
) {
  const { initial, onChange, ...rest } = props;
  const [step, setStep] = useState(initial);
  return (
    <AgentConfig
      {...rest}
      step={step}
      onChange={(next) => {
        setStep(next);
        onChange?.(next);
      }}
    />
  );
}

function adapter(id: string, name: string, models: AdapterInfo['models']): AdapterInfo {
  return { id, name, description: '', installed: true, models, capabilities: { planMode: false } };
}

const CLAUDE = adapter('claude', 'Claude', [
  { id: 'sonnet-5', label: 'Sonnet 5', isDefault: true },
  { id: 'opus-4', label: 'Opus 4' },
]);
const CODEX = adapter('codex', 'Codex', [{ id: 'gpt-5', label: 'GPT-5', isDefault: true }]);

beforeEach(() => {
  vi.clearAllMocks();
  useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
  resetAdapters();
  seedAdapters([CLAUDE, CODEX]);
});

afterEach(() => {
  resetAdapters();
  useAutomationsStore.setState({ scopeProjectId: null });
});

describe('AgentConfig — card', () => {
  it('renders one focus-reactive card holding the prompt and its toolbar', () => {
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    const pane = screen.getByTestId('automations-agent-a-pane');
    for (const cls of [
      'rounded-xl',
      '[border-width:0.5px]',
      'border-border',
      'bg-card',
      'shadow-sm',
      'focus-within:border-ring',
    ]) {
      expect(pane.className).toContain(cls);
    }
    expect(pane).toContainElement(screen.getByTestId('automations-agent-a-prompt'));
    expect(pane).toContainElement(screen.getByTestId('automations-agent-a-toolbar'));
  });

  it('renders the prompt as a bare field sitting flush in the card', () => {
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    const prompt = screen.getByTestId('automations-agent-a-prompt');
    expect(prompt).toHaveAttribute('placeholder', 'What should the agent do?');
    for (const cls of ['px-[14px]', 'pt-[10px]', 'pb-[4px]']) {
      expect(prompt.className).toContain(cls);
    }
    expect(screen.getByTestId('automations-agent-a-prompt-container')).toHaveStyle({ minHeight: '56px' });
  });

  it('lays the chips out in a toolbar row under the prompt', () => {
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    const toolbar = screen.getByTestId('automations-agent-a-toolbar');
    for (const cls of ['px-2.5', 'pt-[4px]', 'pb-[6px]']) {
      expect(toolbar.className).toContain(cls);
    }
    for (const part of ['model', 'permission', 'worktree', 'advanced-toggle']) {
      expect(toolbar).toContainElement(screen.getByTestId(`automations-agent-a-${part}`));
    }
  });

  it('offers no Send button — a step is configured, never sent', () => {
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  });
});

describe('AgentConfig — prompt', () => {
  it('writes typed prose into step.prompt as ChipText', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field initial={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-prompt'));
    await user.keyboard('Plan my day');
    expect(onChange).toHaveBeenLastCalledWith({ ...BASE_STEP, prompt: ['Plan my day'] });
  });

  it('opens the variable trigger popover on "$"', async () => {
    const user = userEvent.setup();
    render(<Field initial={BASE_STEP} tokens={TOKENS} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-prompt'));
    await user.keyboard('$');
    await waitFor(() => expect(screen.getByTestId('automations-agent-a-prompt-trigger-popover')).toBeInTheDocument());
  });

  it('sources the prompt field\'s "/" skills from the step\'s own adapterId, not the fallback adapter', async () => {
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    render(
      <AgentConfig
        step={{ ...BASE_STEP, adapterId: 'codex' }}
        onChange={vi.fn()}
        tokens={[]}
        testId="automations-agent-a"
      />,
    );
    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());
    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(0, 'codex', PROJECT_PATH);
  });
});

describe('AgentConfig — toolbar chips', () => {
  it('merges the model chip’s patch into the step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-model'));
    await user.click(screen.getByTestId('automations-agent-a-model-option-codex-gpt-5'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...BASE_STEP, adapterId: 'codex', model: 'gpt-5' });
  });

  it('merges the permission chip’s patch into the step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-permission'));
    await user.click(screen.getByTestId('automations-agent-a-permission-option-acceptEdits'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...BASE_STEP, permissionMode: 'acceptEdits' });
  });

  it('merges the worktree chip’s patch into the step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-worktree'));
    await user.click(screen.getByTestId('automations-agent-a-worktree-toggle'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...BASE_STEP,
      worktree: { baseBranch: 'main', branchName: [] },
    });
  });

  it('reflects the step’s own agent on the model chip', () => {
    render(
      <AgentConfig
        step={{ ...BASE_STEP, adapterId: 'codex' }}
        onChange={vi.fn()}
        tokens={[]}
        testId="automations-agent-a"
      />,
    );
    expect(screen.getByTestId('automations-agent-a-model')).toHaveTextContent('GPT-5');
  });
});

describe('AgentConfig — advanced disclosure', () => {
  it('keeps the advanced fields hidden until the toggle is opened', async () => {
    const user = userEvent.setup();
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    expect(screen.queryByTestId('automations-agent-a-timeout')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('automations-agent-a-advanced-toggle'));
    expect(screen.getByTestId('automations-agent-a-timeout')).toBeInTheDocument();
    expect(screen.getByTestId('automations-agent-a-attachments')).toBeInTheDocument();
    expect(screen.getByTestId('automations-agent-a-keepgoing')).toBeInTheDocument();
    expect(screen.getByTestId('automations-agent-a-expects-add')).toBeInTheDocument();
  });

  it('merges an advanced-field patch into the step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentConfig step={BASE_STEP} onChange={onChange} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-advanced-toggle'));
    await user.click(screen.getByTestId('automations-agent-a-keepgoing'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...BASE_STEP, keepGoing: true });
  });

  it('renders no auto-approve affordance — permissionMode is the sole execution-scope control', async () => {
    const user = userEvent.setup();
    render(<AgentConfig step={BASE_STEP} onChange={vi.fn()} tokens={[]} testId="automations-agent-a" />);
    await user.click(screen.getByTestId('automations-agent-a-advanced-toggle'));
    expect(screen.queryByTestId('automations-agent-a-approve-edits')).not.toBeInTheDocument();
  });
});
