import { P, base, closeWorkspace } from './common.mjs';

const work = [{ id: 'work header', p: "q('#thread .wk')", a: "q('[data-testid^=chat-work-header-]')" }];
const show = (selector) => P.js(`(${selector})?.scrollIntoView({ block: 'center' })`);
const isolate = (selector, candidates) =>
  P.js(`(() => {
    const target = (${selector})?.closest(${JSON.stringify(candidates)});
    if (!target) return;
    for (const row of document.querySelectorAll('#thread ' + ${JSON.stringify(candidates)})) {
      if (row !== target && !row.contains(target)) row.style.setProperty('display', 'none', 'important');
    }
  })()`);
const open = (selector) =>
  P.js(`(() => {
  const button = ${selector};
  if (button?.getAttribute('aria-expanded') === 'false') button.click();
})()`);
const protoWork = "q('#thread .wkt')";
const appWork = "q('[data-testid^=chat-work-toggle-]')";
const statsToggle = `q('.wkt[aria-label*="ran 1 command, 7 ways"]')`;
const statsRows = `${statsToggle}?.parentElement?.nextElementSibling`;
const statsRow = (index) => `${statsRows}?.querySelectorAll('.tcr')[${index}]`;
const shot = { p: "q('#thread')", a: "tid('chat-thread-viewport')" };
const state = (id, proto = [], app = [], pairs = work, transcript = 'tools') => ({
  ...base,
  id,
  title: id,
  shot,
  scenario: {
    transcript,
    act: 'none',
    ...(transcript === 'live command' || transcript === 'awaitingApproval' ? { running: true } : {}),
  },
  proto: P.all(P.preset('every-tool'), ...proto),
  app: P.all(closeWorkspace, ...app),
  pairs,
});
const tool = (id, label, protoHeader = protoWork, occurrence = 0, transcript = 'tools') => {
  const protoToggle = `[...document.querySelectorAll('#thread .tct')].filter((button) => button.getAttribute('aria-label').startsWith(${JSON.stringify(label)}))[${occurrence}]`;
  const appRoot = `tid('chat-row-parity-${id}')`;
  const appToggle = `tid('chat-row-parity-${id}-toggle')`;
  const isolated = state(
    id,
    [open(protoHeader), open(protoToggle), isolate(protoToggle, '.tc'), show(protoToggle)],
    [open(appWork), open(appToggle), show(appRoot)],
    [
      { id: 'tool row', p: `${protoToggle}?.parentElement`, a: `${appRoot}?.firstElementChild` },
      {
        id: 'tool body',
        p: `${protoToggle}?.closest('.tc')?.querySelector('.tcb')`,
        a: `tid('chat-row-parity-${id}-body')`,
      },
    ],
    transcript,
  );
  return {
    ...isolated,
    scenario: { ...isolated.scenario, transcriptCall: `parity-${id}` },
    pairs: isolated.pairs.map((pair) => ({ ...pair, local: true })),
  };
};

const secondaryTools = "qa('#thread .wkt')[1]";
const marker = (id, label, name) => {
  const p = `txt('.mkp', ${JSON.stringify(label)})`;
  const a = `tid('chat-marker-${name}')`;
  const isolated = state(
    id,
    [isolate(p, '.mk'), show(p)],
    [show(a)],
    [{ id: 'event marker', p, a, local: true }],
    'markers',
  );
  return {
    ...isolated,
    scenario: { ...isolated.scenario, transcriptCall: id === 'notification' ? 'parity-notify' : `parity-${id}` },
  };
};

export default {
  id: 'transcript',
  states: [
    state(
      'work collapsed',
      [],
      [],
      [
        ...work,
        { id: 'user bubble', p: "q('#thread .bubble')", a: "tid('chat-user-bubble')" },
        { id: 'reply', p: "q('#thread .ans')", a: "tid('chat-answer')" },
      ],
    ),
    state(
      'grouped exploration',
      [open(protoWork), open("q('.tct[aria-label^=Explored]')"), show("q('.tct[aria-label^=Explored]')")],
      [
        open(appWork),
        open("tid('chat-explore-parity-explore-0-toggle')"),
        show("tid('chat-explore-parity-explore-0')"),
      ],
      [
        {
          id: 'exploration row',
          local: true,
          p: "q('.tct[aria-label^=Explored]')?.parentElement",
          a: "tid('chat-explore-parity-explore-0')?.firstElementChild",
        },
        {
          id: 'exploration steps',
          local: true,
          p: "q('.tct[aria-label^=Explored]')?.closest('.tc')?.querySelector('.tck')",
          a: "tid('chat-explore-parity-explore-0-body')",
        },
      ],
      'exploration',
    ),
    tool('image', 'Read docs/screenshot-capsule.png', secondaryTools, 0, 'extraTools'),
    state(
      'workflow row',
      [open("qa('#thread .wkt')[3]"), show("txt('#thread .tcr', 'Started workflow')")],
      [open(appWork), show("tid('chat-workflow-launcher-parity-review')")],
      [
        {
          id: 'workflow row',
          p: "qa('#thread .tcr').find((row) => row.textContent.includes('review-changes'))",
          a: "tid('chat-workflow-launcher-parity-review')?.firstElementChild",
          local: true,
        },
      ],
      'extraTools',
    ),
    state(
      'artifact row',
      [],
      [open(appWork), show("tid('chat-row-parity-artifact')")],
      [
        {
          id: 'artifact row',
          p: "qa('#thread .tcr').find((row) => row.textContent.includes('Publish artifact'))",
          a: "tid('chat-row-parity-artifact')?.firstElementChild",
          local: true,
        },
      ],
      'extraTools',
    ),
    {
      ...state(
        'workspace agent body',
        [open(secondaryTools), P.js("q('.tca[data-wsagent=agent]')?.click()")],
        [open(appWork), P.js("tid('chat-task-open-parity-agent')?.click()")],
        [{ id: 'workspace agent body', p: "q('.agw')", a: "tid('workspace-agent-parity-agent')", local: true }],
        'agent',
      ),
      shot: { p: "q('#wsp')", a: "tid('workspace-surface')", own: true },
    },
    tool('read', 'Read quota/use-quota.ts'),
    tool('write', 'Wrote src/codex_tests.rs'),
    tool('edit', 'Edited src/codex.rs'),
    tool('grep', 'Searched "resets_at"'),
    tool('glob', 'Found'),
    tool('bash', 'Ran cargo test -p mainframe-quota codex'),
    tool('fetch', 'Fetched'),
    tool('search', 'Searched the web'),
    tool('list', 'Listed packages/core-rs/crates'),
    tool('mcp', 'Called get_issue', secondaryTools),
    tool('lsp', 'Called LSP', secondaryTools),
    tool('dynamic', 'Called docs__search', secondaryTools),
    tool('error', 'Called get_issue', secondaryTools, 1),
    tool('truncated', 'Ran pnpm --filter @qlan-ro/mainframe-ui exec vitest run use-quota'),
    {
      ...state(
        'todo',
        [],
        [],
        [{ id: 'todo row', p: "txt('#thread .tv', 'TodoWrite')", a: "tid('chat-row-parity-todo')", optional: true }],
        'todo',
      ),
    },
    marker('skill', 'Used skill', 'skill'),
    marker('wakeup', 'Scheduled a wakeup', 'schedulewakeup'),
    marker('cron-create', 'Scheduled weekdays', 'croncreate'),
    marker('cron-delete', 'Removed schedule', 'crondelete'),
    marker('cron-list', 'Listed schedules', 'cronlist'),
    marker('monitor', 'Monitored', 'monitor'),
    marker('enter-worktree', 'Entered worktree', 'enterworktree'),
    marker('exit-worktree', 'Left worktree', 'exitworktree'),
    marker('notification', 'Notified', 'pushnotification'),
    state(
      'agent',
      [open("qa('#thread .wkt')[1]"), show("q('.tca[data-wsagent=agent]')")],
      [open(appWork), show("tid('chat-row-parity-agent')")],
      [
        {
          id: 'agent row',
          p: "q('.tca[data-wsagent=agent]')?.closest('.tcr')",
          a: "tid('chat-row-parity-agent')?.firstElementChild",
        },
      ],
      'agent',
    ),
    state(
      'delegated',
      [open("qa('#thread .wkt')[2]")],
      [open(appWork)],
      [
        'Check the mobile capsule',
        'Write the weekly-window crate test',
        'Update the changelog for v2.15.1',
        'Review the quota reset diff',
        'Regenerate the API types',
        'Draft the release notes',
        'Profile the capsule render',
      ].map((title, index) => ({
        id: `delegated row ${index + 1}`,
        p: `qa('#thread .tcr').find((e) => e.textContent.includes(${JSON.stringify(title)}) && e.textContent.includes('Delegated'))`,
        a: `qa('[data-testid=chat-tool-delegate-task-card]')[${index}]?.firstElementChild`,
      })),
      'delegated',
    ),
    state(
      'plan',
      [show("txt('.mkp', 'Updated plan')")],
      [show("tid('chat-marker-exitplanmode')")],
      [{ id: 'plan marker', p: "txt('.mkp', 'Updated plan')", a: "tid('chat-marker-exitplanmode')", local: true }],
      'markers',
    ),
    state(
      'question',
      [show("q('#thread .qa')")],
      [show("tid('chat-ask-card')")],
      [{ id: 'question card', p: "q('#thread .qa')", a: "tid('chat-ask-card')", local: true }],
      'markers',
    ),
    state(
      'links',
      [show("q('#thread .ans .mdlink')")],
      [show("q('[data-testid=chat-answer] .mf-link')")],
      [{ id: 'web link', p: "q('#thread .ans .mdlink')", a: "q('[data-testid=chat-answer] .mf-link')" }],
      'links',
    ),
    state(
      'terminal states',
      [open(statsToggle), show(statsToggle)],
      [open(appWork)],
      [
        { id: 'work header', local: true, p: `${statsToggle}?.parentElement`, a: work[0].a },
        {
          id: 'no-result command',
          local: true,
          p: statsRow(6),
          a: "tid('chat-row-parity-running')?.firstElementChild",
        },
        {
          id: 'declined command',
          p: statsRow(4),
          local: true,
          a: "tid('chat-row-parity-declined')?.firstElementChild",
        },
        ...['passed', 'failed', 'stopped'].map((status, index) => ({
          id: `${status} command`,
          local: true,
          p: statsRow(index + 1),
          a: `tid('chat-row-parity-${status}')?.firstElementChild`,
        })),
      ],
      'states',
    ),
    state(
      'approval command',
      [open(statsToggle), show(statsToggle)],
      [open(appWork)],
      [
        {
          id: 'approval command',
          local: true,
          p: statsRow(5),
          a: "tid('chat-row-parity-approval')?.firstElementChild",
        },
      ],
      'awaitingApproval',
    ),
    state(
      'running command',
      [open(statsToggle), show(statsToggle)],
      [open(appWork)],
      [{ id: 'running command', p: statsRow(0), a: "tid('chat-row-parity-running')?.firstElementChild" }],
      'live command',
    ),
  ],
};
