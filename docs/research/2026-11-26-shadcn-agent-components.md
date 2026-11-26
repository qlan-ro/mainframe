# shadcn agent components versus Mainframe's (26 November 2026)

Todo #469. Research only: which of shadcn's agent-interface components Mainframe should adopt, what each adoption removes, and where it fits in the transcript improvement plan (todos #455–#468).

**The rule this report applies:** adopt shadcn's component wherever an equivalent exists. Keep Mainframe's only for a need that shadcn's version lacks, and say what that need is. Today's look is not a reason to keep anything.

## 1. What was studied

| Source | Version |
| --- | --- |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | commit [`0e5b2e6`](https://github.com/shadcn-ui/ui/commit/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4) (25 Nov 2026) |
| `shadcn` CLI | 4.23.1 latest; Mainframe's lockfile has 4.23.0 |
| [`@shadcn/react`](https://www.npmjs.com/package/@shadcn/react) (Message Scroller and Questionnaire primitives) | 0.3.1, released 31 Aug 2026. Five releases between 26 Jun and 31 Aug, none since |
| Core components | [components](https://ui.shadcn.com/docs/components): Trace, Code Block, Message Scroller, Questionnaire, Item, Message, Bubble, Marker, Attachment, Hover Card, Progress (Radix base, `radix-vega` style, which is Mainframe's) |
| AI Elements | all 21 Radix patterns at [ui.shadcn.com/docs/ai-elements](https://ui.shadcn.com/docs/ai-elements), released 14 Oct 2026 |
| Mainframe | `origin/main` at `c7815b4a`; `packages/ui` on React 19.3.1, Tailwind 4.3.5, `radix-ui` 1.8.1, `@assistant-ui/react` 0.15.13 |

The deprecated Vercel repository (`vercel/ai-elements`, elements.ai-sdk.dev) was not used.

### 1.1 The finding that shapes everything else

**AI Elements are not components.** Each is an example file showing how to put core components together. Eleven of the 21 (Tool, Task, Chain of Thought, Subagent, Reasoning, Terminal, Stack Trace, Test Results, Sources, Plan, Queue) are compositions of one 173-line core component, **Trace**, and most of those also use **Code Block** (257 lines). The rest compose Message Scroller, Message, Bubble, Marker, Attachment, Item, Input Group, Hover Card, Progress, Dropdown Menu or Button. There is no package, and nothing in them holds state. Their docs map Vercel AI SDK part states (`input-streaming`, `output-available`, …) to Trace statuses. Mainframe does not use the AI SDK, so that mapping is replaced by Mainframe's own view-model.

So "adopt AI Element X" means "rebuild the matching Mainframe component on Trace or Code Block, following X's composition". The real decisions are about six core components: **Trace, Code Block, Message Scroller, Questionnaire, Item, and Hover Card + Progress**. Four more (Message, Bubble, Marker, Attachment) are already copied into `packages/ui/src/components/ui/` and used.

## 2. Verdicts

The full comparison for each component is in section 3. Line counts are non-test source lines under `packages/ui/src`, with test lines after the slash. Net lines are estimates.

| shadcn component (AI Elements built on it) | Mainframe equivalent | Src / tests | Verdict | Net lines removed (est.) |
| --- | --- | ---: | --- | ---: |
| **Message Scroller** (Chat) | `features/chat/thread/` scroll glue: `ChatThreadViewport`, `VirtualMessages`, `use-thread-bottom-pin`, `use-prepend-anchor`, `TranscriptScrollToBottom`, `reading-anchor`, `use-scroll-seek`, `EarlierMessages` | 865 / in the thread suite (3,501) | **Adopt as is, if #455 picks variant `v1s`.** The scroll measurements decide it, not this report | 600–800 (part 2 §3.8) |
| **Trace** (Tool, Chain of Thought, Subagent, Reasoning, Terminal, Plan, Sources) | `messages/turn/` rows: `RowDisclosure`, `ToolRow`, `AgentRow`, `AgentSteps`, `HistoricalAgentSteps`, `WorkHeader`, `StepList`, `RowGlyph`, `StopAction`, `ArtifactRow`; `tools/markers/MarkerPill`; `session-panel/PlanSection`; `parts/ReasoningText` | 1,454 + 125 + 119 + 42 / 1,920 + 388 + 144 + 217 | **Adopt and extend.** Missing: a needs-you tone, a stopped state, an action (Stop) beside the trigger, the persisted open state, the spoken status word | 200–350 |
| **Questionnaire** | `gates/AskUserQuestionGate`, `AskQuestionWizard`, `answers.ts` | 425 / 575 | **Adopt and extend.** Missing: Skip answers the whole request, not one question | 100–150 |
| **Code Block** (Terminal, Stack Trace, Test Results bodies) | `tools/bodies/` (`Surface`, `CodeBody`, `DiffBody`, `TerminalBody`, `BackgroundOutput`, `ResultText`, `code-lines`), `messages/code-snippet`, `parts/CodeHeader` + `syntax-highlight` | 719 / 409 | **Adopt and extend.** Missing: Shiki tokens in lines, "Show all N lines", ANSI stripping, spoken diff words, the instruction chip | 100–200 |
| **Item** (Confirmation) | `gates/shared/GateShell`, `gates/GateCard` | 151 / in the gate suite | **Adopt Item as the gate card. Don't use the Confirmation pattern as is**: it has only Approve and Deny | 50 |
| **Hover Card + Progress** (Context) | `composer/config-toolbar/ContextRing` | 117 / 145 | **Adopt and extend.** Missing: Compact conversation at 95 %. The ring trigger needs the owner's call (C2) | about 0 (adds the token breakdown) |
| Message, Bubble, Marker, Attachment (Message, Checkpoint, Prompt Input chips) | `components/ui/{message,bubble,marker,attachment}.tsx` | already copies | **Already adopted.** Resync with upstream when next touched | 0 |
| Prompt Input | `composer/` (assistant-ui `ComposerPrimitive`) | 680 for the shell | **Keep ours.** Missing in theirs: queue and steer, `/` and `@` triggers, quotes, draft hand-off (plan decision: assistant-ui owns the composer) | 0 |
| Model Selector | `config-toolbar/ModelMenu` and siblings | 674 | **Keep ours.** Missing: provider tabs and provider switching (C5). Theirs is two plain menus | 0 |
| Queue (AI Elements: the agent's todo list) | `session-panel/PlanSection` | see Trace | **Not used: Plan covers it.** Mainframe's message queue (`composer/queue/`, 649 / 876) has no shadcn equivalent and stays | 0 |
| Task | the turn's work row | see Trace | **Not used: Chain of Thought covers it** | 0 |
| Checkpoint | `messages/AssistantForkAction` | 146 | **Not applicable.** A CLI session can't drop later turns. Mainframe forks instead | 0 |
| Stack Trace, Test Results | `TerminalBody` line colouring | in Code Block | **Not applicable now.** Neither CLI sends frames or suites. Keep the colouring inside Terminal | 0 |
| Inline Citation, Suggestion | none | 0 | **Not applicable.** No citation parts and no suggestion chips in the product | 0 |
| File Tree | `composer/strips/ChangesButton` (flat list) | 110 | **Optional.** Use it if the changed-files popover becomes a tree | 0 |

### 2.1 Ranking by net lines removed and bugs avoided

1. **Message Scroller**: 600–800 lines. By construction it removes scroll causes S2 and S5–S10 (part 2 §2.5). Conditional on #455.
2. **Trace**: 200–350 lines. Gives the transcript, the markers and the panel's plan one disclosure model instead of three hand-rolled ones (`RowDisclosure`, `MarkerPill`, `PlanSection`). Bugs avoided: drifting focus, expanded state and status styling between those three. A step that is waiting gets the `pending` state for free.
3. **Questionnaire**: 100–150 lines. Bugs avoided: options are a `div` with a role and hand-written Enter/Space handling (`AskQuestionWizard.tsx:59`). Questionnaire uses native radio and checkbox inputs, and adds arrow keys, letter or number shortcuts, Enter to advance, and validation that moves focus to the problem.
4. **Code Block**: 100–200 lines. Four renderings of numbered code (`CodeBody`, `DiffBody`, `SnippetLines`, the markdown `pre`) become one. Bugs avoided: blank lines dropped when copying a selection (Code Block's empty line holds a newline on purpose; Mainframe's per-line `div`s have no text in an empty line, which needs checking), and a copy button that is not announced.
5. **Item**: about 50 lines, and one card anatomy for the three gates.
6. **Context**: no net saving. It adds the token breakdown the ring lacks.

## 3. Component by component

Each subsection covers what each side has that the other lacks, under the headings the brief asked for. Under "What we'd lose", **[confirm]** marks a feature of Mainframe's that looks worth keeping, for the owner to confirm.

### 3.1 Message Scroller (and the Chat pattern)

- **Theirs:** `@shadcn/react/message-scroller` (about 2,600 source lines in the package, about 3,400 test lines) plus a 139-line styled wrapper. Provider, Root, Viewport, Content (`role="log"`, `aria-relevant="additions"`), Item (`messageId`, `scrollAnchor`) and Button. Hooks: `useMessageScroller()` (`scrollToMessage`, `scrollToStart`, `scrollToEnd`), `useMessageScrollerScrollable()`, `useMessageScrollerVisibility()` (`currentAnchorId`, `visibleMessageIds`). `defaultScrollPosition` is `start`, `end` or `last-anchor`, with `data-pending-scroll` to hide the first paint. `preserveScrollOnPrepend` is the browser's anchoring plus a measured correction where the browser didn't anchor (Safari). It is unvirtualized.
- **Ours:** assistant-ui's `ThreadPrimitive.Viewport` + `ViewportFooter` + `ScrollToBottom`, a virtualizer, and the glue listed in the table.
- **Streaming:** theirs follows the reply while the reader stays at the live edge, and hands off from an anchored turn to following once the reply fills the viewport (0.2.1). Any wheel or touch input releases following, which is cruder than assistant-ui's check (part 2 §3.3).
- **Keyboard and accessibility:** theirs has `role="log"`. Ours has no log role on the transcript; the only live region is `EarlierMessages.tsx:25`.
- **States, sub-agents, provider differences, queue, gates:** not its concern. It scrolls whatever rows it is given. Gates stay in the footer slot above the composer (G1).
- **What we'd lose:** the virtualizer, on purpose (#461). The `last-anchor` and `scrollAnchor` model puts a new question near the top and streams the reply below it. Today Mainframe follows the tail. That is a behaviour change, and by the owner's rule theirs is acceptable. **[confirm]** Paging around an item (#462) is host code under either option: theirs only keeps the position when rows are prepended.
- **Cost:** an npm dependency (`@shadcn/react`, peer `react >=19`; Mainframe has 19.3.1). Quiet for three months. Medium lock-in.
- **Verdict:** adopt as is if the #455 rig picks `v1s`; otherwise the #461 fallback stands. As a component it fits: the visibility hook can feed `reading-anchor` and the Activity jump, and its Button replaces `TranscriptScrollToBottom`.

### 3.2 Trace (Tool, Chain of Thought, Subagent, Reasoning, Terminal, Plan, Sources)

- **Theirs:** `Trace`, `TraceLine` (`status`: `running`, `error` or `pending`; a shimmer on the title while running), `TraceIcon`, `TraceTitle`, `TraceDescription`, and `TraceCollapsible` (uncontrolled, or `open` with `onOpenChange`) with its Trigger and Content (a Radix Collapsible with a height animation). Lines nest without limit. A line can sit inside any trigger: a link, sheet, dialog or popover.
- **Ours:** `RowDisclosure.tsx` is the same idea, in the T1 grammar: glyph, verb, target, where, receipt, action, chevron.

| Need | Trace | Mainframe |
| --- | --- | --- |
| Running | `running` with a shimmer | spinner glyph and elapsed time (`StepClock`) |
| Failed | `error` (destructive colour) | `tone="fail"`, muted rose (S6) |
| Queued or waiting | `pending` (60 % opacity) | the word "queued" |
| **Needs you** | none | `tone="warn"` and "needs you" (T1e, R13) |
| **Stopped** | none | `CircleStop` and the word "stopped" |
| Uncertain | none | none in rows. It exists only on queued messages |
| Spoken status | no: `data-status` changes colour only | `statusWord` read before the name |
| Open state | local, or controlled | `disclosureStore` keyed by `rowKey`, so it survives remounts and window reloads |
| **Action in the row** | not modelled. The trigger is a button, so a nested Stop would be invalid HTML | `actions` beside a cover button (`RowAction`, `StopAction`) |
| Sub-agent nesting | nested `Trace` | `AgentSteps` / `HistoricalAgentSteps` and the steps guide line |
| Turn fold (Chain of Thought) | summary line over steps | `WorkHeader` with live counts ("1 needs you · 1 running"), two count buttons that open on the step they count, and child work holding the turn open (T1e) |
| Body | `CollapsibleContent`, animated, unmounted when closed | rendered only while open, not animated |

- **Claude versus Codex:** Trace is data-agnostic. Provider differences stay in `view-model/turn` (`toolKind`, `tool-row`) and `convert-acp-item`. The Reasoning pattern's rule fits both providers: the line can't open until text arrives, which covers Codex's empty or encrypted reasoning and Claude's redacted thinking.
- **What we'd lose by adopting as is:** needs-you and stopped states **[confirm]**; Stop and Open-in-workspace in the row **[confirm]**; open state that survives a remount **[confirm]**, which the scroll work relies on; the spoken status word **[confirm]**; the count buttons in the turn header **[confirm]**; the right-click file paths on a row (`data-file-path`).
- **Can it be extended without forking?** Yes, all of it. Add `warn` and `stopped` to `TraceLine`'s status union and the style (a few lines in a copied file Mainframe owns). Pass `open` and `onOpenChange` from `useRowOpen`. Put actions and count buttons in a flex wrapper next to the trigger, not inside it. Add the status word as `sr-only` text in `TraceTitle`. Turn off or shorten the height animation where `use-row-anchor` holds a row in place, and honour `motion-reduce`, which the copied content lacks.
- **Patterns, one by one:** Tool → `ToolRow`. Chain of Thought → `WorkHeader` + `StepList` (chosen over Task: the turn is the summary). Subagent → `AgentRow` and `DelegateRow` (keep the filled robot and provider name for delegated tasks, T1c, and the result merged into the card, T1f). Reasoning → `ThoughtRow` and `ReasoningText`. Its default opens while thinking and closes when done; Mainframe's decision was collapsed by default, and by the owner's rule theirs is acceptable **[confirm]**. Keep `use-held-displayed-text` as the text renderer inside it. Terminal → the Bash row, with "pnpm lint exited with code 1" titles and opening on first output. Plan → `PlanSection` ("2 of 4 done"; chosen over Queue, which splits the list into To do and Completed and so reorders the agent's plan). Sources → `WebBody` (24 lines): links must still open where Settings › "Open links in" says (T1d).
- **Cost:** copied in (`npx shadcn add trace`), with no dependency beyond `radix-ui`'s Collapsible, which Mainframe has. It uses `shimmer`, `in-[…]` and `has-[…]`, all already available: Mainframe imports `shadcn/tailwind.css` (see `styles/domain-tokens.css:311`) on Tailwind 4.3.5.
- **Verdict:** adopt and extend.

### 3.3 Questionnaire

- **Theirs:** `@shadcn/react/questionnaire` (about 2,700 source lines, about 4,300 test lines) plus a 335-line styled wrapper. A native `<form>`, one `Item` per question, native radio inputs (or checkboxes with `multiple`), a freeform `Input`, Previous, Skip, Next, Submit, Progress, Error, `shortcuts="letters"` or `"numbers"`, arrow-key movement, Enter to advance, validation that focuses the first problem, controlled navigation, and resuming from defaults. Keys are handled on the form, not the window, so the composer, which stays usable while a gate shows (G1), is unaffected.
- **Ours:** a step-by-step wizard (`current`, `selections`, `otherText` state). Options are `div`s with a role. "(Recommended)" becomes a tag (G4). The question is the title and the asker is named. Skip answers the whole request once. `GateGuard` holds input for 500 ms.
- **Permission and question flows:** the answer still goes through `buildAskUserQuestionResponse`. `onSubmit` reads `FormData` and maps it to the same `answers` shape (about 20 lines). The comment at `AskQuestionWizard.tsx:1-9` rejected the primitive because its only value surface is `FormData` and its Skip is per question. The first is a small mapping. The second is solved by a plain Skip button outside `Questionnaire.Skip`.
- **What we'd lose:** the whole-request Skip **[confirm]**, kept as above; the Recommended tag, kept in `ChoiceLabel`; `GateGuard`, which wraps any child and is unaffected.
- **Cost:** the npm package, shared with Message Scroller. The styled wrapper is copied in and restyled to G4.
- **Verdict:** adopt and extend. It does not depend on the scroll work.

### 3.4 Code Block

- **Theirs:** `CodeBlock` (`default` or `destructive`; `sm` size for tool output), Header, Title, Actions (shown on hover or focus), `CodeBlockCopyButton` with an `aria-live` "Copied", Content (`wrap`, `lineNumbers` through CSS counters, `startLine`, focusable), `CodeBlockLine` (`added`, `removed` or `highlighted`; an empty line keeps a newline so copied selections keep blank lines), and Footer.
- **Ours:** four renderings: `CodeBody` (numbered Shiki lines, clamped by `useClampedLines`, "Show all N lines"), `DiffBody` (with `sr-only` "Added:" and "Removed:"), `TerminalBody` (strips ANSI escapes, colours pass and fail lines, the test-runner summary), and `SnippetLines` for review comments. Plus the markdown `CodeHeader` with the instruction chip.
- **Streaming:** neither side streams inside the block. `BackgroundOutput` re-renders as output grows, and so would a Code Block.
- **What we'd lose:** Shiki tokens (they render as `CodeBlockLine` children, no fork); the clamp and Show all, which sit in the footer; ANSI handling, which runs before the lines are made; the spoken diff words **[confirm]** (Code Block marks lines with CSS `content: '+'`, which screen readers read inconsistently; keep the `sr-only` words as children); the instruction chip, which goes in Actions.
- **Restyle needed:** Code Block's style uses `ring-3 ring-ring/50` for focus; Mainframe's rule is the 2 px focus line (C3). It uses `scroll-fade-x` and `scroll-fade-y`, which Mainframe already overrides to avoid the WebKit mask leak (`styles/globals.css:272-296`, #970).
- **Cost:** copied in, no dependency.
- **Verdict:** adopt and extend. The tool bodies are independent of the scroll work; markdown code blocks belong with #465.

### 3.5 Item (and the Confirmation pattern)

- **Theirs:** Confirmation is an `Item` (media, title, description, actions) with Deny and Approve, shown outside the trace while approval is pending, which then turns back into a Tool line.
- **Ours:** `PermissionGate` (759 lines with its options, read dialog and grants), `PlanGate` (347) and the question gate, in one shell. Options come from the adapter verbatim, styled by `kind` (decisions 12 and 25). "Always allow" names the rule it saves (G2). There's a Details disclosure, and the plan's mode segment and Clear context (G3). The queue front shows one gate at a time, with "· code-reviewer · 1 more waiting" (G5). Sub-agent and delegated-task requests surface in the same slot.
- **What we'd lose by using Confirmation as is:** everything in the paragraph above. Binary approval is not Mainframe's permission model. That is essential.
- **Verdict:** adopt `Item` as the shell, replacing `GateShell` and `GateCard`, and keep the gate logic. The "becomes a line once answered" behaviour already matches: answering leaves a line in the transcript.

### 3.6 Hover Card + Progress (the Context pattern)

- **Theirs:** an outline button reading "N% context", opening a hover card with used / limit, a progress bar, and input, output and reasoning tokens.
- **Ours:** a 16 px ring beside Send with tabular figures, warning at 80 % and critical at 95 %, a visible track so it never reads as a spinner, "Compact conversation" when clicked at 95 % or more, and 0 % on a local draft (C2).
- **What we'd lose:** Compact conversation **[confirm]**, which goes into the hover card's content; the ring as trigger **[confirm]**. A text button is wider, and C6's narrow-width rules (below 400 px and 320 px) rely on the percentage staying when everything else shrinks. Their trigger is a plain `HoverCardTrigger`, so the ring can stay the trigger with no fork.
- **Verdict:** adopt and extend. Their card, with the token breakdown, behind our ring. Whether to also take their text trigger is the owner's call.

### 3.7 Keep ours or not applicable

- **Prompt Input → keep ours.** The plan keeps assistant-ui for the composer (#457). Theirs is an Input Group with attach, model menus and send, with Enter to send. It lacks the queue and steer split (C9), the queued rows inside the card (C10, C14), the `/` and `@` trigger popovers, quoting, the draft hand-off between composers, and the strips (K1–K11). Mainframe already uses the shadcn Input Group and Attachment underneath.
- **Model Selector → keep ours.** Theirs is two dropdown menus, one for the model and one for effort. C5 keeps provider tabs and an inline effort segment, locks the model during a turn, and has provider-switch footers. That is a multi-provider need theirs lacks. Both are built on shadcn's Dropdown Menu, so there's nothing to save.
- **The message queue → keep ours.** AI Elements' Queue is the agent's todo list. Mainframe's queue of messages waiting to be sent has no shadcn equivalent (assistant-ui's native Queue was already rejected in `packages/ui/CLAUDE.md`). The "Mobile queue contract" in `design/redesign/DECISIONS.md` (paused with a reason, Resume, uncertain head, Mark as sent, Copy to composer, Remove, Edit with 409 handling, Retry for rejected, steered rows left out) stays on `QueuedRows` and `held-queue-store`.
- **Checkpoint → not applicable.** Restoring drops every later message, which a provider CLI session can't do. Mainframe's equivalent action is Fork (`AssistantForkAction`). Marker, which Checkpoint is built on, is already in the tree.
- **Stack Trace and Test Results → not applicable now.** They need structured frames and suites. Claude and Codex send command output as text. Revisit if the daemon starts parsing test output.
- **Inline Citation, Suggestion → not applicable.** Neither CLI sends citation parts, and the design has no suggestion chips (K11's empty state offers "Continue in …", which is a different element).
- **File Tree → optional.** `ChangesButton` lists changed files flat in a popover. Adopt File Tree only if that list becomes a tree.
- **Message, Bubble, Marker, Attachment → already adopted.** The copies in `components/ui/` match upstream's exports with small local edits. `MarkerPill` (the T1g pills) does not use `Marker`. It moves onto Trace with the rows (3.2).

## 4. Maintenance and compatibility

| | Copied in (Trace, Code Block, Item, wrappers) | npm (`@shadcn/react`) |
| --- | --- | --- |
| Who owns the code | Mainframe, after `npx shadcn add`. Upstream changes arrive only when someone re-adds or diffs | shadcn. Updates arrive through the lockfile |
| Cadence | Trace and Code Block shipped 14 Oct 2026, Questionnaire Aug 2026, Message Scroller Jun 2026 | 0.1.0 to 0.3.1 between 26 Jun and 31 Aug 2026, nothing since |
| React | plain function components, React 19 fine | peer `react >=19`; Mainframe has 19.3.1 |
| Tailwind | needs v4.1+ variants (`in-[…]`, `has-[…]`, `pointer-coarse:`, `wrap-break-word`); Mainframe has 4.3.5 | unstyled |
| Radix | the `radix-ui` umbrella (Collapsible, Hover Card, Progress, Slot); Mainframe has 1.8.1 | none |
| Style | `radix-vega` CSS exists for every component used; Mainframe's `components.json` is `radix-vega` | n/a |
| Known conflicts | focus ring versus Mainframe's focus line (C3); destructive versus muted-rose `fail` (S6): Trace's `error` must map to `text-fail`, not `text-destructive` | none found |

Pin `@shadcn/react` exactly, as the assistant-ui set is pinned. It is sub-1.0.

## 5. Fit with the transcript improvement plan

| Adoption | Files it touches | Plan todos touching the same files | Placement |
| --- | --- | --- | --- |
| Message Scroller | `features/chat/thread/*` | #456, #461, #462, #464 | **Is #461's primary path** if #455 picks `v1s`. Not a separate phase |
| Trace: pilot on `PlanSection` | `components/ui/trace.tsx` (new), `features/session-panel/PlanSection.tsx`, `plan-view.ts` | none | **Phase 1, independent.** It proves the restyle and the added statuses on a surface no plan todo touches |
| Trace: transcript rows | `messages/turn/*` (`RowDisclosure`, `ToolRow`, `AgentRow`, `AgentSteps`, `HistoricalAgentSteps`, `WorkHeader`, `StepList`, `use-row-anchor`, `use-row-open`), `tools/markers/MarkerPill`, `orchestration/DelegateRow`, `tools/bodies/WebBody`, `TextUnit` | #461 (S11, S12 fold and row anchors), #463 (sub-agent views), #466 (turn builder: these rows read its facts) | **Phase 4, after #461 and #463, before #466.** The rows are rewritten once, then #466 changes what feeds them |
| Questionnaire | `features/chat/gates/AskUserQuestionGate.tsx`, `AskQuestionWizard.tsx`, `answers.ts` | none (#461 changes `ChatThreadViewport`, which only mounts the gate slot) | **Phase 1, independent** |
| Item gate shell | `gates/shared/GateShell.tsx`, `gates/GateCard.tsx`, the three gates | none | **Phase 1, after the Questionnaire todo** (same folder) |
| Code Block: tool bodies | `features/chat/tools/bodies/*`, `messages/code-snippet.tsx` | none directly. Row heights matter to the #455 rig, so don't change bodies while it is measuring | **Phase 1, after #455's measurements** |
| Code Block: markdown blocks | `parts/CodeHeader.tsx`, `parts/syntax-highlight.tsx`, `parts/markdown-text.tsx` | #465 (streaming markdown) | **Inside #465, or right after it** |
| Context hover card | `composer/config-toolbar/ContextRing.tsx` | none | **Phase 1, independent** |

#457 should record the result where it writes the assistant-ui boundary into `packages/ui/CLAUDE.md`: shadcn owns the row, gate, code and scroll primitives; assistant-ui keeps the composer, attachments, quoting, the action bar and the session list. The golden rule at the top of that file ("assistant-ui first") predates AI Elements and would otherwise send the next agent to assistant-ui's tool cards first.

## 6. Open questions for the owner

1. Rows: keep needs-you and stopped as statuses of their own, Stop in the row, and open state that survives a remount (3.2). Recommended: yes to all; they are additions to the copied file, not a fork.
2. Reasoning opens while thinking and closes when done (theirs), instead of collapsed by default (today).
3. A new question settles near the top with the reply streaming under it (Message Scroller's anchored turn), instead of following the tail. This only matters if #455 picks `v1s`.
4. The context control: our ring with their hover card (recommended), or their "N% context" button.
5. Question gate: keep Skip answering the whole request (recommended).
