# Every state drawn on the Proposals page, grouped by board. Crops are regions of the 1440x900 (or 1180x900) window.
FULL=None
COMP=(316,560,808,340)          # composer: strip, card, bottom row
COMPM=(316,380,808,520)         # composer with a menu or gate above it
COMPN=(316,470,808,430)         # new-session composer with its strip
PANEL=(1124,48,316,852)
SIDE=(0,40,316,860)
TITLE=(0,0,1440,64)
def S(id,preset,cap,crop=COMP,theme='light',ww=1440,actions=(),wait=200,h=900):
    return dict(id=id,preset=preset,cap=cap,crop=crop,theme=theme,ww=ww,actions=list(actions),wait=wait,h=h)
TRWT=(316,48,816,1902)          # the same, 1440x1950, for a whole thread
TRW=(316,48,816,1452)           # transcript column of a 1440x1500 window, header to composer
PANELX=(1124,48,316,1452)       # session panel of a 1440x1500 window
def JS_SCROLL_MSG(k): return {'js':f"(()=>{{const m=document.querySelectorAll('#thread .inner > .msg')[{k}];thread.scrollTop+=m.getBoundingClientRect().top-thread.getBoundingClientRect().top-12}})()",'wait':200}
def JS_PANEL_ROW(title): return {'js':f"(()=>{{const r=[...document.querySelectorAll('.pr')].find(x=>x.getBoundingClientRect().x>1100&&x.querySelector('.t')&&x.querySelector('.t').textContent.trim()==={title!r});r&&r.click()}})()",'wait':300}
JS_STRIP_OPEN={'js':"(()=>{const b=[...document.querySelectorAll('#actstrip button')].find(x=>x.textContent.trim()==='Open');b&&b.click()})()",'wait':300}
JS_CLICK_MI=lambda label:{'js':f"(()=>{{const m=[...document.querySelectorAll('.menu .mi')].find(b=>b.querySelector('.mi-l')&&b.querySelector('.mi-l').textContent.trim()==={label!r});m&&m.click()}})()",'wait':250}
BOARDS=[
 dict(file='Proposal-Redesign-Window',title='Window redesign: the proposed window, light and dark',cols=2,states=[
   S('win-l','idle','**Light.** A session with three sub-agents still running: title bar with usage capsule and session tabs (S1), sidebar with time groups (L1–L4), transcript (T1), composer with activity strip (K4) and bottom strip (K8), session panel docked (R1–R12).',FULL),
   S('win-d','idle','**Dark.** The same session.',FULL,theme='dark'),
 ]),
 dict(file='Proposal-Redesign-Shell',title='Window redesign: title bar segments and window states',cols=2,states=[
   S('tb-closed','idle','**Title bar, workspace closed (W1).** Two segments. The 1×16 separator sits exactly above the sidebar’s right edge.',TITLE),
   S('tb-open','workspace-preview','**Title bar, workspace open (W1–W3).** Three segments: workspace tabs after the second separator, which sits exactly above the panel’s left edge; a third separator closes the workspace segment, so Search and the Chat/Workspace toggles stand apart at the far right.',TITLE),
   S('ws-1180','workspace-preview','**1180 px, workspace open.** The workspace takes half the area right of the sidebar (min 320, chat keeps 360). Overflowing workspace tabs fade at the edge; the selected tab never truncates (W2, W4).',FULL,ww=1180),
   S('collapsed-full','idle','**Sidebar collapsed (rail only).**',FULL,actions=[{'click':'#railchats'}]),
   S('tb-collapsed','idle','**Sidebar collapsed.** The first separator follows the usage capsule.',TITLE,actions=[{'click':'#railchats'}]),
 ]),
 dict(file='Proposal-Redesign-Sidebar',title='Window redesign: sidebar session list',cols=5,states=[
   S('side-l','idle','**List (L1, L3, L4).** Project letter leads; status replaces the time: spinner, spinner + sub-agent count when only sub-agents run (“3”), “needs you”. Group headers 24 px with 14 px above; rows 28 px.',SIDE),
   S('side-d','idle','**Dark.**',SIDE,theme='dark'),
   S('side-hover','idle','**Group actions on hover (L4).** Filter, Sort and More appear on hover or keyboard focus.',SIDE,actions=[{'hover':'.gh'}]),
   S('side-filter','idle','**Filter menu.** While a filter is active the Filter button stays visible, in blue.',SIDE,actions=[{'hover':'.gh'},{'click':'[data-id=gfilter]'}]),
 ]),
 dict(file='Proposal-Redesign-NewSession',title='Window redesign: composer before the first message',cols=3,states=[
   S('ns-empty','new-session','**New session (K3, K11, C7).** Project and branch pickers in the top strip; no bottom strip (K7). Above it the empty state: project, where it runs, recent sessions to continue, project tasks to start from.',(316,48,808,852)),
   S('ns-empty-wt','new-session','**Empty state follows the pickers (K11).** New worktree chosen: “New worktree from main”.',(316,380,808,520),actions=[{'click':'[data-id=pill]','wait':250},JS_CLICK_MI('Work in a new worktree'),{'press':'Escape'},{'mouse':[700,120]}]),
   S('ns-empty-none','new-session','**No project (K11).** Says so and asks for a project; nothing to continue or start from.',(316,380,808,520),actions=[{'click':'[data-id=proj]','wait':250},JS_CLICK_MI('No project'),{'mouse':[700,120]}]),
   S('ns-empty-d','new-session','**Dark.**',(316,48,808,852),theme='dark'),
   S('ns-proj','new-session','**Project menu (⌘;).** Projects, then “No project”.',COMPM,actions=[{'click':'[data-id=proj]'}]),
   S('ns-branch','branch-menu','**Branch menu (K7).** Search field focused; branches with a check; “Work in a new worktree” and “Temporary session” (mutually exclusive); previous worktrees.',(316,250,808,650)),
   S('ns-search','branch-menu','**Branch search.** Filters branches and previous worktrees as you type.',(316,250,808,650),actions=[{'type':'feat'}]),
   S('ns-wt','worktree-chosen','**Worktree chosen.** The branch pill reads “New worktree from main”.',COMPN),
   S('ns-temp','temporary-chosen','**Temporary chosen.** No worktree; deleted when closed.',COMPN),
   S('ns-branch-d','branch-menu','**Dark, branch menu.**',(316,250,808,650),theme='dark'),
 ]),
 dict(file='Proposal-Redesign-Composer',title='Window redesign: composer toolbar, send and stop',cols=3,states=[
   S('c-idle-empty','idle-quiet','**Idle, empty (C8).** Send is outline and disabled. Context ring with a full track (C2).'),
   S('c-ready','idle-quiet','**Text typed.** Send turns accent.',actions=[{'click':'#field'},{'type':'Also check the weekly window'}]),
   S('c-run','running-activity','**Running, empty field (C8, K4).** Dark Stop. Its label names the scope: “Stop the turn and 3 sub-agents ⌘.”. Placeholder “Queue a message for when the agent finishes…”.'),
   S('c-run-typed','running-typed-split','**Running with text (C9).** Stop stays a separate square; Send becomes the split “Queue ↵” + chevron.'),
   S('c-split-menu','split-menu','**Split menu (C9).** Queue ↵ / Steer ⌥↵ (adds to the running turn without stopping it). Settings › Chat › “Enter while running” swaps which one Enter does.',COMPM),
   S('c-stopping','stopping','**Stopping.** Spinner in the Stop slot; the transcript says “Stopping…”.'),
   S('c-subs','idle','**Turn ended, sub-agents still running (C8).** Stop stays (“Stop 3 sub-agents”); with text typed, Send sits beside it.',actions=[{'click':'#field'},{'type':'Then open a PR'}]),
   S('c-planning','planning','**Planning (C1).** No Plan toggle: the permissions control reads “Planning · then Auto-Edits”.',COMPM),
   S('c-cycle','idle-quiet','**⇧⇥ cycles Interactive ↔ Auto-Edits (C12).** A tooltip names the new mode; screen readers hear it.',actions=[{'click':'#field'},{'press':'Shift+Tab','wait':150}]),
   S('c-model','idle-quiet','**Model menu (C5).** Provider tabs as in today’s app, the selected provider’s models, then the inline Effort segment.',COMPM,actions=[{'click':'[data-id=model]','wait':250}]),
   S('c-locked','running-activity','**Model locked during a turn (C5).** “Model changes apply after this turn”.',actions=[{'click':'[data-id=model]','wait':250}]),
   S('c-switch','idle-quiet','**Browsing the Codex tab (C5).** Lists Codex’s models without changing anything. Picking one switches the chat in place, no confirmation.',COMPM,actions=[{'click':'[data-id=model]','wait':250},JS_CLICK_MI('Codex')]),
   S('c-perm','idle-quiet','**Permissions menu (C6).** Interactive, Auto-Edits, Auto (Claude only, amber), Unattended (amber chip).',COMPM,actions=[{'click':'[data-id=perm]','wait':250}]),
   S('c-unatt','idle-quiet','**Turning on Unattended asks once per session (C13).** Cancel is focused.',COMPM,actions=[{'click':'[data-id=perm]','wait':250},JS_CLICK_MI('Unattended')]),
   S('c-unatt-on','perm-unattended','**Unattended on.** Amber chip on the permissions control.'),
   S('c-ctx85','context-85','**Context 85 % (C2).** Warning ink from 80 %.'),
   S('c-ctx97','context-97','**Context 97 %.** Critical ink; clicking offers “Compact conversation”.',COMPM,actions=[{'click':'[data-id=ring]','wait':250}]),
   S('c-360','width-360','**Composer 360 px (C6).** Model and permissions merge into one chip; only the model name truncates.',COMP),
   S('c-240','width-240','**Composer 240 px.** The chip shows only the status; ring, Stop and Queue wrap to a second toolbar row.',(316,520,808,380)),
   S('c-idle-d','idle-quiet','**Dark, idle.**',theme='dark'),
   S('c-run-typed-d','running-typed-split','**Dark, running with text.**',theme='dark'),
   S('c-perm-d','idle-quiet','**Dark, permissions menu.**',COMPM,theme='dark',actions=[{'click':'[data-id=perm]','wait':250}]),
 ]),
 dict(file='Proposal-Redesign-ComposerContent',title='Window redesign: files, captures and quotes in the composer',cols=3,states=[
   S('cc-files','composer-files','**Files and images (C14).** Every tile is the same size, 172 × 40: a file shows its extension in a tinted square, an image its thumbnail and dimensions. A longer name fades at the edge and shows whole in the tooltip.',COMPM),
   S('cc-caps','composer-captures','**Captures and code annotations (C14).** Same tile size: thumbnail (or the file’s extension for code), the note as the title, `element1 · selector` or `codex.rs:32–38` in mono, faded when long. The pencil appears on hover; one without a note offers “Add a note”.',COMPM),
   S('cc-caps-hover','composer-captures','**Hovering a capture.** The pencil edits its note.',COMPM,actions=[{'hover':'.att.capt'}]),
   S('cc-quotes','composer-quotes','**Quotes (C14).** The app’s multi-quote segments: each quote on one line (ellipsis, the whole quote in the tooltip), then the text written for it; the newest quote sits right above the field.',COMPM),
   S('cc-quote-menu','idle-quiet','**Quote in reply.** In every message’s More menu.',(316,48,808,852),actions=[{'js':"(()=>{const m=[...document.querySelectorAll('#thread .turn')].pop();m.querySelector('.mfoot').style.opacity=1;m.querySelector('[data-mact=more]').click()})()",'wait':300}]),
   S('cc-select','idle-quiet','**Highlight to quote (C14).** Selecting text in a message offers Quote and New session, as today’s selection toolbar does.',(316,48,808,852),actions=[{'mouse':[1300,880]},{'js':"(()=>{const a=[...document.querySelectorAll('#thread .ans')].pop();const t=a.querySelector('p').firstChild;const r=document.createRange();r.setStart(t,0);r.setEnd(t,Math.min(84,t.length));const s=getSelection();s.removeAllRanges();s.addRange(r);thread.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));setTimeout(()=>{const sp=document.createElement('span');sp.className='selhl';r.surroundContents(sp)},60)})()",'wait':300}]),
   S('cc-all','composer-everything','**Everything at once.** Attachments wrap above the quotes; Send enables with any of them.',COMPM),
   S('cc-all-d','composer-everything','**Dark.**',COMPM,theme='dark'),
   S('cc-quotes-d','composer-quotes','**Dark, quotes.**',COMPM,theme='dark'),
 ]),
 dict(file='Proposal-Redesign-Activity',title='Window redesign: queue and activity strip',cols=3,states=[
   S('a-expanded','running-activity','**Activity strip (K2, K4, R13).** The top drawer: same surface as the card, inset 12 px, tucked under it. Every ongoing item is a row: kind icon, title, then a small spinner with the elapsed time, and Stop.'),
   S('a-needs','needs-you','**Needs you (K4, G5, K10).** The request shows above the composer on its own and the strip steps back to one line: “Also ongoing · 3 running”. Expanding it lists the rest; a needs-you row’s “Open” opens that agent in the workspace (W8).',(316,200,808,700)),
   S('a-collapsed','activity-collapsed','**Collapsed to one row (K5).** First item plus “+N”; remembered per viewer.'),
   S('a-many','activity-many','**Five ongoing.** Capped at six rows, scrolls inside.',COMPM),
   S('a-stopped','running-activity','**Stop on a row is immediate (K4).** Toast “Stopped “Map diff scopes in the daemon””.',(316,48,808,852),actions=[{'click':'[data-act-stop="a1"]','wait':100}],wait=80),
   S('q-two','queue-two','**Queue of two (C10).** Rows inside the card’s top, each with edit and remove.'),
   S('q-failed','failed-queue','**After a Stop (C10).** The first row turns error-toned: “Not sent: the session stopped.” with Send now, edit, remove; later rows wait.'),
   S('a-expanded-d','running-activity','**Dark, activity strip.**',theme='dark'),
   S('q-failed-d','failed-queue','**Dark, failed queue.**',theme='dark'),
   S('a-every','every-activity','**Every kind, expanded under a request (K4, K10, R13).** Sub-agent (Bot), delegated task (Bot, filled), workflow (Route), monitor (Binoculars), background command (SquareTerminal). Needs-you first with Open (opens it in the workspace); everything else Stop, never Cancel (T1c).',(316,48,808,852),actions=[{'click':'[data-gate-strip]'}]),
   S('a-gate','every-activity','**While a request shows, the strip steps back (K10, G5).** The oldest request shows on its own; its eyebrow says how many more wait. The item being answered leaves the strip; the rest shrink to one line with a chevron to expand.',(316,200,808,700)),
   S('a-jump','every-activity','**Activity row → transcript (R13).** Clicking a monitor, background command or schedule row scrolls the transcript to its row, opens it and highlights it. Agents, delegated tasks and workflows open instead (W8, R13).',(316,48,1124,852),actions=[JS_PANEL_ROW('pnpm dev until "ready"')]),
   S('a-every-d','every-activity','**Dark.**',(316,200,808,700),theme='dark'),
 ]),
 dict(file='Proposal-Redesign-BottomStrip',title='Window redesign: where it runs, branch and changes',cols=3,states=[
   S('b-wt','idle-quiet','**Worktree (K6, K8).** A bare row under the card: “Worktree · feat/quota-reset from main”; changes pushed right.'),
   S('b-local','idle-local','**Local checkout.**'),
   S('b-temp','bottom-strip-temporary','**Temporary.** Locked; deleted when closed.'),
   S('b-none','idle-nochanges','**No changes.** The changes part is hidden.'),
   S('b-chg','changes-popover','**Changes popover.** Changed files with counts and “Open diff”.',COMPM),
   S('b-wtpop','idle-quiet','**Worktree popover.** Branch, from, path; Open folder, Move to another worktree…',COMPM,actions=[{'click':'[data-id=wt]','wait':250}]),
 ]),
 dict(file='Proposal-Redesign-Gates',title='Window redesign: permission, plan and question gates',cols=3,states=[
   S('g-perm','gate-permission','**Permission (G1, G2).** Pinned above the composer. Tool and command; Allow once is primary; Always allow names its rule; Reject.',COMPM),
   S('g-perm-det','gate-permission','**Details open.** The raw input as JSON.',(316,300,808,600),actions=[{'click':'[data-g="det"]'}]),
   S('g-sub','needs-you-open','**A sub-agent’s gate (G5).** Shows on its own, oldest request first; the eyebrow names the agent. The strip steps back to one line while it shows (K10).',(316,240,808,660)),
   S('g-plan','planning','**Plan (G3).** Plan body, mode segment preselected to the composer’s mode, Clear context, Approve & run / Keep planning / Reject.',(316,300,808,600)),
   S('g-plan-rev','plan-revise','**Keep planning.** Feedback box with Cancel / Send feedback.',(316,300,808,600)),
   S('g-q','gate-question','**Question (G4).** The question is the title, context under it; compact options aligned to the text column; “Recommended” tag.',(316,200,808,700)),
   S('g-q-other','gate-question','**Other… selected.** A text field appears; Submit enables.',(316,200,808,700),actions=[{'click':'[data-gq="__other"]'},{'type':'Rename only the public members'}]),
   S('g-perm-d','gate-permission','**Dark, permission.**',COMPM,theme='dark'),
   S('g-q-d','gate-question','**Dark, question.**',(316,200,808,700),theme='dark'),
 ]),
 dict(file='Proposal-Redesign-Transcript',title='Window redesign: transcript, every row and state',cols=4,states=[
   S('tr-files','every-tool','**Files, searches, edits, commands, the web (T1, T1a).** Glyph, verb, target, receipt. Edits carry +/− and open in the diff editor; a failed step that later passed is grey.',TRW,h=1500,actions=[JS_SCROLL_MSG(0)]),
   S('tr-tools','every-tool','**Tool calls, images, agents (T1a, T1c).** MCP and tools without a card share one row; a failed call opens by itself and the header counts it in muted rose (S6). Sub-agents list their steps as rows.',TRW,h=1500,actions=[JS_SCROLL_MSG(1)]),
   S('tr-deleg','every-tool','**Delegated tasks, every state (T1c, T1e, T1f).** Same row as a sub-agent with the filled robot and its provider; a finished task’s result lands inside its card, with no separate result message. While any is still going the turn keeps a spinner, stays open and counts them, needs-you first.',TRW,h=1500,actions=[JS_SCROLL_MSG(2)]),
   S('tr-misc','every-tool','**Markers (T1g).** Skills, plans, schedules, monitors, worktree operations and notifications are pills on the spine, outside the folded work; one with content opens a card (a plan is its markdown). The answered question stays outside “Worked”.',TRW,h=1500,actions=[JS_SCROLL_MSG(3),{'js':"(()=>{const b=[...document.querySelectorAll('.mkp')].find(x=>x.textContent.includes('Plan approved'));b&&b.click()})()",'wait':200}]),
   S('tr-status','every-tool','**Every row status (T1).** Running, passed, failed, stopped, declined, waiting for approval, no result. Then a reply with every markdown element.',TRW,h=1500,actions=[JS_SCROLL_MSG(4)]),
   S('tr-md','every-tool','**Markdown and links (T1d).** One link style: blue, underlined; raw URLs and file paths in mono with no glyph. URLs open where Settings › “Open links in” says; localhost goes through the tunnel on a remote daemon. A time marker after a 30+ minute gap.',TRW,h=1500,actions=[JS_SCROLL_MSG(5)]),
   S('tr-real','idle','**A realistic thread at rest (T1, T1b).** One work row per turn, folded once the answer starts. A time marker at the start and after 30+ minutes; a retried failure reads “1 failed, retried” in grey. The last turn names its agents (“2 agents”, T1e).',TRWT,h=1950,actions=[JS_SCROLL_MSG(0)]),
   S('tr-real-d','idle','**Dark.**',TRWT,theme='dark',h=1950,actions=[JS_SCROLL_MSG(0)]),
 ]),
 dict(file='Proposal-Redesign-SessionPanel',title='Window redesign: session panel',cols=5,states=[
   S('p-docked','idle','**Docked (R1–R5, R12).** “Session” title and Sections button (R3); no Session section (R2); fits its content, capped at the window (R5). Labels sit close to their rows; sections end with 10 px and an inset hairline.',PANEL),
   S('p-sections','panel-sections-menu','**Sections menu (R4).** Each section on or off, remembered per viewer.',PANEL),
   S('p-atts','attachments-overflow','**Attachments overflow (R7).** One row of tiles ending in “+N”.',PANEL),
   S('p-new','new-session','**Before the first message (R9).** Project-level sections only.',PANEL),
   S('p-docked-d','idle','**Dark.**',PANEL,theme='dark'),
   S('p-float','panel-floating','**Floating at a narrow column (R11).** Below 1044 px the toggle floats the panel over the chat; it ends 8 px above the composer, which stays usable. Click outside or Esc parks it.',FULL,ww=1180),
   S('p-float-d','panel-floating','**Floating, dark.**',FULL,theme='dark',ww=1180),
   S('p-act','every-activity','**Activity, every kind and state (R13).** The kind icon always leads, live or finished; the status sits at the end: spinner and time while running, “needs you” in amber, “failed” in muted rose (S6), else plain words. Finished work under Earlier.',PANELX,h=1500),
   S('p-act-wf','every-activity','**A workflow unfolds (R13).** Its phases with their state; the running phase lists its agents, each opens in the workspace (W8). Stop is its only action. No other row unfolds.',PANELX,h=1500,actions=[JS_PANEL_ROW('release-checks')]),
   S('p-act-d','every-activity','**Dark.**',PANELX,theme='dark',h=1500),
 ]),
 dict(file='Proposal-Redesign-Workspace',title='Window redesign: workspace surface',cols=2,note='**This retires split chats (W9).** Every secondary chat opens as a workspace tab beside the main chat: forked chats, side chats, delegated task chats and sub-agents. The chat column always holds one conversation.',states=[
   S('w-preview','workspace-preview','**Preview tab (W2, W4).** Slides in from the right and pushes the chat; the session panel parks (W6).',FULL),
   S('w-term','workspace-running','**Terminal, chat running.**',FULL),
   S('w-files','workspace-code-files','**File + Files tree.** Files toggle at the end of the workspace tabs (W3).',FULL),
   S('w-diff','workspace-diff','**Diff.**',FULL),
   S('w-add','workspace-add-menu','**“+” menu.** Open file…, New terminal ⌘J, URL… ⌘T, launch configurations.',FULL),
   S('w-empty','workspace-empty','**Opened with nothing in it (W5).** Tabs follow the session’s scope; this session has none. Closing the last tab collapses the workspace instead of showing this.',FULL),
   S('w-agent','every-activity','**Agent tab (W8).** A sub-agent or delegated task opens as a workspace tab: title, kind, status, Stop while live, the brief, its steps as transcript rows, the result. Opened from the transcript row’s “Open in workspace” or the Activity row.',FULL,actions=[JS_PANEL_ROW('Review the quota reset diff')]),
   S('w-float','workspace-panel-floating','**Workspace + floating session panel (R11, W6).**',FULL),
   S('w-files-d','workspace-code-files','**Dark.**',FULL,theme='dark'),
 ]),
 dict(file='Proposal-Redesign-Shortcuts',title='Window redesign: keyboard shortcuts sheet',cols=1,states=[
   S('k-sheet','shortcuts-sheet','**⌘/ sheet (H1).** The app’s registry grouped Sessions / Chat / Workspace / App, plus the redesign’s ⌘., ⌘;, ⌥↵ and ⇧⇥.',FULL),
 ]),
]
