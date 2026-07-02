/**
 * yaml-serialize — TDD tests for the canonical YAML serializer.
 *
 * Tests written FIRST. All should fail before the implementation exists.
 * The kid-health-log shaped draft is the hero fixture — it exercises
 * every canonical grammar token: schedule + on_missed, question + fields,
 * parallel + connector, and outputs.
 */
import { describe, it, expect } from 'vitest';
import { serializeWorkflow } from '@/features/workflows/editor/yaml-serialize';
import type { WfDraft } from '@/features/workflows/editor/yaml-serialize';

// ── Fixture: kid-health-log shaped draft ─────────────────────────────────────

const KID_HEALTH: WfDraft = {
  name: 'Daily kid health log',
  description: 'Ask a short evening health check-in, then save it to Notion and the local log.',
  scope: 'global',
  triggers: [{ kind: 'schedule', cron: '0 21 * * *', label: 'Every day at 9:00pm', onMissed: 'run_once' }],
  inputs: [],
  steps: [
    {
      id: 'q',
      kind: 'question',
      name: 'check_in',
      title: 'Evening check-in',
      timeout: { afterMinutes: 720, onTimeout: 'cancel' },
      fields: [
        { key: 'mood', type: 'choice', options: ['Great', 'OK', 'Rough'], required: true },
        { key: 'appetite', type: 'choice', options: ['Ate well', 'Picky', 'Barely ate'] },
        { key: 'sleep', type: 'number' },
        { key: 'symptoms', type: 'multi', options: ['None', 'Cough', 'Fever', 'Rash'] },
        { key: 'notes', type: 'text' },
      ],
    },
    {
      id: 'save',
      kind: 'parallel',
      title: 'Save the entry',
      lanes: [
        {
          name: 'notion',
          steps: [
            {
              kind: 'service',
              connector: 'notion',
              action: 'create_page',
              title: 'Add to Notion',
              args: { database: '"Kid health"', properties: '${ check_in.answer }' },
            },
          ],
        },
        {
          name: 'file',
          steps: [
            {
              kind: 'service',
              connector: 'files',
              action: 'append',
              title: 'Append to log',
              args: { path: 'health-log.md', text: '${ check_in.answer }' },
            },
          ],
        },
      ],
    },
  ],
  outputs: [{ name: 'summary', expr: '${ check_in.answer }' }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('serializeWorkflow', () => {
  it('emits version: 1 as the first line', () => {
    const lines = serializeWorkflow(KID_HEALTH).split('\n');
    expect(lines[0]).toBe('version: 1');
  });

  it('emits canonical name and scope lines', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('name: Daily kid health log');
    expect(yaml).toContain('scope: global');
  });

  it('emits description when present', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('description:');
  });

  it('emits schedule trigger with cron and on_missed', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('schedule:');
    expect(yaml).toContain('cron:');
    expect(yaml).toContain('0 21 * * *');
    expect(yaml).toContain('on_missed:');
    expect(yaml).toContain('run_once');
  });

  it('emits question: canonical form with fields', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('question:');
    expect(yaml).toContain('fields:');
    // field keys appear as yaml entries
    expect(yaml).toContain('key: mood');
    expect(yaml).toContain('key: appetite');
  });

  it('serializes question timeout as a structured object', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('timeout: { afterMinutes: 720, onTimeout: cancel }');
  });

  it('emits an id line for a composite (parallel) step', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('\n  - id: save\n    parallel:');
  });

  it('emits parallel: with named lanes containing connector steps', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('parallel:');
    expect(yaml).toContain('notion:');
    expect(yaml).toContain('file:');
    expect(yaml).toContain('connector: notion.create_page');
    expect(yaml).toContain('connector: files.append');
  });

  it('emits with: block for connector args', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('with:');
  });

  it('emits outputs: section', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).toContain('outputs:');
    expect(yaml).toContain('summary:');
  });

  it('does NOT use old human/if/fs grammar tokens', () => {
    const yaml = serializeWorkflow(KID_HEALTH);
    expect(yaml).not.toContain('\nhuman:');
    expect(yaml).not.toContain('\nif:');
    // service/ connector steps must use "connector:" not a stale "service:" key
    expect(yaml).not.toMatch(/^  connector:(?!.*\.)/m);
  });

  it('does NOT serialize a manual trigger and omits the triggers block when only manual', () => {
    const draft: WfDraft = {
      name: 'm',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).not.toContain('manual: true');
    expect(yaml).not.toContain('triggers:');
  });

  it('serializes inputs as a MAP (no leading dash)', () => {
    const draft: WfDraft = {
      name: 'i',
      description: '',
      scope: 'global',
      triggers: [{ kind: 'manual' }],
      inputs: [{ name: 'region', type: 'string', default: 'us-east' }],
      steps: [],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('\n  region: { type: string, default: us-east }');
    expect(yaml).not.toContain('  - region:');
  });

  it('serializes a choose (branch) step with arms', () => {
    const draft: WfDraft = {
      name: 'branch test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'b',
          kind: 'branch',
          title: 'Choose a path',
          arms: [
            { cond: '${ mood } === "Great"', steps: [] },
            { cond: 'else', steps: [] },
          ],
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('choose:');
    expect(yaml).toContain('when:');
    expect(yaml).toContain('else: true');
  });

  it('serializes a loop (foreach) step with over + as + steps', () => {
    const draft: WfDraft = {
      name: 'loop test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'l',
          kind: 'loop',
          title: 'For each item',
          over: '${ items }',
          as: 'item',
          steps: [],
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('foreach:');
    expect(yaml).toContain('as: item');
    expect(yaml).toContain('steps:');
  });

  it('serializes a subflow (call) step', () => {
    const draft: WfDraft = {
      name: 'subflow test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'sf',
          kind: 'subflow',
          title: 'Run a workflow',
          ref: 'ship-work',
          with: { target: 'main' },
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('call: ship-work');
    expect(yaml).toContain('with:');
    expect(yaml).toContain('target: main');
  });

  it('emits an id line for choose/foreach/call composites', () => {
    const draft: WfDraft = {
      name: 'ids test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        { id: 'b', kind: 'branch', title: 'Choose a path', arms: [] },
        { id: 'l', kind: 'loop', title: 'For each item', over: '${ items }', as: 'item', steps: [] },
        { id: 'sf', kind: 'subflow', title: 'Run a workflow', ref: 'ship-work' },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('\n  - id: b\n    choose:');
    expect(yaml).toContain('\n  - id: l\n    foreach:');
    expect(yaml).toContain('\n  - id: sf\n    call:');
  });

  it('serializes an agent step', () => {
    const draft: WfDraft = {
      name: 'agent test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'ag',
          kind: 'agent',
          name: 'worker',
          title: 'Ask an agent',
          prompt: 'Summarize the report.',
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('agent:');
    expect(yaml).toContain('prompt:');
    expect(yaml).toContain('Summarize the report.');
  });

  it('serializes a set step', () => {
    const draft: WfDraft = {
      name: 'set test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'v',
          kind: 'set',
          name: 'total',
          title: 'Compute total',
          value: 42,
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('set:');
    expect(yaml).toContain('total');
    expect(yaml).toContain('42');
  });

  it('serializes inputs when present', () => {
    const draft: WfDraft = {
      name: 'inputs test',
      description: '',
      scope: 'global',
      triggers: [{ kind: 'manual' }],
      inputs: [{ name: 'region', type: 'string', default: 'us-east' }],
      steps: [],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('inputs:');
    expect(yaml).toContain('region:');
    expect(yaml).toContain('type: string');
    expect(yaml).toContain('default: us-east');
  });

  it('serializes a service step with credential', () => {
    const draft: WfDraft = {
      name: 'cred test',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      steps: [
        {
          id: 'svc',
          kind: 'service',
          name: 'sender',
          connector: 'slack',
          action: 'post',
          title: 'Post to Slack',
          args: { channel: '#general', text: 'hello' },
          credential: 'slack-bot',
        },
      ],
      outputs: [],
    };
    const yaml = serializeWorkflow(draft);
    expect(yaml).toContain('connector: slack.post');
    expect(yaml).toContain('credential: slack-bot');
  });
});
