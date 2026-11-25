import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { areaForBoard, areaForPath, checkCanvas, checkLocalPaths, loadAreas, localPaths, REPO, uncoveredAreas } from './check.mjs';

const cfg = loadAreas();

test('the most specific code path wins', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/Composer.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/gates/PermissionGate.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/thread/ChatThread.tsx').id, 'transcript');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/WorkspaceTabStrip.tsx').id, 'workspace');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/TitleBar.tsx').id, 'shell');
});

test('shared primitives, styles and shared pieces are Foundations, and DESIGN.md is its design file', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/components/ui/button.tsx').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/components/ui/sidebar/menu.tsx').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/styles/globals.css').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/shared/ErrorState.tsx').id, 'foundations');
  assert.equal(areaForBoard(cfg, 'Foundations-Tokens').id, 'foundations');
  const code = 'packages/ui/src/styles/globals.css';
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['foundations']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'DESIGN.md']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Foundations-Tokens.dc.html']), []);
});

test('only visual files count: logic, docs and tests belong to no area', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/controller/chat-actions.ts'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/README.md'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/app/main.tsx').id, 'shell');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/daemon/AddRemoteDialog.tsx').id, 'settings');
});

test('tests and unmapped code belong to no area', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/__tests__/Composer.test.tsx'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/segments/segment-model.test.ts'), null);
  assert.equal(areaForPath(cfg, 'packages/core-rs/crates/mainframe-quota/src/codex.rs'), null);
});

test('the most specific board prefix wins', () => {
  assert.equal(areaForBoard(cfg, 'Workspace-SessionPanel').id, 'session-panel');
  assert.equal(areaForBoard(cfg, 'Workspace-Files').id, 'workspace');
  assert.equal(areaForBoard(cfg, 'Shell-SidebarRows').id, 'sidebar');
  assert.equal(areaForBoard(cfg, 'Shell-TitleBar').id, 'shell');
  assert.equal(areaForBoard(cfg, 'Proposal-Redesign-Composer').id, 'proposals');
});

test('a UI change needs its own area board or brief, not a proposal', () => {
  const code = 'packages/ui/src/features/chat/composer/Composer.tsx';
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['composer']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Chat-ComposerMenus.dc.html']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'packages/ui/.impeccable/surfaces/src-features-chat-composer.md']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Proposal-Redesign-Composer.dc.html']).map((m) => m.area.id), ['composer']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Chat-Thread.dc.html']).map((m) => m.area.id), ['composer']);
});

test('moving or deleting still counts as a code change, but deleting a board is not a design update', () => {
  const code = { status: 'D', path: 'packages/ui/src/features/sessions/SessionRow.tsx' };
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['sidebar']);
  assert.deepEqual(uncoveredAreas(cfg, [code, { status: 'D', path: 'design/canvas/project/Shell-SidebarRows.dc.html' }]).map((m) => m.area.id), ['sidebar']);
  assert.deepEqual(uncoveredAreas(cfg, [code, { status: 'A', path: 'design/canvas/project/Shell-SidebarRows.dc.html' }]), []);
});

test('the committed canvas passes', () => {
  assert.deepEqual(checkCanvas(cfg), []);
});

test('the briefs and the two guides are held to it too', () => {
  for (const planted of ['packages/ui/.impeccable/surfaces/x.md', 'DESIGN.md', 'design/README.md', 'design/canvas/project/x.dc.html', 'design/redesign/DECISIONS.md']) {
    const repo = mkdtempSync(join(tmpdir(), 'design-check-'));
    try {
      for (const dir of ['design/canvas/project', 'design/redesign', 'packages/ui/.impeccable/surfaces']) mkdirSync(join(repo, dir), { recursive: true });
      for (const file of ['DESIGN.md', 'design/README.md']) writeFileSync(join(repo, file), 'fine');
      assert.deepEqual(checkLocalPaths(repo), []);
      writeFileSync(join(repo, planted), 'see /Users/jane/Code');
      assert.deepEqual(checkLocalPaths(repo), [`${planted} holds local paths: /Users/jane/Code`]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('the published design files name no local path', () => {
  assert.deepEqual(checkLocalPaths(), []);
});

const python = (code, input, args = []) =>
  execFileSync('python3', ['-c', code, ...args], {
    cwd: join(REPO, 'design/canvas/lib'),
    input,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
const leaks = (text, names = [], hosts = []) =>
  JSON.parse(
    python(
      'import json,sys; from boards import leaks; print(json.dumps(leaks(sys.stdin.read(), *(set(json.loads(a)) for a in sys.argv[1:]))))',
      text,
      [JSON.stringify(names), JSON.stringify(hosts)],
    ),
  );

const PATHS = [
  ['<p title="/Users/jane/Code">x</p>', '/Users/jane/Code'],
  ['<p>/private/tmp/x/y</p>', '/private/tmp/x/y'],
  ['<p>/private/var/folders/x</p>', '/private/var/folders/x'],
  ['<p>/var/folders/y6/abc/T</p>', '/var/folders/y6/abc/T'],
  ['<p>/home/runner/work</p>', '/home/runner/work'],
  ['<p>file:///home/jane/x</p>', '/home/jane/x'],
  ['<p>/tmp/claude-501/x</p>', '/tmp/claude-501/x'],
  ['<p>/tmp/run-Users-jane-Code/x</p>', '/tmp/run-Users-jane-Code/x'],
  ['<p>projects/-Users-jane-Code/x</p>', '-Users-jane-Code/x'],
  ['<a href="x?p=%2FUsers%2Fjane%2FCode">x</a>', '/Users/jane/Code'],
  ['<a href="x?p=%252Fvar%252Ffolders%252Fy6">x</a>', '/var/folders/y6'],
  ['{"p":"\\/Users\\/jane"}', '/Users/jane'],
  ['{"p":"\\u002fUsers\\u002fjane"}', '/Users/jane'],
  ['<p>&#x2F;Users&#47;jane</p>', '/Users/jane'],
  ['<p>C:\\Users\\jane</p>', 'C:\\Users\\jane'],
  // Encoded by a tool that turns every slash into a dash, after a dash or a prefix.
  ['<p>a--Users-jane-Code</p>', '--Users-jane-Code'],
  ['<p>row-Users-jane-Projects</p>', '-Users-jane-Projects'],
  ['<p>x-Users-jane</p>', '-Users-jane'],
  ['<p>Row-Users-jane-Code</p>', '-Users-jane-Code'],
  ['<p>Row-Users-jane</p>', '-Users-jane'],
  ['<p>-Users-page-Code</p>', '-Users-page-Code'],
  ['<p>-home-page-code</p>', '-home-page-code'],
  ['<p>-home-button</p>', '-home-button'],
  ['<p>-home-page/x</p>', '-home-page/x'],
  ['<p>projects/-home-page-card</p>', '-home-page-card'],
  ['<p>-home-page-card-Code</p>', '-home-page-card-Code'],
  ['<p>x--home-jane-code</p>', '--home-jane-code'],
  ['<p>--private-tmp-claude</p>', '-private-tmp-claude'],
  ['<p>t-private-tmp-claude</p>', '-private-tmp-claude'],
  ['<p>x-var-folders-y6-abc</p>', '-var-folders-y6-abc'],
  // Escaped letters, and entities without their semicolon.
  ['<p>&#47Users&#47jane</p>', '/Users/jane'],
  ['<p>&#x2fUsers&#x2fjane</p>', '/Users/jane'],
  ['<a href="x?p=/%55sers/jane">x</a>', '/Users/jane'],
  ['<a href="x?p=%252F%2555sers%252Fjane">x</a>', '/Users/jane'],
  ['{"p":"/\\u0055sers/jane"}', '/Users/jane'],
  ['<p>/&#85;sers/jane</p>', '/Users/jane'],
  ['<p>\\057Users\\057jane</p>', '/Users/jane'],
  ['{"p":"\\u{2f}Users\\u{002F}jane"}', '/Users/jane'],
  // Below another root, or on another host.
  ['<p>/Volumes/Backup/Users/jane</p>', '/Users/jane'],
  ['<p>file://janes-mac/Users/jane</p>', '/Users/jane'],
  ['<p>backup/Users/jane/Documents</p>', '/Users/jane/Documents'],
  // Right after something that looks like the end of a word.
  ['{"text":"done\\n/Users/jane/work"}', '/Users/jane/work'],
  ['{"text":"a\\t/Users/jane"}', '/Users/jane'],
  ['<a href="x?p=a%0A/Users/jane">x</a>', '/Users/jane'],
  ['<p>cc -I/Users/jane/include</p>', '/Users/jane/include'],
  ['<p>\u001b[0m/Users/jane</p>', '/Users/jane'],
  ['<p>[0m/Users/jane</p>', '/Users/jane'],
  ['<p>src/Users/jane</p>', '/Users/jane'],
  ['<p>src/Users/jane/Documents</p>', '/Users/jane/Documents'],
  ['<p>src/Users/list/jane</p>', '/Users/list/jane'],
  ['<p>src/Users/list.tsx/jane</p>', '/Users/list.tsx/jane'],
  ['<p>src/Users/list.ts</p>', '/Users/list.ts'],
  ['<p>src/Users/jane.ts</p>', '/Users/jane.ts'],
  ['<p>src/Users/page</p>', '/Users/page'],
  ['<p>src/Users/list@jane</p>', '/Users/list@jane'],
  ['<p>src/Users/list\\jane</p>', '/Users/list\\jane'],
  ['<p>C:\\src/Users/list</p>', '/Users/list'],
  ['<p>src/jane/Users/list</p>', '/Users/list'],
  // A real path that ends in a folder called Users.
  ['<p>src/Users/jane/components/Users/List.tsx</p>', '/Users/jane/components/Users/List.tsx'],
  ['<p>src/private/tmp/Users/list</p>', '/private/tmp/Users/list'],
  ['<p>src/Users/jane/work/Users/Form</p>', '/Users/jane/work/Users/Form'],
  ['<p>src/components/Users/jane/Users/list</p>', '/Users/jane/Users/list'],
  ['<p>src/home/jane/Users/list</p>', '/Users/list'],
  ['<p>src/var/folders/y6/Users/list</p>', '/var/folders/y6/Users/list'],
  ['<p>/src/Users/list</p>', '/Users/list'],
  ['{"text":"done\\n/home/jane/work"}', '/home/jane/work'],
  ['<a href="x?p=a%0A/home/jane">x</a>', '/home/jane'],
  ['<a href="x?p=a%250a%252Fhome%252Fjane">x</a>', '/home/jane'],
  ['<p>cc -I/home/jane/include</p>', '/home/jane/include'],
  ['<p>\u001b[0m/home/jane</p>', '/home/jane'],
  // Found before anything but the slash is decoded.
  ['<p>&#65;/home/jane</p>', '/home/jane'],
  // Without the leading slash, or the drive.
  ['<p>Users/jane/Code</p>', 'Users/jane/Code'],
  ['<p>home/jane/Code</p>', 'home/jane/Code'],
  ['<p>private/tmp/x</p>', 'private/tmp/x'],
  ['<p>var/folders/y6/abc</p>', 'var/folders/y6/abc'],
  ['<p>\\Users\\jane</p>', '\\Users\\jane'],
  ['{"p":"\\\\Users\\\\jane"}', '\\Users\\\\jane'],
  // base64: padded, unpadded and URL-safe.
  [`<a href="data:text/plain;base64,${btoa('see /Users/jane/Code')}">x</a>`, '/Users/jane/Code'],
  ['<p>L1VzZXJzL2phbmU</p>', '/Users/jane'],
  [`<p>${Buffer.from('/Users/jane/??>>').toString('base64url')}</p>`, '/Users/jane/??'],
  [`<p>${btoa('%2FUsers%2Fjane')}</p>`, '/Users/jane'],
  [`<p>${btoa('a log that goes on for a good while, then /Users/jane').replace(/.{20}/g, '$&\n')}</p>`, '/Users/jane'],
  [`{"p":"${btoa('a log that goes on for a good while, then /Users/jane').replace(/.{20}/g, '$&\\r\\n')}"}`, '/Users/jane'],
  [`<p>${Buffer.from('/Users/jane', 'utf16le').toString('base64')}</p>`, '/Users/jane'],
  [`<p>${Buffer.from('/Users/jane', 'utf16le').swap16().toString('base64')}</p>`, '/Users/jane'],
];
const NEUTRAL = [
  '<p>~/Code/atlas-web</p>',
  '<p>/tmp/release-notes.md</p>',
  '<a href="https://example.com/home/jane">x</a>',
  '<p>src/private/key.ts, /users/1, packages/home/Home.tsx</p>',
  '<svg class="icon-home-x -home"></svg>',
  '<svg class="nav-home-icon-large -home-page-card"></svg>',
  '<p>Max-Users-per-team, max-Users-per-team, src/Users/list, src/Users/list.tsx.</p>',
  '<p>src/Users/list, src/components/Users/List.tsx, all-Users-are-here, active-Users-today</p>',
  '<p>packages/home/index.ts, home/index.ts, home/components/Card.tsx, home/settings/panel.tsx, home/settings/general/panel.tsx, home/rooms/list.tsx</p>',
  '<p style="width:var(--home-width-sm)">--home-width-sm: 1px</p>',
  '<p style="--my-private-var-name:1">Users/List.tsx, 100%25 wide, &#477; and &#x2fa;</p>',
];

test('a local path is found in any spelling, by the CI check and by the board writers alike', () => {
  for (const [text, path] of PATHS) {
    assert.deepEqual(localPaths(text), [path], text);
    assert.deepEqual(leaks(text), [path], text);
  }
  for (const text of NEUTRAL) {
    assert.deepEqual(localPaths(text), [], text);
    assert.deepEqual(leaks(text), [], text);
  }
});

test('the user and host names are looked for in the markup only', () => {
  assert.deepEqual(leaks('<b>janemac.local</b> and janet', ['jane', 'JaneMac']), ['janemac']);
  assert.deepEqual(leaks('<b>janemac</b> and janet', ['jane'], ['JaneMac']), ['janemac']);
  assert.deepEqual(leaks('<p aria-label="janedoes’s chat">x</p>', ['janedoes']), ['janedoes']);
  const css = '<style>.max-width{max-width:1px}</style><script>max-width</script>';
  assert.deepEqual(leaks(`${css}<p class="max-width" style="max-width:1px">hello</p>`, ['max-width'], ['max']), []);
  assert.deepEqual(leaks(`${css}<p>max-width</p>`, ['max-width']), ['max-width']);
  assert.deepEqual(leaks(`${css}<p>max</p>`, [], ['max']), ['max']);
});

test('a user name that may be a word counts only where it names a user', () => {
  const names = ['max', 'main', 'alex', 'root', 'runner', 'localhost'];
  const prose =
    'max effort, on main, with Alex, alex@acme.dev, origin/main, plugin-alex@store, the user max limit, Alex’s chat, ' +
    'icon max@3x, npm i max@latest, npm i max@^2, max@v2, main@origin, user=main, on main: ~3 files, main:/docs, ' +
    'Max desktop width, main computer';
  assert.deepEqual(leaks(`<p aria-label="${prose}">${prose}</p>`, names), []);
  for (const [text, name] of [
    ['cd ~alex', 'alex'],
    ['alex@studio ~ %', 'alex'],
    ['alex@studio.local', 'alex'],
    ['main@studio:~/code$ ls', 'main'],
    ['max@studio', 'max'],
    ['Alex’s MacBook Pro', 'Alex'],
    ['Alex’s MBP', 'Alex'],
    ["Max's iPhone", 'Max'],
    ['Alex MacBook Pro', 'Alex'],
    ['alexs-mac', 'alex'],
    ['alex.local', 'alex'],
    ['user=alex', 'alex'],
    ['user=max', 'max'],
    ['USER=alex', 'alex'],
    ['user: Alex', 'Alex'],
    ['"user":"alex"', 'alex'],
    ['"username": "main"', 'main'],
    ['\\"user\\":\\"alex\\"', 'alex'],
    ['Logged in as alex', 'alex'],
    ['drwxr-xr-x 3 alex staff 96 Nov 25 10:00 src', 'alex'],
    ['drwxr-xr-x@  3 main  wheel', 'main'],
    ['-rw-r--r--. 1 root max 12', 'max'],
    ['alex:~$', 'alex'],
    ['alex:~/code$ ls', 'alex'],
    ['main:~$', 'main'],
    ['scp x alex:~', 'alex'],
    ['sudo -u alex ls', 'alex'],
  ]) {
    assert.deepEqual(leaks(`<p>${text}</p>`, names), [name], text);
    assert.deepEqual(leaks(`<p>${text}</p>`, ['zoe', 'nina']), [], text);
  }
  assert.deepEqual(leaks('<p title="{&quot;user&quot;:&quot;alex&quot;}">x</p>', names), ['alex']);
  assert.deepEqual(leaks('<p>/Users/alex/Code</p>', ['alex']), ['/Users/alex/Code']);
});

/** The only texts of the first version's that are let through: a component's file, named in full. */
const LET_THROUGH = /^["( ]?src\/(?:components\/)?Users\/[Ll]ist(?:\.tsx)?(?: x|["), ]|\.)?$/;

/** What main's check found before this file learned more shapes, in every context it can stand in. */
test('nothing the first version of the check found is let through, but src/Users/list', () => {
  const slash = /(?:%(?:25)*2[fF]|\\u002[fF]|\\x2[fF]|\\\/|&#[xX]0*2[fF];|&#0*47;|&sol;)/g;
  const first =
    /(?:\/Users\/|\/private\/(?:tmp|var|etc)\b|(?<![\w.-])\/(?:private|home)\/|\/var\/folders\/|\b[A-Za-z]:[\\/]+Users[\\/]|\/tmp\/claude-\d|\/tmp\/[^\s"'<>&;)]*-(?:Users|home)-|(?<![\w-])-(?:Users|home|private-tmp|private-var|var-folders)-(?=\w))[^\s"'<>&;)]*/;
  const befores = ['', ' ', 'x', '.', '-', '_', '/', '~', '"', '\\n', '\\t', '%0A', '%41', '&#65;', '-I', '\u001b[0m', '\\033[0m', 'src', 'src/', 'a/src', 'file://host', '/Volumes/B', 'é', '(', '=', ':', '\\', '\\x41', '\\u0041', '&#x2e'];
  const names = ['jane', 'list', 'per', 'page', 'are', 'today', 'x', 'settings', 'width', 'list.tsx', 'jane.ts'];
  const paths = names.flatMap((name) =>
    [`/Users/${name}`, `/home/${name}/`, `/home/${name}`, `/private/tmp/${name}`, `/private/${name}/`, `/var/folders/${name}`, `C:\\Users\\${name}`, `/tmp/a-Users-${name}`,
      `-Users-${name}`, `-home-${name}`, `-private-tmp-${name}`, `-private-var-${name}`, `-var-folders-${name}`, `%2FUsers%2F${name}`, `%252Fhome%252F${name}`, `&#x2F;Users&#47;${name}`, `\\/Users\\/${name}`],
  );
  const texts = befores.flatMap((before) => paths.flatMap((path) => ['', '/Code', '-Code', ' x', '.', '"'].map((after) => before + path + after)));

  // Every path of up to four segments below what the exemption starts with, roots repeated and nested.
  const segments = ['Users', 'home', 'private', 'var', 'tmp', 'folders', 'components', 'jane', 'List.tsx', 'list', 'Form', 'jane.ts'];
  let nested = [''];
  for (let depth = 0; depth < 4; depth++) {
    nested = nested.flatMap((path) => segments.map((segment) => `${path}/${segment}`));
    for (const path of nested) {
      texts.push(`src${path}`, `src/components${path}`);
      if (depth === 3) continue;
      texts.push(path, `"src${path}"`, `src${path} x`, `src${path}/work/Users/list`, `src/Users/jane${path}`, `a/src${path}`, `src${path.replaceAll('/', '%2F')}`);
    }
  }

  const found = texts.filter((text) => first.test(text.replace(slash, '/')));
  assert.ok(found.length > 30_000, String(found.length));
  const wanted = found.filter((text) => LET_THROUGH.test(text.replace(slash, '/')));
  assert.ok(wanted.length > 10, String(wanted.length));
  assert.deepEqual(found.filter((text) => localPaths(text).length === 0), wanted);
  // By the board writers as well, in one call for all of them. Python counts é as a letter, as it did on main.
  const through = 'import json,sys; from boards import local_paths; print(json.dumps([t for t in json.load(sys.stdin) if not local_paths(t)]))';
  assert.deepEqual(JSON.parse(python(through, JSON.stringify(found.filter((text) => !text.includes('é'))))), wanted);
});

test('tool cards and markers are numbered within their own state', () => {
  const { numberIds } = createRequire(import.meta.url)('../canvas/proposals/number-ids.cjs');
  const card = (from) =>
    `<button aria-controls="tc${from}"></button><div id="tc${from}"></div><button aria-controls="mk${from + 1}"></button>` +
    `<div id="mk${from + 1}"></div><div id="wsep1" data-id="mm-k3"></div>`;
  assert.equal(
    numberIds(card(57), 'tools'),
    '<button aria-controls="tools-tc1"></button><div id="tools-tc1"></div><button aria-controls="tools-mk2"></button>' +
      '<div id="tools-mk2"></div><div id="wsep1" data-id="mm-k3"></div>',
  );
  assert.equal(numberIds(card(900), 'tools'), numberIds(card(57), 'tools'));
});

test('no committed proposal board holds an id that depends on the states captured before it', () => {
  const dir = join(REPO, 'design/canvas/project');
  for (const board of readdirSync(dir).filter((name) => name.startsWith('Proposal-Redesign-'))) {
    assert.deepEqual(readFileSync(join(dir, board), 'utf8').match(/"(?:tc|mk)\d+"/g) ?? [], [], board);
  }
});

test('no builder writes a board that holds a local path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-check-'));
  try {
    for (const part of ['design/canvas/lib', 'design/canvas/proposals', 'design/redesign']) {
      cpSync(join(REPO, part), join(dir, part), { recursive: true, filter: (from) => !/\/(?:render|__pycache__)$/.test(from) });
    }
    const project = join(dir, 'design/canvas/project');
    const proposals = join(dir, 'design/canvas/proposals');
    mkdirSync(project);
    const build = () => execFileSync('python3', [join(proposals, 'build.py')], { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const run = (html) => {
      writeFileSync(join(proposals, 'states.py'), "BOARDS = [{'file': 'Proposal-Test', 'title': 'Test', 'cols': 1, 'states': [{'id': 'test', 'crop': None, 'cap': 'Test', 'theme': 'light'}]}]\n");
      const frame = { html, w: 100, h: 100 };
      writeFileSync(join(proposals, 'frags.json'), JSON.stringify({ test: frame, __sprite: frame }));
      build();
    };
    assert.throws(() => run('<p title="/Users/jane/Code">x</p>'), /the board names this machine, not written: \/Users\/jane\/Code/);
    assert.deepEqual(readdirSync(project), []);
    run('<p title="~/Code">x</p>');
    assert.ok(readdirSync(project).includes('Proposal-Test.dc.html'));
    rmSync(join(proposals, 'frags.json'));
    writeFileSync(join(proposals, 'states.py'), 'BOARDS = []\n');
    build();
    assert.ok(readdirSync(project).includes('Proposal-Redesign-Spec.dc.html'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stand-in daemon: answers every request and leaves its environment in its data dir. */
const FAKE_DAEMON = `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.MAINFRAME_DATA_DIR + '/env.json', JSON.stringify(process.env));
require('node:http').createServer((req, res) => res.end('{}')).listen(Number(process.env.DAEMON_PORT), '127.0.0.1');
`;

const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(String(port)));
    });
  });

test('a capture’s daemon gets an empty HOME and none of the machine’s tokens; the e2e suite’s keeps its environment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-check-'));
  const fake = join(dir, 'fake-daemon');
  writeFileSync(fake, FAKE_DAEMON);
  chmodSync(fake, 0o755);
  const secrets = { GH_TOKEN: 'x', ANTHROPIC_API_KEY: 'x', SOME_NEW_SECRET: 'x', CLAUDE_CONFIG_DIR: '/x', CODEX_HOME: '/x', XDG_CONFIG_HOME: '/x' };
  const before = { ...process.env };
  Object.assign(process.env, secrets, { MF_E2E_RUST_DAEMON_PATH: fake, MF_E2E_DAEMON_PORT: await freePort() });
  delete process.env.E2E_MODE;
  try {
    const { startDaemon, stopDaemon } = await import('../../packages/e2e/fixtures/daemon.ts');
    const { isolated } = await import('../canvas/capture/isolation.mts');
    const envOf = async (options) => {
      const handle = await startDaemon(options);
      await stopDaemon(handle, true);
      return JSON.parse(readFileSync(join(handle.testDataDir, 'env.json'), 'utf8'));
    };

    const launch = isolated({ mockFork: true }, 3, dir);
    assert.equal(launch.mockFork, true);
    assert.deepEqual(readdirSync(launch.dataDir), []);
    const captured = await envOf(launch);
    assert.equal(captured.HOME, launch.home);
    assert.deepEqual(readdirSync(launch.home), []);
    assert.equal(captured.PATH, process.env.PATH);
    for (const name of Object.keys(secrets)) assert.equal(captured[name], undefined, name);

    const suiteDir = join(dir, 'suite');
    mkdirSync(suiteDir);
    const suite = await envOf({ dataDir: suiteDir });
    assert.equal(suite.HOME, process.env.HOME);
    assert.equal(suite.GH_TOKEN, 'x');
    assert.ok(existsSync(join(suiteDir, 'daemon.log')));
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Stands in for Playwright, so a capture runs without it: keeps the spec's body, and has no browser to launch. */
const FAKE_PLAYWRIGHT = `
import { registerHooks } from 'node:module';
const source = "export const test = (name, body) => { globalThis.captureBody = body };" +
  "export const chromium = { launch: async () => { throw new Error('no browser') } };" +
  "export const expect = undefined, request = undefined;";
registerHooks({
  resolve(specifier, context, next) {
    if (/@playwright.test(?:.index.mjs)?$/.test(specifier)) return { url: 'fake:playwright', shortCircuit: true };
    return next(specifier.replace(/^(\\..*)\\.js$/, '$1.ts'), context);
  },
  load(url, context, next) {
    return url === 'fake:playwright' ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
`;

test('every capture starts its app on the isolated HOME and data dir', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'design-check-')));
  try {
    for (const part of ['design/canvas/capture', 'packages/e2e/fixtures', 'packages/e2e/helpers']) {
      cpSync(join(REPO, part), join(dir, part), { recursive: true, filter: (from) => !/\/(?:\.work|recordings)$/.test(from) });
    }
    const capture = join(dir, 'design/canvas/capture');
    mkdirSync(join(capture, '.work'));
    writeFileSync(join(capture, 'areas/one-group.mts'), "export default { boards: [], groups: [{ board: 'X', states: [] }] };");
    const fake = join(dir, 'fake-daemon');
    writeFileSync(fake, FAKE_DAEMON.replace('process.env.MAINFRAME_DATA_DIR', '__dirname'));
    chmodSync(fake, 0o755);
    writeFileSync(join(dir, 'fake-playwright.mjs'), FAKE_PLAYWRIGHT);
    const run = join(dir, 'run.mjs');
    writeFileSync(
      run,
      "await import('./design/canvas/capture/capture.spec.mts');" +
        'await globalThis.captureBody().catch((error) => console.log(error.message));',
    );
    const said = execFileSync(process.execPath, ['--import', join(dir, 'fake-playwright.mjs'), run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        E2E_MODE: '',
        SOME_NEW_SECRET: 'x',
        CAPTURE_AREA: 'one-group',
        CAPTURE_BOARDS: '',
        MF_E2E_RUST_DAEMON_PATH: fake,
        MF_E2E_DAEMON_PORT: await freePort(),
      },
    });
    assert.match(said, /no browser/);
    const env = JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8'));
    assert.equal(env.HOME, join(capture, '.work/home'));
    assert.equal(env.MAINFRAME_DATA_DIR, join(capture, '.work/data-0'));
    assert.equal(env.SOME_NEW_SECRET, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
