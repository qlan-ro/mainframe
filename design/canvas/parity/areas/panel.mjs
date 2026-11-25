import { P, PREFS, TABS, base, closeWorkspace } from './common.mjs';

const sec = (name) => `q('#spanel section[aria-label="${name}"]')`;
const asec = (name) => `q('[data-testid=session-panel-root] section[aria-label="${name}"]')`;
const SECTIONS = ['Pull requests', 'Plan', 'Activity', 'Launch', 'Memory files', 'Mentioned files', 'Skills', 'Attachments', 'Project tasks'];
const sections = SECTIONS.map((n) => ({ id: n, p: sec(n), a: asec(n), box: ['', 'y', '', 'height'].map((x) => x), reach: 24 }));
const docked = "tid('session-panel')";
const panel = { id: 'panel card', p: "q('#spanel')", a: `${docked} ?? tid('session-panel-overlay')`, only: 'box' };
const head = { id: 'panel header', p: "q('#spanel .ph')", a: `(${docked} ?? tid('session-panel-overlay')).firstElementChild` };
const shot = { p: "q('#spanel')", a: `${docked} ?? tid('session-panel-overlay')` };

export default {
  id: 'panel',
  states: [
    { id: 'docked', title: 'Session panel, docked', ...base, views: ['wide'], pairs: [panel, head, ...sections], shot },
    {
      id: 'docked-scrolled',
      title: 'Session panel, scrolled to its end',
      ...base,
      views: ['wide'],
      proto: async (page) => {
        await P.preset('idle')(page);
        await P.js("document.querySelector('#spanel').scrollTop = 9999")(page);
      },
      app: async (page) => {
        await closeWorkspace(page);
        await P.js("document.querySelector('[data-testid=session-panel]').scrollTop = 9999")(page);
      },
      pairs: [head],
      shot,
    },
    {
      id: 'floating',
      title: 'Session panel, floating',
      ...base,
      // Opening the panel reads the launch status, and a running configuration would open the workspace.
      scenario: { launch: 'two-stopped' },
      views: ['mid'],
      proto: async (page) => {
        await P.preset('idle')(page);
        await P.click("q('#ptoggle')")(page);
        await P.park(page);
      },
      app: async (page) => {
        await closeWorkspace(page);
        await P.click("tid('session-panel-toggle')")(page);
        await P.park(page);
      },
      pairs: [panel, head, { id: 'scrim', p: "q('#pscrim')", a: "tid('session-panel-scrim')" }],
      shot: true,
    },
    {
      id: 'plan-open',
      title: 'Plan unfolded',
      ...base,
      views: ['wide'],
      proto: async (page) => {
        await P.preset('idle')(page);
        await P.click(`q('[data-pk=plan]')`)(page);
      },
      app: async (page) => {
        await closeWorkspace(page);
        await P.click("tid('session-panel-plan-toggle')")(page);
      },
      pairs: [sections[1]],
      shot: { p: sec('Plan'), a: asec('Plan') },
    },
    {
      id: 'earlier-open',
      title: 'Earlier unfolded',
      ...base,
      scenario: { earlierRows: 3 },
      views: ['wide'],
      proto: async (page) => {
        await P.preset('idle')(page);
        await P.click(`q('[data-pk=earlier]')`)(page);
      },
      app: async (page) => {
        await closeWorkspace(page);
        await P.click("tid('session-panel-activity-earlier')")(page);
      },
      pairs: [{ ...sections[2] }],
      shot: { p: sec('Activity'), a: asec('Activity'), own: true },
    },
    {
      id: 'needs-you',
      title: 'An agent needs you',
      ...base,
      scenario: { act: 'need' },
      views: ['wide'],
      proto: P.preset('needs-you'),
      pairs: [sections[2]],
      shot: { p: sec('Activity'), a: asec('Activity') },
    },
    {
      id: 'row-hover',
      title: 'A panel row hovered',
      ...base,
      views: ['wide'],
      proto: async (page) => {
        await P.preset('idle')(page);
        await P.hover(`txt('#spanel button.pr', 'review-workflow.md')`)(page);
      },
      app: async (page) => {
        await closeWorkspace(page);
        await P.hover(`txt('[data-testid=session-panel] button', 'review-workflow.md')`)(page);
      },
      pairs: [{ id: 'hovered row', p: "txt('#spanel button.pr', 'review-workflow.md')", a: "txt('[data-testid=session-panel] button', 'review-workflow.md')" }],
    },
    {
      id: 'attachments-overflow',
      title: 'Attachments, more than one row',
      ...base,
      scenario: { attachments: 8 },
      views: ['wide'],
      proto: P.preset('attachments-overflow'),
      app: async (page) => {
        await closeWorkspace(page);
        await P.js("document.querySelector('[data-testid=session-panel-attachment-grid]').scrollIntoView({ block: 'center' })")(page);
      },
      pairs: [{ ...sections[7], noBox: true }],
      shot: { p: sec('Attachments'), a: asec('Attachments'), own: true },
    },
    {
      id: 'sections-menu',
      title: 'Sections menu',
      ...base,
      views: ['wide'],
      proto: P.all(P.preset('idle'), P.openByKey("q('[data-id=sections]')")),
      app: async (page) => {
        await closeWorkspace(page);
        await P.openByKey("tid('session-panel-sections-menu')")(page);
      },
      pairs: [
        { id: 'menu', p: "q('.menu')", a: "q('[role=menu]')" },
        { id: 'sections button, open', p: "q('[data-id=sections]')", a: "tid('session-panel-sections-menu')" },
      ],
      shot: { p: "q('.menu')", a: "q('[role=menu]')" },
    },
    {
      id: 'empty',
      title: 'Nothing running',
      ...base,
      scenario: { act: 'none' },
      views: ['wide'],
      proto: P.preset('idle-quiet'),
      pairs: [sections[2]],
      shot: { p: sec('Activity'), a: asec('Activity') },
    },
  ].map((state) => ({ ...state, scenario: { ...state.scenario, panelTaskTitles: true } })),
};
void PREFS;
void TABS;
