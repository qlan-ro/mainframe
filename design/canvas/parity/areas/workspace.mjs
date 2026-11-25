import { P, base } from './common.mjs';

const TABS = [
  { id: 'w1', kind: 'preview', title: 'localhost:5173', config: 'dev', port: 5173 },
  { id: 'w2', kind: 'url', title: 'zsh', url: 'http://localhost:1/' },
  { id: 'w3', kind: 'code', title: 'UsageCapsule.tsx', path: 'packages/ui/src/features/usage/UsageCapsule.tsx', mode: 'permanent' },
  { id: 'w4', kind: 'diff', title: 'quota.rs', path: 'crates/quota/src/quota.rs', mode: 'permanent' },
];
/** The prototype's four tabs. Its terminal stands in as a URL tab: a terminal needs a host. */
const tabs = (active) => `(() => { const { layout, bases } = window.__STORES__; const scopeKey = bases.getState().scopeKey;
  const s = layout.getState(); const run = layout.getState().run;
  for (const pane of run?.panes ?? []) for (const t of [...pane.tabs]) s.closeRunTab(pane.id, t.id);
  for (const t of ${JSON.stringify(TABS)}) layout.getState().addRunTab({ ...t, scopeKey });
  const pane = layout.getState().run.panes[0]; layout.getState().activateRunTab(pane.id, '${active}'); })()`;
const blur = P.js('document.activeElement?.blur?.()');
const settle = P.wait(900);
const open = (active) => P.all(P.wait(900), P.js(tabs(active)), settle, blur, P.park);
const files = P.js('window.__STORES__.files.getState().setOpen(true)');
const bar = [
  { id: 'workspace separator', p: "q('#wsep')", a: "tid('title-bar-separator-workspace')" },
  { id: 'closing separator', p: "q('#wsep2')", a: "tid('title-bar-separator-actions')" },
  ...[0, 1, 2, 3].map((i) => ({ id: `workspace tab ${i + 1}`, p: `qa('#wtabs .tab')[${i}]`, a: `tid('workspace-tab-w${i + 1}')` })),
  { id: 'add tab', p: "q('[data-id=wadd]')", a: "q('[data-testid^=workspace-tab-strip-add]')" },
  { id: 'files toggle', p: "q('#wfiles')", a: "tid('workspace-files-open')" },
  { id: 'search', p: "q('#tsearch')", a: "tid('main-toolbar-search')" },
  { id: 'workspace toggle, on', p: "q('#vcode')", a: "tid('surface-rail-workspace')" },
];
const panel = { id: 'workspace panel', p: "q('#wsp')", a: "tid('workspace-surface').closest('[data-testid=workspace-panel]') ?? tid('workspace-surface').parentElement", only: 'box' };
const S = (id, title, o) => ({ id, title, ...base, views: ['wide'], shot: true, scenario: { launch: 'two' }, ...o });
const tab = (w) => P.all(P.preset('workspace-preview'), P.js(`document.querySelector('[data-wtab=${w}]').click()`), P.wait(200), blur);

export default {
  id: 'workspace',
  states: [
    S('preview', 'Workspace, preview', { views: ['wide', 'mid'], proto: P.preset('workspace-preview'), app: open('w1'), pairs: [...bar, panel, { id: 'address bar', p: "q('.addr')", a: "tid('preview-toolbar')" }] }),
    S('code-files', 'Workspace, file and Files', {
      scenario: { launch: 'two-stopped' },
      proto: P.preset('workspace-code-files'),
      app: P.all(open('w3'), files, P.wait(700), P.click("tid('file-tree-row-packages')"), P.wait(300), blur, P.park),
      pairs: [
        ...bar.slice(4),
        { id: 'file header', p: "q('.fileh')", a: "tid('viewer-shell').firstElementChild" },
        { id: 'files panel', p: "q('#wsfiles')", a: "tid('workspace-files-panel').closest('[data-slot=sidebar]')", only: 'box' },
        { id: 'files header', p: "q('#wsfiles .fh')", a: "tid('file-tree').firstElementChild" },
        { id: 'folder row', p: "qa('.fr')[0]", a: "tid('file-tree-row-packages')" },
        { id: 'nested row', p: "qa('.fr')[1]", a: "tid('file-tree-row-packages/core-rs')" },
        { id: 'file row', p: "txt('.fr', 'PRODUCT.md')", a: "tid('file-tree-row-PRODUCT.md')", box: ['x', '', 'width', 'height'] },
      ],
    }),
    S('code', 'Workspace, file', {
      proto: tab('w3'),
      app: open('w3'),
      pairs: [{ id: 'code line', p: "qa('.code .lc')[3]", a: "qa('.cm-line')[3]", noBox: true }, { id: 'comment line', p: "qa('.code .lc')[7]", a: "qa('.cm-line')[7]", noBox: true }, { id: 'line number', p: "qa('.code .ln')[3]", a: "qa('.cm-lineNumbers .cm-gutterElement')[4]", noBox: true }],
    }),
    S('diff', 'Workspace, diff', { proto: P.preset('workspace-diff'), app: open('w4'), pairs: [{ id: 'diff header', p: "q('.fileh')", a: "q('[aria-label=\"Diff navigation\"]')" }, { id: 'added line', p: "q('.code .dl.a')", a: "q('.cm-merge-b .cm-changedLine, .cm-merge-b .cm-insertedLine')", only: 'box', box: [] }, { id: 'removed line', p: "q('.code .dl.d')", a: "q('.cm-merge-a .cm-deletedLine, .cm-merge-a .cm-changedLine')", only: 'box', box: [] }] }),
    S('empty', 'Workspace, nothing open', {
      scenario: { launch: 'one-stopped' },
      proto: P.preset('workspace-empty'),
      app: P.all(P.wait(900), P.click("tid('surface-rail-workspace')"), P.wait(900), blur, P.park),
      pairs: [{ id: 'empty list', p: "q('.wempty .box')", a: "tid('workspace-empty-state')" }],
      shot: { p: "q('.wempty .box')", a: "tid('workspace-empty-state')" },
    }),
    S('add-menu', 'Add to workspace', {
      proto: P.all(P.preset('workspace-preview'), P.openByKey("q('[data-id=wadd]')")),
      app: P.all(open('w1'), P.openByKey("q('[data-testid^=workspace-tab-strip-add]')")),
      pairs: [{ id: 'menu', p: "q('.menu')", a: "q('[role=menu]')" }],
      shot: { p: "q('.menu')", a: "q('[role=menu]')" },
    }),
    S('tab-hover', 'Another tab hovered', {
      proto: P.all(P.preset('workspace-preview'), P.hover("qa('#wtabs .tab')[2]")),
      app: P.all(open('w1'), P.hover("tid('workspace-tab-w3')")),
      pairs: [{ id: 'tab, hovered', p: "qa('#wtabs .tab')[2]", a: "tid('workspace-tab-w3')" }],
      shot: { p: "q('#wtabs')", a: "tid('title-bar-workspace')" },
    }),
    S('panel-floating', 'Workspace and floating panel', {
      proto: P.preset('workspace-panel-floating'),
      app: P.all(open('w1'), P.click("tid('session-panel-toggle')"), blur, P.park),
      pairs: [{ id: 'panel card', p: "q('#spanel')", a: "tid('session-panel-overlay')", only: 'box' }, { id: 'scrim', p: "q('#pscrim')", a: "tid('session-panel-scrim')" }],
    }),
  ],
};
