import { P, base, closeWorkspace } from './common.mjs';

const start = P.all(closeWorkspace, P.click("tid('sidebar-action-new-thread')"), P.wait(700));
const blur = P.js('document.activeElement?.blur?.()');
const strip = { id: 'draft strip', p: "q('#top')", a: "tid('composer-draft-strip')" };
const card = { id: 'card', p: "q('#card')", a: "tid('chat-composer')" };
const empty = { id: 'empty state', p: "q('.nse')", a: "tid('sessions-welcome').firstElementChild" };
const shot = { p: "q('.nse')", a: "tid('sessions-welcome').firstElementChild" };
const composer = { p: "q('#composer')", a: "tid('chat-composer-frame').parentElement" };
const S = (id, title, o) => ({ id, title, ...base, scenario: { act: 'none' }, views: ['wide'], shot, proto: P.all(P.preset('new-session'), blur), app: P.all(start, blur, P.park), ...o });
const branch = P.openByKey("q('[data-id=pill]')");
const appBranch = P.openByKey("tid('composer-branch-picker')");
const menu = { id: 'menu', p: "q('.menu')", a: "q('[role=menu]')" };

export default {
  id: 'new-session',
  states: [
    S('empty', 'New session', { views: undefined, pairs: [empty, strip, card] }),
    S('empty-window', 'New session, whole window', { pairs: [], shot: true }),
    S('row-hover', 'A session row hovered', {
      proto: P.all(P.preset('new-session'), blur, P.hover("qa('.nsr')[1]")),
      app: P.all(start, blur, P.hover("tid('sessions-welcome-session-s2')")),
      pairs: [{ id: 'row, hovered', p: "qa('.nsr')[1]", a: "tid('sessions-welcome-session-s2')" }],
    }),
    S('project-menu', 'Project menu', {
      proto: P.all(P.preset('new-session'), P.openByKey("q('[data-id=proj]')")),
      app: P.all(start, P.openByKey("tid('welcome-project')")),
      pairs: [menu],
      shot: { p: "q('.menu')", a: "q('[role=menu]')" },
    }),
    S('branch-menu', 'Branch menu', {
      proto: P.all(P.preset('new-session'), branch),
      app: P.all(start, appBranch),
      pairs: [{ ...menu, a: "tid('composer-branch-menu')" }],
      shot: { p: "q('.menu')", a: "tid('composer-branch-menu')" },
    }),
    S('worktree', 'New worktree chosen', {
      proto: P.preset('worktree-chosen'),
      app: P.all(start, appBranch, P.click("tid('composer-branch-new-worktree')"), P.key('Escape'), blur, P.park),
      pairs: [strip, empty],
    }),
    S('temporary', 'Temporary chosen', {
      proto: P.preset('temporary-chosen'),
      app: P.all(start, appBranch, P.click("tid('composer-branch-menu').querySelector('[data-testid=composer-temporary-toggle]')"), P.key('Escape'), blur, P.park),
      pairs: [strip, empty],
    }),
    S('no-project', 'No project', {
      proto: P.all(P.preset('new-session'), P.click("q('[data-id=proj]')"), P.click("txt('.menu .mi', 'No project')"), P.park),
      app: P.all(start, P.click("tid('welcome-project')"), P.click("tid('welcome-project-picker-no-project')"), blur, P.park),
      pairs: [strip, empty],
      shot: composer,
    }),
  ],
};
