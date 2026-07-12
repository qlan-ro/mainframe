// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations v2 · SEEDS
// The six reference automations from the spec (§12), authored in the v2
// model (When + Do, four verbs, two blocks, token chip-fields), plus run
// + notification seeds for the run view and notification artboards, and a
// mock connected-credentials map for the Connect flow.
// Chip-field values are arrays of parts: plain strings + token objects (tk).
// Depends on: wf2-base (tk, WF2_SRC).
// → window.WF2_AUTOMATIONS, WF2_RUNS_SEED, WF2_NOTIFS, WF2_CREDENTIALS
// ════════════════════════════════════════════════════════════════

// token shorthands for seeds (display info matches what steps produce)
const _agentTok = (source) => tk('Agent result', { color: WF2_SRC.agent, icon: 'sparkles', source });
const _ans = (label, source, type, options) => tk(label, { color: WF2_SRC.askme, icon: 'chat', type: type || 'text', options, source });
const _out = (label, source, opts) => tk(label, { color: WF2_SRC.action, icon: (opts && opts.icon) || 'plug', type: (opts && opts.type) || 'text', fields: opts && opts.fields, source });
const _trig = (label, opts) => tk(label, { color: WF2_SRC.trigger, icon: (opts && opts.icon) || 'bolt', type: (opts && opts.type) || 'text', fields: opts && opts.fields, source: 'Trigger' });
const _today = tk('Today', { type: 'date', color: WF2_SRC.builtin, icon: 'calendar', source: 'Built-in' });
const _item = (label, sub) => ({ ...tk(label, { color: WF2_SRC.item, icon: 'circle.dot', source: 'Repeat' }), field: sub });

let _uid = 0; const _id = (k) => k + '_' + (++_uid);

const WF2_AUTOMATIONS = [
  // ① Daily health log
  {
    id: 'auto_health', name: 'Daily health log', enabled: true, scope: 'global',
    description: 'Evening check-in, saved to Notion and the local log.',
    triggers: [{ kind: 'schedule', label: 'Every day at 21:00', at: '21:00', onMissed: true }],
    steps: [
      { id: 'q', kind: 'askme', title: 'Health check-in', fields: [
        { key: 'mood', label: 'Mood', type: 'choice', options: ['Great', 'OK', 'Rough'], required: true },
        { key: 'appetite', label: 'Appetite', type: 'choice', options: ['Ate well', 'Picky', 'Barely ate'] },
        { key: 'sleep', label: 'Hours slept', type: 'number' },
        { key: 'symptoms', label: 'Symptoms', type: 'multi', options: ['None', 'Cough', 'Fever', 'Rash', 'Other'] },
        { key: 'other', label: 'Other symptom', type: 'text', when: { key: 'symptoms', equals: 'Other' } },
      ] },
      { id: 'notion', kind: 'action', actionId: 'notion.add_row', title: 'Add to Notion', args: {
        database: 'Health Log', credential: 'Notion',
        columns: { Date: [_today], Mood: [_ans('Mood', 'Health check-in', 'choice')], Sleep: [_ans('Hours slept', 'Health check-in', 'number')], Symptoms: [_ans('Symptoms', 'Health check-in', 'list')] } } },
      { id: 'file', kind: 'action', actionId: 'files', title: 'Append to log', args: {
        op: 'Append', path: ['~/notes/kid-health-log.md'],
        text: [_today, ' — mood ', _ans('Mood', 'Health check-in', 'choice'), ', slept ', _ans('Hours slept', 'Health check-in', 'number'), 'h'] } },
    ],
  },
  // ② Daily standup
  {
    id: 'auto_standup', name: 'Daily standup', enabled: true, scope: 'global',
    description: 'Ask the agent for today’s plan, then ping me.',
    triggers: [{ kind: 'schedule', label: 'Every day at 8:00', at: '08:00', onMissed: false }],
    steps: [
      { id: 'a', kind: 'agent', title: 'Plan my day', prompt: [{ slash: '/pending-work' }], model: 'Claude Opus 4.6' },
      { id: 'n', kind: 'notify', title: 'Notify me', message: ['Your day plan is ready', ' — ', _agentTok('Plan my day')] },
    ],
  },
  // ③ PR auto-review
  {
    id: 'auto_prreview', name: 'PR auto-review', enabled: true, scope: 'project',
    description: 'Review every PR the moment it opens.',
    triggers: [{ kind: 'event', event: 'pr.opened', label: 'A pull request is opened' }],
    steps: [
      { id: 'a', kind: 'agent', title: 'Review the PR', prompt: [{ slash: '/codex-review' }, ' ', _trig('PR', { icon: 'branch', type: 'object', fields: ['URL', 'title', 'author'] })], model: 'Claude Opus 4.6' },
    ],
  },
  // ④ Morning PR sweep
  {
    id: 'auto_prsweep', name: 'Morning PR sweep', enabled: false, scope: 'project',
    description: 'Every weekday, review all my open PRs.',
    triggers: [{ kind: 'schedule', label: 'Weekdays at 9:00', at: '09:00', days: 'weekdays', onMissed: false }],
    steps: [
      { id: 'list', kind: 'action', actionId: 'github.list_prs', title: 'List my open PRs', args: { credential: 'GitHub' } },
      { id: 'loop', kind: 'repeat', title: 'Repeat for each', list: [_out('Open PRs', 'List my open PRs', { type: 'list', icon: 'branch', fields: ['URL', 'title', 'author'] })], steps: [
        { id: 'a', kind: 'agent', title: 'Review it', prompt: [{ slash: '/codex-review' }, ' ', _item('Current PR', 'URL')], model: 'Claude Opus 4.6' },
      ] },
    ],
  },
  // ⑤ Ship work — HERO (mixed determinism + branch)
  {
    id: 'auto_ship', name: 'Ship work', enabled: true, scope: 'project',
    description: 'Link a tracker item, open a PR, then tidy the worktree.',
    triggers: [{ kind: 'manual', label: 'Manually' }],
    steps: [
      { id: 'q', kind: 'askme', title: 'Link an ADO item?', fields: [
        { key: 'action', label: 'What to do', type: 'choice', options: ['Link existing', 'Create new', 'Skip'], required: true },
        { key: 'ado_id', label: 'Existing item ID', type: 'text', when: { key: 'action', equals: 'Link existing' } },
        { key: 'title', label: 'New item title', type: 'text', when: { key: 'action', equals: 'Create new' } },
        { key: 'description', label: 'Description', type: 'textarea', when: { key: 'action', equals: 'Create new' } },
      ] },
      { id: 'if', kind: 'if', title: 'If … otherwise', match: 'all',
        conditions: [{ token: _ans('What to do', 'Link an ADO item?', 'choice', ['Link existing', 'Create new', 'Skip']), comparator: 'is', value: 'Create new' }],
        then: [
          { id: 'ado', kind: 'action', actionId: 'ado.create_item', title: 'Create work item', args: { type: 'Task', title: [_ans('New item title', 'Link an ADO item?')], description: [_ans('Description', 'Link an ADO item?')], credential: 'Azure DevOps' } },
        ],
        else: [] },
      { id: 'pr', kind: 'action', actionId: 'github.create_pr', title: 'Open the PR', args: {
        title: [_ans('New item title', 'Link an ADO item?')],
        body: ['Ships the work. ', 'AB#', _out('Work item ID', 'Create work item', { type: 'number', icon: 'checklist.box' })],
        base: 'main', credential: 'GitHub' } },
      { id: 'a', kind: 'agent', title: 'Tidy up', prompt: ['Remove the worktree for ', _trig('branch', { icon: 'worktree' }), ' and leave everything consistent.'], model: 'Claude Opus 4.6' },
    ],
  },
  // ⑥ Daily feature spike (agent-heavy)
  {
    id: 'auto_spike', name: 'Daily feature spike', enabled: false, scope: 'project',
    description: 'Every weekday morning, autonomously ship one small feature.',
    triggers: [{ kind: 'schedule', label: 'Weekdays at 6:00', at: '06:00', days: 'weekdays', onMissed: false }],
    steps: [
      { id: 'a', kind: 'agent', title: 'Pick & ship a feature', model: 'Claude Opus 4.6',
        prompt: ['Read docs/ideas and recent commits. Pick ONE xs/s feature — if nothing qualifies, stop and say why. Plan, TDD-implement until green, push, then ', { slash: '/ship-work' }, '.'],
        more: { worktree: { base: 'main', branch: 'spike/auto' }, autoApprove: ['edits', 'pnpm', 'git'], cap: '$4.00', permission: 'acceptEdits' } },
    ],
  },
];

// ── Run seeds (for the Run view) ──────────────────────────────────────
const WF2_RUNS_SEED = [
  { id: 'r_ship', automationId: 'auto_ship', name: 'Ship work', status: 'waiting', started: 'Today 14:22', trigger: 'Manual',
    timeline: [
      { kind: 'askme', title: 'Link an ADO item?', status: 'waiting', note: 'Waiting for your answer', form: 'q' },
      { kind: 'if', title: 'If … otherwise', status: 'skipped' },
      { kind: 'action', title: 'Open the PR', status: 'skipped' },
      { kind: 'agent', title: 'Tidy up', status: 'skipped' },
    ] },
  { id: 'r_sweep', automationId: 'auto_prsweep', name: 'Morning PR sweep', status: 'running', started: 'Today 09:00', trigger: 'Schedule',
    timeline: [
      { kind: 'action', title: 'List my open PRs', status: 'succeeded', duration: '0.6s', output: '3 open PRs' },
      { kind: 'repeat', title: 'Repeat for each · PR 3 of 3', status: 'running', children: [
        { kind: 'agent', title: 'Review it · #2118', status: 'succeeded', duration: '1m 40s', chat: true },
        { kind: 'agent', title: 'Review it · #2124', status: 'failed', continued: true, duration: '12s', error: 'Rate limited by GitHub — skipped this PR and kept going.' },
        { kind: 'agent', title: 'Review it · #2131', status: 'running', duration: '48s', chat: true },
      ] },
    ] },
  { id: 'r_review', automationId: 'auto_prreview', name: 'PR auto-review', status: 'failed', started: 'Today 11:04', trigger: 'PR opened',
    timeline: [
      { kind: 'agent', title: 'Review the PR', status: 'failed', duration: '22s', error: 'The agent could not check out the branch — worktree was locked by another session.' },
    ] },
  { id: 'r_health', automationId: 'auto_health', name: 'Daily health log', status: 'succeeded', started: 'Yesterday 21:00', trigger: 'Schedule',
    timeline: [
      { kind: 'askme', title: 'Health check-in', status: 'succeeded', duration: 'answered 21:14', output: 'Mood OK · slept 9h · no symptoms' },
      { kind: 'action', title: 'Add to Notion', status: 'succeeded', duration: '0.5s', output: 'Row added' },
      { kind: 'action', title: 'Append to log', status: 'succeeded', duration: '0.1s' },
    ] },
];

// ── Notification seeds ────────────────────────────────────────────────
const WF2_NOTIFS = [
  { id: 'n1', type: 'form', title: 'Daily health log', body: 'Health check-in is waiting for you', when: '2h ago', action: 'Answer' },
  { id: 'n2', type: 'done', title: 'Daily standup', body: 'Your day plan is ready', when: '8:01', action: 'Open chat' },
  { id: 'n3', type: 'failed', title: 'PR auto-review', body: 'Step “Review the PR” failed — worktree was locked', when: '11:04', action: 'View run' },
];

// ── Mock connected credentials (Connect flow) ─────────────────────────
const WF2_CREDENTIALS = { GitHub: 'glenn@github', Notion: 'Glenn’s workspace' /* Azure DevOps + others unconnected */ };

Object.assign(window, { WF2_AUTOMATIONS, WF2_RUNS_SEED, WF2_NOTIFS, WF2_CREDENTIALS });
