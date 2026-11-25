# Every state drawn on the Proposals page, grouped by board. Crops are regions of the 1440x900 (or 1180x900) window.
FULL=None
COMP=(316,560,808,340)          # composer: strip, card, bottom row
COMPM=(316,380,808,520)         # composer with a menu or gate above it
COMPN=(316,470,808,430)         # new-session composer with its strip
SIDE=(0,40,316,860)
def S(id,preset,cap,crop=COMP,theme='light',ww=1440,actions=(),wait=200,h=900):
    return dict(id=id,preset=preset,cap=cap,crop=crop,theme=theme,ww=ww,actions=list(actions),wait=wait,h=h)
TRWT=(316,48,816,1902)          # the same, 1440x1950, for a whole thread
TRW=(316,48,816,1452)           # transcript column of a 1440x1500 window, header to composer
def JS_SCROLL_MSG(k): return {'js':f"(()=>{{const m=document.querySelectorAll('#thread .inner > .msg')[{k}];thread.scrollTop+=m.getBoundingClientRect().top-thread.getBoundingClientRect().top-12}})()",'wait':200}
def JS_PANEL_ROW(title): return {'js':f"(()=>{{const r=[...document.querySelectorAll('.pr')].find(x=>x.getBoundingClientRect().x>1100&&x.querySelector('.t')&&x.querySelector('.t').textContent.trim()==={title!r});r&&r.click()}})()",'wait':300}
JS_CLICK_MI=lambda label:{'js':f"(()=>{{const m=[...document.querySelectorAll('.menu .mi')].find(b=>b.querySelector('.mi-l')&&b.querySelector('.mi-l').textContent.trim()==={label!r});m&&m.click()}})()",'wait':250}
BOARDS=[
 dict(file='Proposal-Redesign-Window',title='Window redesign: the proposed window, light and dark',cols=2,states=[
   S('win-l','idle','**Light.** A session with three sub-agents still running: title bar with usage capsule and session tabs (S1), sidebar with time groups (L1–L4), transcript (T1), composer with activity strip (K4) and bottom strip (K8), session panel docked (R1–R12).',FULL),
   S('win-d','idle','**Dark.** The same session.',FULL,theme='dark'),
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
   S('ws-1180','workspace-preview','**1180 px.** The workspace takes half the area right of the sidebar (min 320, chat keeps 360), and slides in (W4). The title-bar tabs above it are built.',FULL,ww=1180),
 ]),
 dict(file='Proposal-Redesign-Shortcuts',title='Window redesign: keyboard shortcuts sheet',cols=1,states=[
   S('k-sheet','shortcuts-sheet','**⌘/ sheet (H1).** The grouped sheet is built (Shell-States). Still proposed: the rows for ⌘., ⌘;, ⌥↵ and ⇧⇥, which join the registry with their handlers.',FULL),
 ]),
]
