/**
 * DraftPreview — read-only When/Do block list for a drafted (not-yet-saved)
 * automation (ts153 wf2-runtime.jsx `WfDraftPreview`, ported onto the real
 * `AutomationCreateInput` — no free-text `title`/`sub` per step in the wire
 * contract, so the title falls back to `stepLabel` (StepCard's own
 * precedent) and the subtitle is ask_me's joined field labels only, matching
 * ts153's own conditional). TDD: test written first, implemented after.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActionCatalogEntry, AutomationCreateInput } from '../../contract';
import { DraftPreview } from '../DraftPreview';

const CATALOG: ActionCatalogEntry[] = [
  {
    id: 'notion.add_row',
    title: 'Add a database row',
    group: 'connector',
    auth: 'token',
    paramsSchema: {},
    outputs: [],
  },
];

describe('DraftPreview — When', () => {
  it('renders a trigger chip per trigger', () => {
    const draft: AutomationCreateInput = {
      name: 'Daily health log',
      scope: 'global',
      definition: {
        triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '21:00' }, onMissed: 'run_once' }],
        steps: [],
      },
    };
    render(<DraftPreview draft={draft} catalog={CATALOG} />);
    expect(screen.getByText('Every day at 21:00')).toBeInTheDocument();
  });

  it('shows "Manually" when there are no triggers', () => {
    const draft: AutomationCreateInput = {
      name: 'Ship work',
      scope: 'project',
      definition: { triggers: [], steps: [] },
    };
    render(<DraftPreview draft={draft} catalog={CATALOG} />);
    expect(screen.getByText('Manually')).toBeInTheDocument();
  });
});

describe('DraftPreview — Do', () => {
  it('renders one line per step, with the ask_me title and its field labels as the subtitle', () => {
    const draft: AutomationCreateInput = {
      name: 'Daily health log',
      scope: 'global',
      definition: {
        triggers: [],
        steps: [
          {
            id: 'q',
            kind: 'ask_me',
            title: 'Health check-in',
            fields: [
              { key: 'mood', type: 'choice', label: 'Mood', options: ['Great'] },
              { key: 'sleep', type: 'number', label: 'Sleep' },
            ],
          },
        ],
      },
    };
    render(<DraftPreview draft={draft} catalog={CATALOG} />);
    expect(screen.getByText('Health check-in')).toBeInTheDocument();
    expect(screen.getByText('Mood, Sleep')).toBeInTheDocument();
  });

  it("uses the catalog action's title for a run_action step, with no subtitle", () => {
    const draft: AutomationCreateInput = {
      name: 'Daily health log',
      scope: 'global',
      definition: {
        triggers: [],
        steps: [{ id: 'log', kind: 'run_action', actionId: 'notion.add_row', params: {} }],
      },
    };
    render(<DraftPreview draft={draft} catalog={CATALOG} />);
    expect(screen.getByText('Add a database row')).toBeInTheDocument();
  });

  it('renders every step kind without crashing (ask_agent, notify, if, repeat)', () => {
    const draft: AutomationCreateInput = {
      name: 'Kitchen sink',
      scope: 'project',
      definition: {
        triggers: [],
        steps: [
          { id: 'a', kind: 'ask_agent', prompt: [] },
          { id: 'n', kind: 'notify', message: [] },
          { id: 'i', kind: 'if', match: 'all', conditions: [], then: [], otherwise: [] },
          { id: 'r', kind: 'repeat', items: { stepId: 'trigger', output: 'x' }, steps: [] },
        ],
      },
    };
    render(<DraftPreview draft={draft} catalog={CATALOG} />);
    expect(screen.getByText('Ask agent')).toBeInTheDocument();
    expect(screen.getByText('Notify me')).toBeInTheDocument();
    expect(screen.getByText('If … otherwise')).toBeInTheDocument();
    expect(screen.getByText('Repeat for each')).toBeInTheDocument();
  });
});
