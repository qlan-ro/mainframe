# app-tauri Migration Tracker (desktop → Tauri)

**Living checklist.** Update the status marks as work lands. This is the index that prevents skipped surfaces across sessions / context resets. It folds in the 10-subsystem port analysis (otherwise only in a temp file).

**Status:** ☐ todo · ◐ in progress · ☑ done · ⊘ dropped (intentional, not ported)
**Disposition:** `port` = port-as-is · `refactor` = refactor-then-port · `replace` = replace-with-new-design · `drop`

**Companion docs (don't duplicate — update them, link here):**
- Target structure → `docs/architecture/2026-06-04-app-tauri-architecture.md`
- Risks/critique → `docs/architecture/2026-06-04-app-tauri-architecture-critique.md`
- Chat runtime decision (+ react-opencode) → `docs/architecture/2026-06-05-chat-runtime-decision.md`

---

## Where we are

- ☑ **C1 spike** — Tauri shell + Node daemon sidecar + login-shell env capture; agent spawn under bare env proven (`87dbac10`).
- ☑ **Runtime decision** — `useExternalStoreRuntime` + per-chat controller, modeled on `@assistant-ui/react-opencode` (ADR).
- ☑ **Chat seam Phase 1** — drift-free, no message cache; reconnect re-syncs (`de4a73d1`).
- ☑ **AI toolkit** — skills (tauri-v2/shadcn/assistant-ui/radix/rust-best-practices), agents (tauri-shell-engineer/renderer-porter/design-conformance), review-gate hook.
- ☑ **Chat seam Phase 2A** — controller/reducer + `handle-daemon-event` + projection + `extras` + refetch-on-gap; dead Phase-1 spine removed; drift/gap empirically verified (`98f43f5a`).
- ☑ **shadcn foundation + theme + `@assistant-ui@0.14.14` bump** — 18 primitives, warm-chrome tokens, restyled ToolFallback/ToolGroup, aligned assistant-ui set (`8e18e634`, `48cfefd5`).

---

## Chat Phase-2 build order (refined by the assistant-ui adoption research, 2026-06-05)
Do the chat leaves in this order; ☑ = done.
1. ☑ **shadcn foundation** — `components.json` + 18 `ui/` primitives + `globals.css` mapping shadcn vars → `--mf-*` (warm chrome, computed-CSS-verified); testid passthrough (`8e18e634`).
2. ◐ **assistant-ui shadcn group** — `ToolFallback` + `ToolGroup` restyled (`8e18e634`); `quote` + markdown + other shadcn components pending the inventory sweep.
2b. ☑ **bumped `@assistant-ui` → `react@0.14.14` / `core@0.2.10` / `store@0.2.13`** — set aligned (skew fixed), `groupPartByType`/`display:'standalone'` available (`48cfefd5`). Drift re-verify **PASSED** on 0.14.14 (no regression).
3. ☑ **runtime spine** — controller/reducer + `extras` (Phase 2A, `98f43f5a`).
4. ☑ **projection (go native)** — `convert-message` + `map-assistant-blocks` emit NATIVE parts: flat tool-calls (no `_ToolGroup`) + a `Task` tool-call carrying native `messages` (subagent transcript via `ExportedMessageRepository.fromArray`); `image` parts no longer skipped; `\0` sentinel/uniqueId/≥1-part preserved (the shared recursive mapper IS the WS14c invariant). **Verified:** payload sufficient, no daemon change. 13 unit tests green.
5. ☑ **groupBy + dispatch** — `MessagePrimitive.GroupedParts` + a **daemon-authoritative** `makeChatGroupBy` (reads `message.metadata.custom.mainframe.partGroups`, NOT a tool-name heuristic — see `2026-06-05-native-tool-rendering-seams.md`); standalone tools float, explore groups coalesce, reasoning collapses; `AssistantMessage`/`tool-dispatch` render leaves + the explore ToolGroup with a synthesized summary. **Both seams removed** (native card type + daemon membership).
6. ☑ **tool registry** — ONE registry (`Record<string, ToolCallMessagePartComponent>`, Fallback=`ToolFallback`), `resolveToolCard` for mcp__* prefix, `register-cards.ts` assembly (side-effect import in ChatThread, cycle-free); `makeAssistantToolUI` dropped. 14 per-family cards ported + restyled to warm-chrome (Edit/Write/Read/Search/Bash/Plan/Ask/MCP/Schedule/Worktree/Skill/Task/TaskProgress) + shared `tools/shared/*` infra + `ToolResultExpand` + diff-tint tokens. **Empirically verified** on `~/.mainframe_dev` (0 fallbacks). *Pending: design-conformance pass + remove SearchCard's dead structured-Grep branch (real Grep result is a plain string).*
7. ☑ **Task/subagent card** — native `ToolCallMessagePartComponent` reading `part.messages`, rendered via `ReadonlyThreadProvider` + `ThreadPrimitive.Messages` (reuses our message components so nested tools group). 13 Task cards rendered in the empirical check. *Pending: subagent `<usage>` stats — daemon doesn't surface them structurally (header omits them for now).*
8. ☐ **composer shell** — native `ComposerPrimitive.*` (Root/Input/Send/Cancel/Attachments/Quote) + AttachmentAdapter. (NOT native `Queue` — keep daemon-backed `QueuedMessageBanner`.)
9. ☐ **composer config toolbar** — stateless shadcn controls → `setRunConfig.custom` (shared Zod schema, daemon-validated); `@`-mention via `Command`.
10. ☐ **permission/ask/plan cards** — port onto shadcn, read via `useChatPermissions`/`useChatQuestions` over `extras`; queue-front invariant; mount above composer.
11. ☐ **sessions sidebar (hybrid)** — one global `useRemoteThreadListRuntime` (sessions + `custom` metadata via chats-REST adapter) + native `ThreadListItemPrimitive` rows (rename/archive/delete/select/active) rendered in OUR grouped/filtered/pinned layout via `ThreadListItemRuntimeProvider`/`ByIndexProvider`. NOT flat `ThreadListPrimitive.Items`; NOT per-project runtimes.
12. ☐ **data-testid + stress validation** — tag everything; run the ADR stress matrix (long chat · nested subagent + mid-turn permission · reconnect · optimistic dedup · two windows).

---

## Cross-cutting foundation (underpins everything — build/maintain first)

- ☑ **shadcn `components/ui/` layer** — 18 primitives built + theme-wired to `--mf-*` (`8e18e634`).
- ☐ **Theming / tokens** (`refactor`) — `mainframe-theme.css` → Tailwind v4 `@theme`; 4 runtime-switchable themes; split Monaco/aui-md CSS out of `index.css`; token traps (no `/opacity` on CSS vars).
- ◐ **Typed-surface layout engine** (`replace`) — SurfaceHost + SurfaceRail + by-arrival placement + per-session remembered layout (replaces the whole `zone/` system). *(designed in the brainstorm specs)*
- ☑ **Login-shell env / sidecar spawn** (C1) — `src-tauri/shell_env.rs` + `sidecar.rs`.
- ☐ **Sidecar packaging** — bundle Node runtime (Tauri ships none) + native deps (`better-sqlite3`, `node-pty`, `@vscode/ripgrep`, `typescript-language-server`, `pyright`); per-platform binaries; signing/notarization. **Schedule-killer risk — spike before GA.**
- ☐ **Capabilities / CSP** (`replace`) — least-privilege per-command trust boundary (`src-tauri/capabilities/`). shell plugin already dropped.
- ☐ **e2e harness + data-testids** — 130 Electron-bound specs + 301 testids have no Tauri story yet. The only behavioral safety net for the rewrite.
- ☐ **Tauri bridge** (`lib/tauri/`) — replace every `window.mainframe.*`: updates, showItemInFolder, openExternal, getAppInfo/getHomedir/readFile, showNotification, log. (terminal = Rust PTY; preview = embedded Tauri webview.)
- ☐ **Surface-intent bus** — features emit "open file/diff/surface" intents; only `layout/` subscribes (no `getState()` reach-through). Lint-enforce `features/** ↛ layout/**`.

---

## Port checklist by subsystem (from the 10-subsystem map)

### Shell & layout → `shell/` · `layout/` · `app/`
- ☐ `refactor` main.tsx · App.tsx + global keybinds · TitleBar · StatusBar (+useUpdateStatus/useConnectionState) · ConnectionOverlay/ErrorBoundary/Toaster
- ☐ `replace` TutorialOverlay · **entire `zone/` system + Layout + LeftRail/RightRail + store/layout.ts** · tool-windows.ts registry
- ☐ `drop` store/ui.ts
- ☐ `refactor` store/tabs.ts (center tabs/fileView/nav) · center/EditorTab/DiffTab/SkillEditorTab + panels/FileView* · panels/ChatsPanel+FlatSessionRow (god-files → decompose) · index.css

### Chat thread → `features/chat/{runtime,thread,tools,parts,find}`
- ☑ `refactor` convert-message.ts (projection) — *ported Phase 1, WS14c invariants preserved*
- ☑ `refactor` runtime provider → controller/reducer + `extras` + refetch-on-gap (Phase 2A, `98f43f5a`)
- ☑ `refactor` message components — `AssistantMessage` (GroupedParts dispatch + markdown + **native grouped reasoning** + action-bar/timing footer), `UserMessage` (cool card + directive-text chips + read-more + images), `SystemMessage` (compaction pill + **rich SkillLoadedCard**). Reasoning uses the canonical `group-reasoning` + `ReasoningRoot/Trigger/Content/Text` pattern (`defaultOpen={running}`). *(TurnFooter retired → MessageTiming; RenderBoundary deferred.)* **Empirically verified** on `~/.mainframe_dev`.
  - **Deferred User-Message states** (from `User Message States.html`, flagged so they're not lost): `UMCodeRef` (editor code-reference snippet card — *editor-integration leaf*); `UMInspectChip` (CSS-selector sandbox-inspect chips — *sandbox-capture leaf*); the PLAN "implementing plan" bubble (*permission/plan leaf*); file-attachment chips (*composer/attachments leaf*). Plain markdown code blocks a user *types* DO render via `markdownComponents`; `UMCodeRef` is a separate structured feature.
  - **Approved divergence:** `@mention` inline rendering uses the native `createDirectiveText` **Badge chip** (bg + border), not the artboard's plain accent-bold text — kept as an intentional upgrade (reviewed in the design-conformance pass). Don't re-flag.
  - **Design-conformance pass done** (vs `Chat Cards`/`User Message`/`Chat Markers` artboards): 2 blockers (silent `/opacity`-on-hex-`--destructive` → invisible error pills, fixed via `--mf-destructive-tint`), 8 majors + ~16 minors fixed. Reasoning "Thought for Ns" duration is gated on a daemon thinking-duration field (shows "Reasoning" until then).
- ☑ `refactor` tool cards (Edit/Write/Bash/Read/Search/Task/TaskGroup/ToolGroup/TaskProgress/MCP/Default/Plan/Skill/Worktree/Schedule + shared) — 14 families, warm-chrome, native registry.
- ☑ `replace` **unify the dual tool dispatcher** → one `tools.by_name`-style registry (`makeAssistantToolUI`/`renderToolCard` dropped); native `GroupedParts` for grouping + `part.messages` for subagents.
- ◐ `refactor` markdown stack — `markdown-text`(native `MarkdownTextPrimitive`)/`CodeHeader`/`syntax-highlight`(shiki)/`markdown-url-transform` ☑. FindBar+QuoteOnSelection (find leaf) · ToolResultExpand ☑ · message-parsing (inline mention highlight ported; full parser deferred).
- ◐ `port` small parts — `ReadMoreBubble` ☑ · `CompactionPill` ☑ · `SkillLoadedCard` ☑ (tool card) · native image parts ☑. SandboxCaptureContext/SelectorBreadcrumb/ImageThumbs-gallery/FileTypeIcon/ErrorPart deferred to their leaves.
- ☑ `drop` ThinkingPart.tsx — reasoning is native (shadcn `Reasoning`, collapsed).

> **Thread shell:** `ChatThread` + `App` restyled to warm-chrome (light), centered max-width column, native `ScrollToBottom`, `If running`→`useAuiState`, **CSS thin scrollbar** (radix ScrollArea doesn't bind to the autoscroll Viewport). Composer stays thin. Pending: `ViewportFooter` inset (real scroll-inset bug), welcome/suggestions.
> **Design-conformance:** chat cards + message shell PASSED (post-fixes) vs `Chat Cards`/`User Message`/`Chat Markers` artboards.

### Composer → `features/chat/composer/` — **SCOPED (next leaf; can't land in one pass)**
> The shell core is the "~90% native restyle"; the config toolbar + sandbox + worktree are GATED on data layers/surfaces not yet built. See `MIGRATION-INDEX.md` "Resume here" for the full scoping. Decompose the 485-line desktop `ComposerCard` — don't carry it.
- ☐ **shell core (buildable now):** `ComposerPrimitive` Root/Input/Send/Cancel restyle + running-swap · `ThreadPrimitive.ViewportFooter` (scroll-inset fix) · draft text · send via `controller.sendMessage` · **daemon-backed `QueuedMessageBanner`** (state wired in `interactions.queued`; needs daemon edit/cancel endpoints in `lib/`) · attachments (native `AttachmentAdapter`/AddAttachment/Dropzone/tile + rejection-toaster)
- ☐ **GATED — config toolbar** (model/effort/features/plan/permission): **prerequisite = a model-capabilities API + `runConfig` wiring** (app-tauri has neither; `controller.sendMessage` takes no config). Effort/features = pure fn of the selected model's advertised capabilities. Then reskin via shadcn Popover/Select (logic stays ours).
- ☐ **GATED — sandbox captures** (CaptureThumb/inspect chips): needs the sandbox-preview surface (not built; also unblocks `UMInspectChip`).
- ☐ **GATED — WorktreePopover**: needs worktree integration.
- ☐ **mention/highlight:** `@`-mention picker = **native `Unstable_TriggerPopover` + custom `Unstable_TriggerAdapter`** (DECIDED 2026-06-05; sync adapter over async daemon path-search; gate on @alpha churn) + `ComposerHighlight` overlay (transparent caret).
- ☐ `replace` composer-drafts.ts (module Map → store)

### Editor & viewers → `features/editor/` (+lsp/) · `features/viewers/`
- ☐ `refactor` Monaco code+diff editors · setup.ts (workers/theme/opener) · viewers (image/svg/pdf/csv) · LSP client · copy-reference · inferLanguage/file-types
- ☐ `port` inline comments (useInlineComments/InlineCommentWidget)
- ☐ `replace` regex navigation.ts (LSP covers it) · nav-state singletons (editor-state/diff-nav → store)
- ☐ `drop` LineCommentPopover

### Terminal → `surfaces/run/terminal/` + `src-tauri/terminal.rs`
- ☐ `replace` **PTY backend → Rust PTY** (was Electron node-pty + IPC)
- ☐ `refactor` TerminalInstance (xterm) · TerminalPanel (tabs)
- ☐ `port` terminal-cwd.ts · useTerminalStore
- ☐ `drop` tool-windows terminal registration

### Settings → `features/settings/`
- ☐ `replace` SettingsModal shell (chrome/sidebar/routing on shadcn Dialog)
- ☐ `refactor` settings store · Provider(+TuningDefaults/CodexTuning/ModelDropdown) · General/Notifications/About/Sidebar · RemoteAccess (tunnel/pairing/devices — decompose the 697-line god-file)
- ☐ `port` settings-api + remote-access-api
- ☐ `drop` Keybindings placeholder pane

### Modals / palettes / pickers → `components/overlays/` · `features/review/`
- ☐ `replace` SearchPalette (+search store) → shadcn Command
- ☐ `refactor` FindInPathModal · DirectoryPickerModal · ReviewPanel(+Header/DiffView/FileTree)
- ☐ `drop` FullviewModal

### Tasks / Git / Tags / Sandbox(Run) → `features/{tasks,git,tags,run}`
- ☐ `replace` Sandbox PreviewTab → **embedded Tauri webview** (inspect/capture/console)
- ☐ `refactor` sandbox capture overlays + LaunchPopover/StopPopover + launch plumbing · Tasks/Todos panels (TodosPanel/TodoModal/QuickAdd/FilterBar/Card/Attachments/DependencyPicker) + todos-api · Git (BranchPopover/List/Submenu/NewBranch/Conflict/Rename + useBranchActions) · Tags (Popover/Pill/store/api)
- ☐ `port` capture-to-chat send path

### State & data layer → `lib/daemon/` · `lib/api/` · `lib/tauri/` · `stores/` · `hooks/`
- ◐ `refactor` WS client + useConnectionState · ws-event-router · HTTP api/ — *partially in Phase 1*
- ☐ `refactor` chats store + chat-actions + useChatSession + useActiveProjectId (chat state → controller per ADR) · LSP client
- ☐ `port` domain stores (projects/adapters/settings/skills/tags/sandbox/terminal/background-tasks/theme/toasts/search/find-in-chat/tutorial/todos-filters) · pure helpers (adapters/launch/format-*/file-types/utils/markdown-url-transform/parse-at-token)
- ☐ `replace` tabs store · plugins-layout store · logger/notify/useUpdateStatus/global.d.ts (→ `lib/tauri`)
- ☐ `drop` layout/ui stores (zones/panels)

### UI primitives & plugins → `components/ui/` · `features/plugins/`
- ☐ `replace` Radix-wrapper primitives (button/tooltip/scroll-area) · context-menu · toggle · **the missing primitives (Dialog/Select/Dropdown/Popover/Command/Checkbox/Label)** → shadcn
- ☐ `refactor` PluginView/PluginIcon/PluginError/PluginGlobalComponents (re-platform Electron `<webview>` → Tauri) · plugins store
- ☐ `port` scroll-row/truncated-label (bespoke) · plugins-api · usePluginShortcuts · utils.cn()
- ☐ `drop` input.tsx · tabs.tsx · zone plugin bridge

---

## Open decisions (resolve as we hit them)
- ☐ **Shared pure-logic package** — where `convertMessage` + diff math + file-types live so desktop & app-tauri share one copy (extend `@qlan-ro/mainframe-types` vs new `@qlan-ro/mainframe-shared`). Currently app-tauri-local.
- ☑ **Sessions list** — hybrid: one global `useRemoteThreadListRuntime` + native `ThreadListItemPrimitive` rows in our grouped sidebar (build-order step 11).
- ☑ **Drift handling** — refetch-on-gap, no daemon `seq` (decided).
- ☑ **Tool cards / permissions / composer = assistant-ui** — adoption verdicts locked (2026-06-05): tool cards + composer are native-restyle MATCHES; permissions have no native UI → custom shadcn cards via `extras`. See `app-tauri/CLAUDE.md` golden-rule pointers + the build order below.
- ☐ **Permission card mount placement** — above-composer (queue-front, simple, matches today) vs inline-under-tool. Inline needs the daemon `control_request` to carry the originating `tool_use` id. *Default: above-composer; revisit if the daemon carries the id.*
- ☑ **Part model = go native** — `GroupedParts`/`groupPartByType`/`display:'standalone'` + `part.messages` for subagents. **Preferred: do it in `convert-message`** (project the daemon's existing nested encoding → native parts); no daemon/contract change if the payload suffices, daemon flat-parts is the fallback (verify at build).
- ☑ **Sessions list = hybrid** — one global `useRemoteThreadListRuntime` (domain data in thread `custom`) + native `ThreadListItemPrimitive` rows rendered in OUR grouped/filtered sidebar layout (not flat `Items`, not per-project runtimes).
- ☑ **Reasoning = native, collapsed** — adopt native `Reasoning`, drop the dead `ThinkingPart`.
- ☑ **Queued banner = keep daemon-backed** `QueuedMessageBanner` (native `Queue` is a different local model). **Message errors = keep text-part routing. Quote = native UI + unavoidable CLI serialization glue.**
- ☐ **Phase-2 Rust daemon go/no-go + sizing** — biggest unscoped workstream; decide before committing.
- ☐ **Electron app lifecycle** — retire vs coexist (port 31415 / data-dir / prefs-origin); parity definition-of-done.
- ☐ **Mobile-contract governance** — the WS/REST contract is co-owned; changes stay additive.

---

## Definition of done (per ported surface)
Typecheck + tests green · matches the prototype artboard (design-conformance) · passes thermo-nuclear standards · data-testids preserved · no `getState()` reach-through · file <300 lines · obsolete code dropped (not carried).
