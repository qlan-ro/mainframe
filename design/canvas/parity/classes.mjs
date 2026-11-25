// What each remaining difference is. The first rule that matches a row names its
// class; a row no rule matches is OPEN and fails the report.
//
// SPEC   DECISIONS.md or DESIGN.md says otherwise than the prototype: the row is quoted
// DATA   the two sides show other content
// PROTO  the prototype's own stand-in or slip, not a design
// APP    only the running app can tell
//
// A rule matches when every field it names matches the row: a string is equal, a
// regular expression tests. `area`, `state`, `view`, `theme`, `el`, `part`, `prop`,
// `proto` and `app` are the row's fields.
const ANY = /./;
const SHIFT = /^(x|y|y \(middle\)|width|height|right edge|visible width)$/;

export const RULES = [
  { area: 'transcript', state: /^(work collapsed|terminal states)$/, el: 'work header', part: /^icon 1 |^inner box 1 .*4×4/, prop: /missing in app|only in app/, cls: 'SPEC', why: 'T1b: “Claude’s history, interrupted Claude turns and killed sessions end neutral.” The fixture has no recorded outcome, so the app displays its neutral dot.' },
  { area: 'transcript', el: /^(tool row|agent row|.+ command|exploration row|exploration steps|delegated row [1-7])$/, part: /^text/, prop: 'x', cls: 'PROTO', why: 'The prototype gives its clipped screen-reader status span relative positioning in the flex row. Its 1 px width and 8 px gap displace the visible text by 9 px.', delta: 9 },
  { area: 'transcript', el: /^delegated row [1-3]$/, part: /^text “(?:waiting on you|running · 1m 04s|queued)”$/, prop: 'x', cls: 'SPEC', why: 'T1c: “Stop sits at the end of a live row, left of ‘Open in workspace’, in the same 24 px action.” The Stop action moves the receipt 24 px.', delta: 24 },
  { area: 'transcript', el: /^delegated row [1-3]$/, part: /^icon \d .*12×12/, prop: 'only in app', cls: 'SPEC', why: 'T1c: “The prototype draws no Stop in its transcript rows.” The app draws the live task’s Stop square.' },
  { area: 'transcript', part: 'box', prop: 'y', cls: 'DATA', why: 'The fixture uses separate short conversations and the reference is one long conversation. Their preceding rows and scroll offsets differ.' },
  { area: 'transcript', el: 'tool body', part: /^text/, prop: /^(content|missing in app|only in app)$/, cls: 'DATA', why: 'The tool outputs use shorter fixture contents. Code highlighting may also split a string across different token boundaries.' },
  { area: 'transcript', el: 'tool body', state: 'write', part: 'box', prop: 'height', cls: 'DATA', why: 'The fixture contains fewer source lines and does not have the prototype sample’s truncation receipt.' },
  { area: 'transcript', el: 'work header', part: /^text/, prop: /^(content|missing in app|only in app)$/, cls: 'DATA', why: 'The fixture supplies different tool counts, end evidence, and elapsed durations.' },
  { area: 'transcript', state: 'terminal states', el: /^(running|passed|failed|stopped) command$/, part: /^text “(12s|exit|stopped ·)/, prop: /^(content|x|missing in app)$/, cls: 'DATA', why: 'The fixture supplies a status and short output without historical timing or a structured exit receipt.' },
  { area: 'transcript', state: 'terminal states', el: /^(passed|failed) command$/, part: /^icon 2 /, prop: 'only in app', cls: 'DATA', why: 'The fixture has output to disclose. The prototype’s status sample has no body.' },
  { area: 'transcript', state: 'cron-list', el: 'event marker', part: 'box', prop: /^(x|width)$/, cls: 'DATA', why: 'The pill is centred and the fixture’s shorter job count reduces its width.' },
  { area: 'transcript', state: 'cron-list', el: 'event marker', part: /^text “3 jobs”$|^icon 2$/, prop: /^(content|x)$/, cls: 'DATA', why: 'The fixture lists one job and the prototype shows three.' },
  { area: 'transcript', state: 'skill', el: 'event marker', part: /^text “412 lines”$/, prop: 'missing in app', cls: 'DATA', why: 'The synthetic skill result does not carry source-line metadata.' },
  { area: 'transcript', state: 'monitor', el: 'event marker', part: /^text “matched · 42s”$/, prop: 'missing in app', cls: 'DATA', why: 'The fixture provides a short monitor result without a match receipt or elapsed timing.' },
  { area: 'transcript', state: 'enter-worktree', el: 'event marker', part: /^text “feat\/quota-reset”$/, prop: 'content', cls: 'DATA', why: 'The fixture’s input names quota-reset and the prototype prints the full branch.' },

  // ── Shell ──────────────────────────────────────────────────────────────────
  { area: 'shell', el: 'title bar', part: /inner box [123] \(i\)/, cls: 'APP', why: 'The three window buttons are drawn by macOS, not by the page.' },
  { el: /usage capsule|title bar/, part: /\(span\) at \d+,\d+ 3×3/, cls: 'SPEC', why: 'S1: "The shell matches today\'s app." The dots are the account cycle of the app\'s capsule; they sit in its right padding, so nothing else moves.' },
  { area: 'shell', el: 'rail', cls: 'SPEC', why: 'S2: the content is a card on the chrome, its left edge one hairline. The app draws that hairline as the card\'s own border, so the rail is 55 px and the line 1 px, where the prototype\'s rail is 56 px with the line inside.' },
  { area: 'shell', el: 'rail inspector', part: 'icon 1', prop: 'glyph', cls: 'SPEC', why: 'S1: "The shell matches today\'s app." The inspector keeps the app\'s own glyph (0.8 units apart, the same shape).' },
  { area: 'shell', el: 'sidebar', cls: 'SPEC', why: 'S2: the card\'s top hairline is the card\'s border in the app and the sidebar\'s in the prototype. The line paints in the same place, and every row inside has the prototype\'s position.' },
  { area: 'shell', el: 'scope row', part: /inner box/, prop: 'fill', cls: 'DATA', why: 'A project\'s colour is hashed from its id.' },

  // ── Session panel ──────────────────────────────────────────────────────────
  { el: 'Plan', prop: 'numerals', cls: 'SPEC', why: 'DESIGN.md, the Steady Number Rule: numbers that change in place use tabular figures.' },
  { el: 'diff header', prop: /numerals|width/, cls: 'SPEC', why: 'DESIGN.md, the Steady Number Rule: numbers that change in place use tabular figures.' },
  { area: 'panel', el: 'Activity', part: /24|3 failed/, prop: /content|^x$|missing|only/, state: /docked|earlier|needs/, cls: 'DATA', why: '"24+" in the prototype\'s text; the fixture has exactly 24 finished tasks, and "3 failed" stands to their left.' },
  { area: 'panel', state: 'earlier-open', el: 'Activity', cls: 'DATA', why: 'The prototype lists three finished tasks under its "24+"; the app lists the 24 it counts.' },
  { area: 'panel', el: 'Launch', part: /icon/, prop: 'y', cls: 'PROTO', why: 'The prototype sets the play and stop glyphs on the text baseline (an inline svg), 1.7 px above the middle of the row; every other row icon is centred in it.' },
  { area: 'panel', el: 'Mentioned files', cls: 'DATA', why: 'The order and the words of the fixture\'s files; their places, sizes and colours match.' },
  { area: 'panel', el: 'Project tasks', prop: 'content', cls: 'DATA', why: 'The prototype cuts the titles in its data; the app fades them at the row\'s edge.' },
  { area: 'panel', state: 'empty', el: 'Activity', cls: 'PROTO', why: 'The prototype says "No background activity" above two scheduled rows; its own activity list (and the app) says it only with nothing to list. The rows under it stand 28 px higher without it.' },
  { el: 'scrim', prop: 'height', cls: 'SPEC', why: 'R11: "The floating panel ends 8 px above the composer, and so does its scrim."' },
  { area: 'panel', el: 'scrim', prop: 'fill', cls: 'PROTO', why: 'The prototype\'s scrim stands over its own page ground.' },

  { area: 'gates', state: /^(plan|question)$/, view: 'small', el: 'gate', part: 'box', prop: 'y', cls: 'SPEC', why: 'G1: “as ChatGateMount + GateCard do today” and “capped at 45 % of the height and scrolls inside.” The existing slot uses the chat container height. The prototype uses the window height, so its cap starts higher.' },

  // ── Composer ───────────────────────────────────────────────────────────────
  { area: 'composer', el: /^bottom strip$|^worktree, hovered$/, part: /from main|“·”|feat\/quota-reset|“main”|icon 2 at|icon 3 at|^box$/, cls: 'SPEC', why: 'K8: the branch is a control of its own beside the place, with its glyph, so there is no "·" and no "from main" between them.' },
  { area: 'composer', state: /bottom/, el: 'bottom strip', part: /[+−]\d+/, cls: 'DATA', why: 'The fixture\'s change counts.' },
  { area: 'composer', state: 'focus', el: 'card', prop: /^border/, cls: 'SPEC', why: 'C3: the focused card has the 2 px line and "no translucent halo".' },
  { area: 'composer', state: /perm-menu|changes-menu/, part: /inner box/, cls: 'PROTO', why: 'Opened from the keyboard, the prototype focuses the checked item and the app the first one that can be chosen (Radix). The focused row is drawn the same.' },
  { area: 'composer', state: 'model-menu', part: /inner box [56] \(span\)|Claude|“Codex”/, prop: /only in app|^x$/, cls: 'PROTO', why: 'The provider dot is in the prototype\'s list of providers but its tab row does not draw it.' },
  { area: 'composer', state: 'model-menu', cls: 'DATA', why: 'The app lists one model more, "Use CLI setting" with its line of explanation, so the menu is 66.4 px taller and its rows stand that much lower.' },
  { area: 'composer', state: 'confirm-unattended', prop: 'focus outline', cls: 'SPEC', why: 'C13: "Cancel (focused)". The prototype focuses it without drawing the line.' },
  { area: 'composer', state: 'worktree-menu', cls: 'SPEC', why: 'K8: no base branch ("from main") is known to the app, so the menu has no From row, the path is whole, in mono and in ink, and what is under it stands 20 px higher.' },
  { area: 'composer', state: 'files', part: /“log”|“diff”|inner box [26]/, prop: /color|fill/, cls: 'SPEC', why: 'C14: "its extension in a small tinted square (the app\'s per-extension colour)".' },
  { area: 'composer', state: 'captures', part: /“rs”|inner box 6/, prop: /color|fill/, cls: 'SPEC', why: 'C14: "its extension in a small tinted square (the app\'s per-extension colour)".' },
  { area: 'composer', state: /files|captures/, part: /icon \d at .* 32×32/, cls: 'DATA', why: 'The prototype draws its thumbnails as an svg; the fixture\'s are images.' },
  { area: 'composer', state: 'files', prop: 'content', cls: 'DATA', why: 'The fixture image\'s own size.' },
  { area: 'composer', state: 'quotes', prop: 'color', cls: 'SPEC', why: 'DESIGN.md: `faint` is never used for text. The source line is `meta`.' },

  // ── New session ────────────────────────────────────────────────────────────
  { area: 'new-session', el: /empty state|row, hovered/, part: /icon|“2m”/, cls: 'DATA', why: 'Which of the three recent sessions runs is the session list\'s: the same spinner, "needs you" and time stand on other rows. A spinner is `live` (DESIGN.md, Live Blue).' },
  { area: 'new-session', state: 'project-menu', cls: 'DATA', why: 'The fixture has a third project ("docs"), so the menu is one 34 px row taller.' },
  { area: 'new-session', state: 'branch-menu', part: /Search branches/, prop: 'color', cls: 'PROTO', why: 'The prototype\'s placeholder is the browser\'s own grey, #757575; the app\'s is `meta`, as in every other field.' },
  { area: 'new-session', state: 'branch-menu', part: 'inner box 1', cls: 'SPEC', why: 'DESIGN.md, Inputs: "Fields … focus-line-inset". The focus line is on the 30 px search well, not on the row around it.' },
  { area: 'new-session', state: 'branch-menu', part: 'inner box 4 (div) at 4,212.67 292×50.19', cls: 'PROTO', why: 'The field keeps focus in both; the app\'s list also marks the option Enter would choose, the branch that is checked.' },
  { area: 'new-session', part: /icon/, prop: 'glyph', cls: 'SPEC', why: 'K7: the new-worktree glyph is the app\'s folder with a plus (0.85 units apart).' },
  { area: 'new-session', state: 'branch-menu', cls: 'SPEC', why: 'K7: "Manage branches…" ends the menu, 59.2 px that the prototype\'s does not have.' },
  { area: 'new-session', state: 'no-project', el: 'draft strip', cls: 'SPEC', why: 'K7: the Temporary toggle shows with no project too.' },
  { area: 'new-session', state: 'no-project', el: 'empty state', prop: 'content', cls: 'PROTO', why: 'The project control is below the text, not above it.' },

  // ── Gates ──────────────────────────────────────────────────────────────────
  { area: 'gates', state: /^permission/, el: 'gate', cls: 'SPEC', why: 'G2: the gate lists what "Always allow" would save, and the button names the rule, so the card is 45.8 px taller and its buttons stand lower.' },
  { area: 'gates', state: 'reject-hover', prop: 'x', cls: 'SPEC', why: 'G2: the "Always allow" button before it names the rule, 41.3 px longer.' },
  { area: 'gates', state: /plan/, part: /inner box 9 \(button\)/, cls: 'PROTO', why: 'The prototype\'s "Clear context" is the browser\'s own checkbox; the app\'s is its checkbox.' },
  { area: 'gates', state: /plan/, part: /What should be changed/, prop: 'color', cls: 'PROTO', why: 'The prototype\'s placeholder is the browser\'s own grey, #757575; the app\'s is `meta`, as in every other field.' },
  { area: 'gates', state: 'plan-keep', part: 'box', prop: 'y', cls: 'SPEC', why: 'G1: the slot is "capped at 45 % of the height and scrolls inside … as `ChatGateMount` + `GateCard` do today": 45 % of the conversation in the app, of the window in the prototype, so at 900 px the last 34 px of the card scroll.' },

  // ── Workspace ──────────────────────────────────────────────────────────────
  { area: 'workspace', el: 'workspace panel', cls: 'SPEC', why: 'W4 and S2: the panel\'s left and top hairlines are the column\'s in the app; they paint in the same place.' },
  { area: 'workspace', state: /preview|tab-hover|panel-floating/, el: 'workspace tab 1', cls: 'SPEC', why: 'W7: "Not changed by this prototype, keeping today\'s behaviour: … the per-tab Stop for launched processes". A running preview\'s tab has it, 30 px.' },
  { area: 'workspace', state: /preview|tab-hover/, el: /workspace tab [234]|tab, hovered/, part: /box|text|icon [23]|inner box 1/, prop: SHIFT, cls: 'SPEC', why: 'W7: the Stop of the first tab moves and narrows the ones after it.' },
  { area: 'workspace', state: /preview/, el: 'workspace tab 2', part: /icon/, prop: 'glyph', cls: 'DATA', why: 'A terminal needs a host, so a URL tab stands in for it; its place and size are the terminal tab\'s.' },
  { area: 'workspace', state: /preview/, el: 'address bar', cls: 'SPEC', why: 'C14 keeps Inspect and Region, and W7 keeps Run/Stop, the device switch and the capture tools, in the preview\'s bar; the prototype draws a stand-in with Back and Forward that the app\'s preview does not have.' },
  { area: 'workspace', state: 'code-files', el: 'file header', cls: 'SPEC', why: 'W7: the saved state and the two reveal buttons of the app\'s file header; the name, the folder, the box and the line match.' },
  { area: 'workspace', state: 'code-files', el: 'nested row', prop: 'glyph', cls: 'DATA', why: 'The prototype\'s second row is an open folder; the app\'s is closed until it is opened.' },
  { area: 'workspace', state: 'code', el: /code line/, cls: 'PROTO', why: 'The prototype colours keywords, strings and comments by hand; a grammar also colours functions, types and numbers, and splits the line into more parts.' },
  { area: 'workspace', state: 'code', el: 'line number', cls: 'PROTO', why: 'One row later in the app (the gutter counts a hidden spacer row); its 16 px on the left is the comment gutter\'s.' },
  { area: 'workspace', state: 'diff', el: 'diff header', part: /icon/, cls: 'SPEC', why: 'W7: the previous, next and reveal buttons of the app\'s diff.' },

  // ── Menus, tooltips, dialogs, states ───────────────────────────────────────
  { area: 'overlays', state: /hover-(session|selected) row/, cls: 'SPEC', why: 'DESIGN.md, session rows: hover adds Pin, Tags and Archive, and the title makes room for them.' },
  { area: 'overlays', state: /^focus-/, cls: 'SPEC', why: 'DESIGN.md, Focus: rows and tabs draw the line inside their edge (`focus-line-inset`), where a list would clip it; same 2 px, same colour.' },
  { area: 'overlays', state: /filter-menu|sort-menu|more-menu/, part: 'box', prop: /^(x|y)$/, cls: 'SPEC', why: 'DESIGN.md: the group header\'s buttons are 24 px (22 px in the prototype), so the menu under them starts 1 px left and 1.4 px lower.' },
  { area: 'overlays', state: 'filter-menu', cls: 'DATA', why: 'The fixture\'s sessions have tags, so the app\'s menu has a Tags group.' },
  { area: 'overlays', state: /sort-menu|more-menu/, cls: 'SPEC', why: 'S1: "The shell matches today\'s app": the app\'s own items.' },
  { area: 'overlays', state: 'tooltip-rail', cls: 'SPEC', why: 'S1: "The shell matches today\'s app": the rail\'s tooltips stand to its right, and the destination is called Tasks.' },
  { area: 'overlays', state: /^tooltip/, part: 'box', prop: 'x', cls: 'PROTO', why: 'Half a pixel: both are centred on the control, the prototype\'s rounded the other way.' },
  { area: 'overlays', state: 'sheet', el: 'scrim', cls: 'PROTO', why: 'The prototype\'s scrim stands over its own page ground (#d6d6da); the scrim is the same colour.' },
  { area: 'overlays', state: 'sheet', cls: 'SPEC', why: 'H1: the sheet "follows the app\'s registry": its labels, its order within Chat, and no "Open automations", so it is one row shorter.' },
  { area: 'overlays', state: 'collapsed', el: 'selected session tab', cls: 'SPEC', why: 'S1: "The shell matches today\'s app": with the sidebar hidden, the button that shows it stands before the tabs.' },
  { area: 'overlays', state: 'scrollbar', prop: 'fill', cls: 'PROTO', why: 'Ink at 26 % on both sides; the prototype\'s thumb is drawn outside the panel, over its page ground.' },
  { area: 'overlays', state: 'scrollbar', cls: 'SPEC', why: 'S3: "2 px from the edge". The panel\'s edge is its hairline in the app and the hairline\'s outside in the prototype.' },
];

const hit = (want, have) => want === undefined || (want instanceof RegExp ? want.test(have) : want === have);
const FIELDS = ['area', 'state', 'view', 'theme', 'el', 'part', 'prop', 'proto', 'app'];
export function classify(row) {
  const i = RULES.findIndex((rule) => FIELDS.every((f) => hit(rule[f], row[f])) && (rule.delta === undefined || Math.abs(Number(row.proto) - Number(row.app) - rule.delta) < 0.01));
  return i < 0 ? { cls: 'OPEN', why: '', rule: -1 } : { cls: RULES[i].cls, why: RULES[i].why, rule: i };
}
