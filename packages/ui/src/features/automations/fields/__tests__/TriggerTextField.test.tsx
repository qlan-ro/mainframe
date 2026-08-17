/**
 * TriggerTextField — every text input in an automation: a plain autosizing textarea
 * driving the shared trigger engine. `$` (variables, from `scope`) is always
 * on; `/` (skills) and `@` (files) are added only in `triggers='all'` mode,
 * via `useAutomationTriggerSources`. TDD: test written first, implemented
 * after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project, Skill } from '@qlan-ro/mainframe-types';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn() }));
vi.mock('@/lib/api/skills', () => ({ getSkills: vi.fn() }));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn(async () => []),
  getFileTree: vi.fn(async () => []),
  browseFilesystem: vi.fn(async () => []),
}));

import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { useAutomationsStore } from '../../data/use-automations-store';
import { TriggerTextField, type TriggerTextFieldProps } from '../TriggerTextField';

const PROJECT_ID = 'p1';
const PROJECT_PATH = '/proj';
const ADAPTER_ID = 'claude';

const PROJECT_FIXTURE: Project = {
  id: PROJECT_ID,
  name: 'P',
  path: PROJECT_PATH,
  createdAt: '2026-06-06T00:00:00.000Z',
  lastOpenedAt: '2026-06-06T00:00:00.000Z',
};

function adapter(id: string) {
  return { id, name: id, description: '', installed: true, models: [], capabilities: { planMode: false } };
}

const SKILL_FIXTURE: Skill = {
  id: 'skill-1',
  adapterId: ADAPTER_ID,
  name: 'my-skill',
  displayName: 'My Skill',
  description: 'Does something useful',
  scope: 'project',
  filePath: '/proj/.claude/skills/my-skill.md',
  content: '# My Skill',
  invocationName: 'my-skill',
};

const SCOPE: TokenDescriptor[] = [
  {
    ref: { stepId: 'trigger', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'trigger',
    source: 'Trigger',
  },
];

function Field(props: Partial<TriggerTextFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  return <TriggerTextField value={value} onChange={setValue} testId="notify-message" scope={SCOPE} {...props} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAdapters();
  useAutomationsStore.setState({ scopeProjectId: null });
});

describe('TriggerTextField', () => {
  it('renders an autosizing textarea with the given testId', () => {
    render(<Field />);
    const textarea = screen.getByTestId('notify-message');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('opens the $ popover at a word start, listing in-scope names', () => {
    render(<Field />);
    const textarea = screen.getByTestId('notify-message');
    fireEvent.change(textarea, { target: { value: '$', selectionStart: 1, selectionEnd: 1 } });

    expect(screen.getByTestId('notify-message-trigger-popover')).toBeInTheDocument();
    expect(screen.getByTestId('notify-message-variable-item-trigger_result')).toBeInTheDocument();
  });

  it('picking a variable inserts the literal $name followed by one space, and closes', () => {
    render(<Field />);
    const textarea = screen.getByTestId('notify-message') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '$', selectionStart: 1, selectionEnd: 1 } });

    fireEvent.click(screen.getByTestId('notify-message-variable-item-trigger_result'));

    expect(textarea.value).toBe('$trigger_result ');
    expect(screen.queryByTestId('notify-message-trigger-popover')).not.toBeInTheDocument();
  });

  it('does not open $ mid-word — only at a word boundary', () => {
    render(<Field />);
    const textarea = screen.getByTestId('notify-message');
    fireEvent.change(textarea, { target: { value: 'costs$5', selectionStart: 7, selectionEnd: 7 } });

    expect(screen.queryByTestId('notify-message-trigger-popover')).not.toBeInTheDocument();
  });

  it("fires '/' and '@' only when triggers='all', sourced from useAutomationTriggerSources", async () => {
    seedAdapters([
      {
        id: ADAPTER_ID,
        name: ADAPTER_ID,
        description: '',
        installed: true,
        models: [],
        capabilities: { planMode: false },
      },
    ]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    render(<Field triggers="all" />);
    const textarea = screen.getByTestId('notify-message');

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());

    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getByTestId('automations-skill-item-my-skill')).toBeInTheDocument();
  });

  it("never fetches skills/files, and '/' does not open a popover, in explicit variables-only mode", async () => {
    seedAdapters([
      {
        id: ADAPTER_ID,
        name: ADAPTER_ID,
        description: '',
        installed: true,
        models: [],
        capabilities: { planMode: false },
      },
    ]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    render(<Field triggers="variables-only" />);
    const textarea = screen.getByTestId('notify-message');

    await Promise.resolve();
    expect(vi.mocked(getSkills)).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
    expect(screen.queryByTestId('notify-message-trigger-popover')).not.toBeInTheDocument();
  });

  it("defaults to 'all' when triggers is not given — matching prose fields like NotifyConfig/AutoForm", async () => {
    seedAdapters([
      {
        id: ADAPTER_ID,
        name: ADAPTER_ID,
        description: '',
        installed: true,
        models: [],
        capabilities: { planMode: false },
      },
    ]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    render(<Field />);
    const textarea = screen.getByTestId('notify-message');

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());

    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getByTestId('automations-skill-item-my-skill')).toBeInTheDocument();
  });

  it('an explicit adapterId sources skills from that adapter, not the first installed one', async () => {
    seedAdapters([adapter(ADAPTER_ID), adapter('codex')]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    render(<Field triggers="all" adapterId="codex" />);

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());
    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(0, 'codex', PROJECT_PATH);
  });

  it('omitting adapterId falls back to the first installed adapter', async () => {
    seedAdapters([adapter(ADAPTER_ID), adapter('codex')]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    render(<Field triggers="all" />);

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());
    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(0, ADAPTER_ID, PROJECT_PATH);
  });

  it('skips an installed adapter that serves no skills and lists the next one that does', async () => {
    seedAdapters([adapter('codex'), adapter(ADAPTER_ID)]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockImplementation(async (_port, id) => {
      if (id === 'codex') throw new Error('Adapter not found or does not support skills');
      return [SKILL_FIXTURE];
    });

    render(<Field triggers="all" />);

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalledTimes(2));

    const textarea = screen.getByTestId('notify-message');
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });
    expect(await screen.findByTestId('automations-skill-item-my-skill')).toBeInTheDocument();
  });

  it('Enter inserts a newline — automations fields never submit on Enter', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const textarea = screen.getByTestId('notify-message') as HTMLTextAreaElement;

    await user.click(textarea);
    await user.keyboard('a{Enter}b');

    expect(textarea.value).toBe('a\nb');
  });

  it('renders the T13 variable-picker affordance slot', () => {
    render(<Field />);
    expect(screen.getByTestId('notify-message-var-picker')).toBeInTheDocument();
  });
});
