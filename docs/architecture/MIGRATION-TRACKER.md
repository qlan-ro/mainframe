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

---

## Chat Phase-2 build order (refined by the assistant-ui adoption research, 2026-06-05)
Do the chat leaves in this order; ☑ = done.
1. ☐ **shadcn foundation** — `components.json` + base `ui/` primitives + wire `mainframe-theme.css` → shadcn vars (`--mf-*`); testid passthrough.
2. ☐ **assistant-ui shadcn group** — install + restyle `ToolFallback` + `ToolGroup` (map `bg-muted/*`→`--mf-*` via `opacity-*`).
2b. ☐ **bump `@assistant-ui/*` set → `react@0.14.14` / `core@0.2.10`** (matches react-opencode peer; unlocks `groupPartByType` + `display:'standalone'` + `GroupedParts` `indicator`; fixes the `core@0.2.2`↔`store@0.2.10` skew). Re-verify Phase 2A typecheck + drift test after. *(do after the foundation lands, before step 4)*
3. ☑ **runtime spine** — controller/reducer + `extras` (Phase 2A, `98f43f5a`).
4. ☐ **projection** — keep `\0` sentinel/uniqueId/≥1-part; **drop** `_ToolGroup/_TaskGroup/_TaskProgress` → native `part.messages` *(needs daemon support — open decision)*.
5. ☐ **groupBy + dispatch** — use `groupPartByType` (tool-call→group-tool, reasoning→group-thought) + `display:'standalone'` to float file-mutating/standalone tools out of the chain (needs the 2b bump); render `GroupedParts` incl. the `indicator` loading slot. Not the deprecated `Unstable_PartsGrouped`/`components.ToolGroup`.
6. ☐ **tool registry** — port card bodies into one `tools.by_name` map (Fallback=`ToolFallback`); `useToolArgsStatus`; drop `makeAssistantToolUI`.
7. ☐ **Task/subagent card** — `by_name` entry wrapping `MessagePartPrimitive.Messages` in `ReadonlyThreadProvider`.
8. ☐ **composer shell** — native `ComposerPrimitive.*` (Root/Input/Send/Cancel/Attachments/Quote/Queue) + AttachmentAdapter.
9. ☐ **composer config toolbar** — stateless shadcn controls → `setRunConfig.custom` (shared Zod schema, daemon-validated); `@`-mention via `Command`.
10. ☐ **permission/ask/plan cards** — port onto shadcn, read via `useChatPermissions`/`useChatQuestions` over `extras`; queue-front invariant; mount above composer.
11. ☐ **sessions sidebar** — `useRemoteThreadListRuntime` (chats-REST adapter) + **`ThreadListPrimitive`** (Root/Items/New/LoadMore) + **`ThreadListItemPrimitive`** (Root/Trigger/Title/Archive/Delete/Unarchive), restyled to our sessions design (FlatSessionRow + project grouping + queued badge + cost). Run the design-vs-native check at this leaf. Docs: assistant-ui.com/docs/primitives/thread-list.
12. ☐ **data-testid + stress validation** — tag everything; run the ADR stress matrix (long chat · nested subagent + mid-turn permission · reconnect · optimistic dedup · two windows).

---

## Cross-cutting foundation (underpins everything — build/maintain first)

- ☐ **shadcn `components/ui/` layer** (`replace`) — Dialog/Select/Dropdown/Popover/Command/Checkbox/Label/Switch/Tooltip. Root cause of ~6× duplicated overlay/dropdown code. **Build before porting feature UI.**
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
- ☐ `refactor` message components (Assistant/User/System/TurnFooter/RenderBoundary)
- ☐ `refactor` tool cards (Edit/Write/Bash/Read/Search/Task/TaskGroup/ToolGroup/TaskProgress/MCP/Default/Plan/Skill/Worktree/Schedule + Collapsible + shared)
- ☐ `replace` **unify the dual tool dispatcher** → single registry (renderToolCard canonical for nested groups)
- ☐ `refactor` markdown stack (markdown-text/MainframeText/Shiki/CodeHeader) · FindBar+QuoteOnSelection · ToolResultExpand · message-parsing
- ☐ `port` small parts (SandboxCaptureContext/SelectorBreadcrumb/ImageThumbs/ReadMore/FileTypeIcon/ErrorPart/SkillLoadedCard/CompactionPill)
- ☐ `drop` ThinkingPart.tsx

### Composer → `features/chat/composer/`
- ☐ `replace` config controls → shadcn (ComposerDropdown/EffortPicker/FeaturesPopover/PlanModeToggle/permission chip)
- ☐ `refactor` model-tuning helpers · input+highlight overlay · WorktreePopover(+BranchSelect) · QueuedMessageBanner · decompose the 485-line ComposerCard
- ☐ `port` attachments (adapter/preview/rejection-toaster) · sandbox captures (CaptureThumb)
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
- ☑ **Sessions list** — use `useRemoteThreadListRuntime` (decided; in Phase 2B).
- ☑ **Drift handling** — refetch-on-gap, no daemon `seq` (decided).
- ☑ **Tool cards / permissions / composer = assistant-ui** — adoption verdicts locked (2026-06-05): tool cards + composer are native-restyle MATCHES; permissions have no native UI → custom shadcn cards via `extras`. See `app-tauri/CLAUDE.md` golden-rule pointers + the build order below.
- ☐ **Permission card mount placement** — above-composer (queue-front, simple, matches today) vs inline-under-tool. Inline needs the daemon `control_request` to carry the originating `tool_use` id. *Default: above-composer; revisit if the daemon carries the id.*
- ☐ **Queued banner source** — native `ComposerPrimitive.Queue` (transient) vs persisted `QueuedMessageRef` (daemon concept) bridged through the runtime. *Decide at the composer leaf.*
- ☐ **Daemon `part.messages` for subagents** — dropping the `_TaskGroup` virtual-tool encoding requires the daemon to populate `ToolCallMessagePart.messages` with `ThreadMessage[]`. *Confirm/port before the Task-card leaf; else subagent transcripts render nothing.*
- ☐ **Phase-2 Rust daemon go/no-go + sizing** — biggest unscoped workstream; decide before committing.
- ☐ **Electron app lifecycle** — retire vs coexist (port 31415 / data-dir / prefs-origin); parity definition-of-done.
- ☐ **Mobile-contract governance** — the WS/REST contract is co-owned; changes stay additive.

---

## Definition of done (per ported surface)
Typecheck + tests green · matches the prototype artboard (design-conformance) · passes thermo-nuclear standards · data-testids preserved · no `getState()` reach-through · file <300 lines · obsolete code dropped (not carried).
