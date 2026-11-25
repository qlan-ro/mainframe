import { P, base, closeWorkspace } from './common.mjs';

const app = (...f) => P.all(closeWorkspace, ...f);
const blur = P.js('document.activeElement?.blur?.()');
const gate = { id: 'gate', p: "q('#gate .gc')", a: "tid('chat-gate-card')" };
const shot = { p: "q('#composer')", a: "tid('chat-composer-frame').parentElement" };
const S = (id, title, o) => ({ id, title, ...base, views: ['wide', 'small'], shot, ...o });
const keep = P.js("[...document.querySelectorAll('.gb')].find((b) => b.textContent.includes('Keep'))?.click()");

export default {
  id: 'gates',
  states: [
    S('permission', 'Permission gate', { scenario: { gate: 'permission', act: 'none' }, proto: P.preset('gate-permission'), app: app(blur), pairs: [gate] }),
    S('permission-details', 'Permission gate, details open', {
      scenario: { gate: 'permission', act: 'none' },
      views: ['wide'],
      proto: P.all(P.preset('gate-permission'), P.click("q('[data-g=det]')"), P.park, blur),
      app: app(P.click("tid('chat-permission-details-toggle')"), P.park, blur),
      pairs: [gate],
    }),
    S('permission-hover', 'Allow once hovered', {
      scenario: { gate: 'permission', act: 'none' },
      views: ['wide'],
      proto: P.all(P.preset('gate-permission'), P.hover("q('.gb.pri')")),
      app: app(P.hover("tid('chat-permission-option-allow_once')")),
      pairs: [{ id: 'primary, hovered', p: "q('.gb.pri')", a: "tid('chat-permission-option-allow_once')" }],
    }),
    S('reject-hover', 'Reject hovered', {
      scenario: { gate: 'permission', act: 'none' },
      views: ['wide'],
      proto: P.all(P.preset('gate-permission'), P.hover("q('.gb.dan')")),
      app: app(P.hover("tid('chat-permission-option-reject_once')")),
      pairs: [{ id: 'danger, hovered', p: "q('.gb.dan')", a: "tid('chat-permission-option-reject_once')" }],
    }),
    S('subagent', 'A sub-agent’s request', { scenario: { act: 'need' }, proto: P.preset('needs-you'), app: app(blur), pairs: [gate] }),
    S('plan', 'Plan gate', { scenario: { gate: 'plan', act: 'none' }, proto: P.preset('planning'), app: app(blur), pairs: [gate] }),
    S('plan-keep', 'Plan gate, keep planning', {
      scenario: { gate: 'plan', act: 'none' },
      views: ['wide'],
      proto: P.all(P.preset('planning'), keep, blur),
      app: app(P.click("tid('chat-plan-keep-planning')"), blur, P.park),
      pairs: [gate],
    }),
    S('question', 'Question gate', { scenario: { gate: 'question', act: 'run', running: true }, proto: P.all(P.preset('gate-question')), app: app(blur), pairs: [gate] }),
    S('question-selected', 'Question gate, an option selected', {
      scenario: { gate: 'question', act: 'run', running: true },
      views: ['wide'],
      proto: P.all(P.preset('gate-question'), P.click("qa('.gopt')[0]"), P.park, blur),
      app: app(P.click("qa('[data-testid^=chat-question-option]')[0] ?? qa('[data-testid=chat-question-gate] [role=radio]')[0]"), P.park, blur),
      pairs: [gate],
    }),
    S('question-hover', 'Question gate, an option hovered', {
      scenario: { gate: 'question', act: 'run', running: true },
      views: ['wide'],
      proto: P.all(P.preset('gate-question'), P.hover("txt('.gopt', 'Add the switcher first')")),
      app: app(P.hover("tid('chat-question-option-0-Add the switcher first')")),
      pairs: [gate],
    }),
  ],
};
