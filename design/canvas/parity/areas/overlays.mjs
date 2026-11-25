import { P, base, closeWorkspace } from './common.mjs';

const app = (...f) => P.all(closeWorkspace, ...f);
const menu = { id: 'menu', p: "q('.menu')", a: "q('[role=menu]')" };
const menuShot = { p: "q('.menu')", a: "q('[role=menu]')" };
const tip = { id: 'tooltip', p: "q('#tip')", a: "q('[data-slot=tooltip-content]')" };
const tipShot = { p: "q('#tip')", a: "q('[data-slot=tooltip-content]')" };
const S = (id, title, o) => ({ id, title, ...base, views: ['wide'], ...o });
const hoverBoth = (p, a) => ({ proto: P.all(P.preset('idle'), P.hover(p), P.wait(600)), app: app(P.hover(a), P.wait(700)) });
const proto = (...f) => P.all(P.preset('idle'), ...f);
const rowOf = (i) => `qa('[data-testid=sessions-row]')[${i}].querySelector('button')`;
const hovered = (id, p, a) => S(`hover-${id}`, `${id}, hovered`, { ...hoverBoth(p, a), pairs: [{ id: `${id}, hovered`, p, a }] });
const focused = (id, p, a) => S(`focus-${id}`, `${id}, focused`, { proto: proto(P.focus(p)), app: app(P.focus(a)), pairs: [{ id: `${id}, focused`, p, a }] });
const GH = "qa('.gh')[0]";
const AGH = "q('[data-testid=sidebar-scroll] [data-sidebar=group-label]')";

export default {
  id: 'overlays',
  states: [
    hovered('session row', "qa('.sr0')[4]", rowOf(4)),
    hovered('selected row', "qa('.sr0')[0]", rowOf(0)),
    hovered('new session', "q('.newrow')", "tid('sidebar-action-new-thread')"),
    hovered('rail button', "document.querySelectorAll('#rail .rb')[1]", "tid('shell-rail-tasks')"),
    hovered('session tab', "qa('#tabs .tab')[1]", "tid('session-tab-s2')"),
    hovered('usage capsule', "q('#capsule')", "tid('usage-capsule')"),
    hovered('search', "q('#tsearch')", "tid('main-toolbar-search')"),
    hovered('sidebar search', "q('#sbsearch')", "tid('sidebar-search')"),
    hovered('side chat', "q('#sidechat')", "q('[data-testid^=side-chat-toggle]')"),
    hovered('panel sections', "q('[data-id=sections]')", "tid('session-panel-sections-menu')"),
    S('hover-group', 'Group header, hovered', { ...hoverBoth(GH, AGH), pairs: [{ id: 'group header, hovered', p: GH, a: AGH, abs: true, noBox: true }], shot: { p: GH, a: AGH } }),
    focused('session row', "qa('.sr0')[4]", rowOf(4)),
    focused('rail button', "document.querySelectorAll('#rail .rb')[1]", "tid('shell-rail-tasks')"),
    focused('new session', "q('.newrow')", "tid('sidebar-action-new-thread')"),
    focused('panel row', "txt('#spanel button.pr', 'review-workflow.md')", "txt('[data-testid=session-panel] button', 'review-workflow.md')"),
    S('filter-menu', 'Filter menu', { proto: proto(P.openByKey("q('[data-id=gfilter]')")), app: app(P.openByKey("tid('sessions-filter-button')")), pairs: [menu], shot: menuShot }),
    S('sort-menu', 'Sort menu', { proto: proto(P.openByKey("q('[data-id=gsort]')")), app: app(P.openByKey("tid('sessions-sort-button')")), pairs: [menu], shot: menuShot }),
    S('more-menu', 'More menu', { proto: proto(P.openByKey("q('[data-id=gmore]')")), app: app(P.openByKey("tid('sessions-more-button')")), pairs: [{ ...menu, exactText: true }], shot: menuShot }),
    S('filter-on', 'Filter on', {
      proto: proto(P.click(GH), P.js("document.querySelector('[data-id=gfilter]').click()"), P.click("txt('.menu .mi', 'Running')"), P.park, P.js('document.activeElement?.blur?.()')),
      app: app(P.hover(AGH), P.click("tid('sessions-filter-button')"), P.click("tid('sessions-status-filter-running')"), P.key('Escape'), P.park, P.js('document.activeElement?.blur?.()')),
      pairs: [{ id: 'group header, filtered', p: GH, a: AGH, abs: true, noBox: true }],
      shot: { p: GH, a: AGH },
    }),
    S('tooltip', 'Tooltip on Search', { ...hoverBoth("q('#tsearch')", "tid('main-toolbar-search')"), pairs: [tip], shot: tipShot }),
    S('tooltip-ring', 'Tooltip on the context ring', { ...hoverBoth("q('[data-id=ring]')", "tid('composer-context-percent')"), pairs: [tip], shot: tipShot }),
    S('tooltip-rail', 'Tooltip on the rail', { ...hoverBoth("document.querySelectorAll('#rail .rb')[1]", "tid('shell-rail-tasks')"), pairs: [tip], shot: tipShot }),
    S('sheet', 'Keyboard shortcuts', {
      proto: proto(P.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',metaKey:true,bubbles:true}))"), P.preset('shortcuts-sheet')),
      app: app(P.js('window.__STORES__.sheet.setState({ open: true })'), P.wait(300)),
      pairs: [{ id: 'sheet', p: "q('#ksheet')", a: "tid('shortcuts-cheat-sheet')" }, { id: 'scrim', p: "q('#kscrim')", a: "q('[data-slot=dialog-overlay]')" }],
      shot: true,
    }),
    S('toast', 'Toast', {
      proto: proto(P.js("txt('#actstrip .ab', 'Stop').click()"), P.wait(100)),
      app: app(P.js("window.__STORES__.toast.success('Stopped “Map diff scopes in the daemon”')"), P.wait(500)),
      pairs: [{ id: 'toast', p: "q('.toast')", a: "q('[data-sonner-toast]')" }],
      shot: { p: "q('.toast')", a: "q('[data-sonner-toast]')" },
    }),
    S('collapsed', 'Sidebar collapsed', {
      proto: proto(P.click("q('#sbcollapse')"), P.park),
      app: app(P.click("tid('sidebar-collapse')"), P.wait(400), P.park, P.js('document.activeElement?.blur?.()')),
      pairs: [
        { id: 'usage capsule', p: "q('#capsule')", a: "tid('usage-capsule')" },
        { id: 'first separator', p: "q('.tsep')", a: "tid('title-bar-separator-sidebar')" },
        { id: 'selected session tab', p: "q('#tabs .tab[aria-selected=true]')", a: "tid('session-tab-s1')" },
        { id: 'session title', p: "q('#head h1')", a: "tid('chat-header-title')", noBox: true, abs: true },
      ],
      shot: true,
    }),
    S('panel-hidden', 'Session panel closed', {
      proto: P.preset('panel-hidden'),
      app: app(P.click("tid('session-panel-toggle')"), P.park, P.js('document.activeElement?.blur?.()')),
      pairs: [{ id: 'panel toggle, off', p: "q('#ptoggle')", a: "tid('session-panel-toggle')" }, { id: 'composer card', p: "q('#card')", a: "tid('chat-composer')", only: 'box' }],
      shot: true,
    }),
    S('scrollbar', 'Overlay thumb', {
      proto: proto(P.hover("q('#spanel .sec')"), P.wait(500)),
      app: app(P.hover("q('[data-testid=session-panel] section')"), P.wait(500)),
      pairs: [{ id: 'thumb', p: "q('.osb.on')", a: "q('.mf-scrollbar[data-visible] > span') ?? q('.mf-scrollbar > span')" }],
      shot: { p: "q('#spanel')", a: "tid('session-panel')" },
    }),
  ],
};
