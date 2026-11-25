import { prototypeWindow } from '../prototype-data.mjs';
import { P, PREFS, TABS, base, closeWorkspace } from './common.mjs';

const rail = (n) => `document.querySelectorAll('#rail .rb')[${n}]`;
const titleBar = [
  { id: 'title bar', p: "q('.titlebar')", a: "tid('title-bar')", box: ['x', 'y', 'width', 'height'], reach: 30, shallow: true },
  { id: 'usage capsule', p: "q('#capsule')", a: "tid('usage-capsule')" },
  { id: 'first separator', p: "q('.tsep')", a: "tid('title-bar-separator-sidebar')" },
  { id: 'selected session tab', p: "q('#tabs .tab[aria-selected=true]')", a: "tid('session-tab-s1')" },
  { id: 'other session tab', p: "qa('#tabs .tab')[1]", a: "tid('session-tab-s2')" },
  { id: 'new tab button', p: "q('#tabnew')", a: "tid('session-tabs-new')" },
  { id: 'search button', p: "q('#tsearch')", a: "tid('main-toolbar-search')" },
  { id: 'chat toggle', p: "q('#vchat')", a: "tid('surface-rail-chat')" },
  { id: 'workspace toggle', p: "q('#vcode')", a: "tid('surface-rail-workspace')" },
];
const railPairs = [
  { id: 'rail', p: "q('#rail')", a: "tid('shell-rail')", only: 'box' },
  { id: 'rail chats (selected)', p: rail(0), a: "tid('shell-rail-chats')" },
  { id: 'rail board', p: rail(1), a: "tid('shell-rail-tasks')" },
  { id: 'rail automations', p: rail(2), a: "tid('shell-rail-automations')" },
  { id: 'rail inspector', p: rail(3), a: "tid('shell-rail-advisor')" },
  { id: 'rail daemon', p: rail(4), a: "tid('shell-rail-daemon')" },
  { id: 'rail theme', p: rail(5), a: "tid('shell-rail-appearance')" },
  { id: 'rail settings', p: rail(6), a: "tid('shell-rail-settings')" },
];
const sidebar = [
  { id: 'sidebar', p: "q('#side')", a: "q('[data-slot=sidebar]')", only: 'box' },
  { id: 'sidebar title', p: "q('.shd0 h2')", a: "txt('[data-slot=sidebar-header] span', 'Chats')", noBox: true, abs: true },
  { id: 'sidebar search', p: "q('#sbsearch')", a: "tid('sidebar-search')" },
  { id: 'sidebar collapse', p: "q('#sbcollapse')", a: "tid('sidebar-collapse')" },
  { id: 'new session', p: "q('.newrow')", a: "tid('sidebar-action-new-thread')" },
  { id: 'scope row', p: "q('.scope')", a: "tid('sessions-scope-strip')", only: 'inner', abs: true },
  { id: 'add project', p: "q('[data-id=addproj]')", a: "tid('sessions-scope-add')" },
  { id: 'group Today', p: "qa('.gh')[0]", a: "tid('sessions-group-header-Today') ?? txt('[data-testid^=sessions-group-header]', 'Today') ?? txt('[data-slot=sidebar-group-label]', 'Today')", abs: true, noBox: true },
  { id: 'group Yesterday', p: "qa('.gh')[1]", a: "tid('sessions-group-header-Yesterday')", abs: true, noBox: true },
  { id: 'group No project', p: "qa('.gh')[2]", a: "tid('sessions-group-header-No project')", abs: true, noBox: true },
  ...['selected, running', 'running', 'needs you', 'plan waiting', 'idle', 'temporary', 'other project, running', 'yesterday', 'yesterday 2', 'yesterday 3', 'no project'].map((name, i) => ({
    id: `row ${i + 1}: ${name}`,
    p: `qa('.sr0')[${i}]`,
    a: `qa('[data-testid=sessions-row]')[${i}].querySelector('button')`,
  })),
];
const header = [
  { id: 'session header', p: "q('#head')", a: "tid('chat-header')" },
  { id: 'side chat toggle', p: "q('#head [data-id=side], #head #sidechat') ?? qa('#head button')[0]", a: "q('[data-testid^=side-chat-toggle]')" },
  { id: 'panel toggle', p: "q('#ptoggle')", a: "tid('session-panel-toggle')" },
];

export default {
  id: 'shell',
  states: [
    {
      id: 'window',
      compareWindowText: true,
      title: 'Window, nothing hovered',
      ...base,
      scenario: {
        windowTranscript: prototypeWindow.turns,
        projectColors: prototypeWindow.projectColors,
        panelTaskTitles: true,
        earlierRows: 24,
      },
      proto: async (page) => {
        await base.proto(page);
        await page.addStyleTag({ content: '.lights i { visibility: hidden; }' });
      },
      app: async (page) => {
        await base.app(page);
        await page.evaluate(() => {
          for (const toggle of document.querySelectorAll('[data-testid^=chat-work-toggle-][aria-expanded=true]')) {
            toggle.click();
          }
          document.activeElement?.blur?.();
        });
      },
      pairs: [
        ...titleBar,
        ...railPairs,
        ...sidebar,
        ...header,
        { id: 'compaction divider', p: "txt('#thread .div', 'Context compacted')", a: "tid('chat-compaction-pill')", transcript: true },
        { id: 'provider divider', p: "txt('#thread .div', 'Switched to')", a: "q('[data-testid^=chat-provider-switch-marker-]')", transcript: true },
        { id: 'work after compaction', p: "txt('#thread .wk', 'Worked for 41s')", a: "txt('[data-testid^=chat-work-header-]', 'Worked for 41s')", transcript: true },
        { id: 'reply before switch', p: "txt('#thread .ans', 'The docs confirm it')", a: "txt('[data-testid=chat-answer]', 'The docs confirm it')", transcript: true },
        { id: 'bottom strip', p: "q('.bstrip')", a: "tid('composer-bottom-strip')" },
        { id: 'transcript viewport', p: "q('#thread')", a: "tid('chat-thread-viewport')", only: 'box' },
        {
          id: 'last user message',
          transcript: true,
          p: "qa('#thread .bubble').at(-1)",
          a: "qa('[data-testid=chat-user-bubble]').at(-1)",
        },
        { id: 'last work header', p: "txt('#thread .wk', 'Worked for 1m 14s')", a: "txt('[data-testid^=chat-work-header-]', 'Worked for 1m 14s')", transcript: true, only: 'box' },
        {
          id: 'last assistant answer',
          transcript: true,
          p: "qa('#thread .ans').at(-1)",
          a: "qa('[data-testid=chat-answer]').at(-1)",
        },
        { id: 'panel card', p: "q('#spanel')", a: "tid('session-panel')", only: 'box', optional: true },
      ],
      shot: true,
    },
    { id: 'sidebar', title: 'Sidebar', ...base, views: ['wide'], pairs: [], shot: { p: "q('#side')", a: "q('[data-slot=sidebar]')" } },
  ],
};
void P;
void PREFS;
void TABS;
void closeWorkspace;
