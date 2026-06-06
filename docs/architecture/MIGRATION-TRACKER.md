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
- ☑ **Interactive gate cards + review-fix pass** (2026-06-06) — the 3 inline gate cards (build-order step 10) shipped + live-tested, then a thermo-nuclear + codex review pass: **judo-A** count-aware window-free reconcile (`0c7f987c`), **judo-B** server-authoritative composer config — no optimism (`538d769d`), **judo-C** response-only reply seam (`9a688642`), permission reply/resume reliability — verify-timer + connected-gated fallback + restore-stale guard (`770a6c0a`), daemon orphaned-`working` recovery (`0f8f7dfe`) + single-`UPDATE` + Zod route (`31adee85`), AskUserQuestion result-wording parser (`6bc77c21`). All tested + changesets. *(Still open from this review: ws-client `message.send` CLOSED-drop — see Critical below.)*

---

## Review follow-ups — DEFERRED (from the 2026-06-05 thermo-nuclear + architecture + codex reviews)

Durable capture so these aren't lost (the full write-ups live in volatile `/tmp` handoffs: `handoff-architecture-review.md`, `handoff-features-chat-restructure.md`, `handoff-permissions-ask-plan-cards.md`). **Sequence: type/contract fixes → silent-failure UX → tests → restructure LAST (mechanical, moves-only).** Don't collapse the controller/reducer/projection spine — it's praised as clean.

**🔴 Critical**
- ☑ **ws-client drops frames silently** — RESOLVED (2026-06-06). Permission-hang half via the 3s verify-timer + connected-gated ack-fallback + restore-stale guard (`770a6c0a`); and `send()` now **buffers on any non-OPEN state** and kicks a reconnect (flushed on `onopen`) instead of dropping a `message.send`/`permission.respond` (H2, `7181e058`). *(codex #2 + arch.)*

**🟠 High**
- ☑ **`noUncheckedIndexedAccess` ON** — set in `app-tauri/tsconfig.json` (**0 new errors** — the code was already index-safe) + a `vitest.config.ts` coverage floor (none before) (H1, `5fd7733d`).
- ☑ **Optimistic send-failure is now visible** — `MainframeMessageMeta` declares `pending`/`clientId`/`error` (project-messages already wrote them); `UserMessage` renders a "Failed to send" indicator so a failed send no longer looks sent (H5, `841effe2`). *(retry-resend still needs controller wiring — minor follow-up.)*
- ☑ **Daemon boundaries validated** — `ws-client.onmessage` drops malformed frames (object + string `type` guard; deliberately NOT re-declaring the `DaemonEvent` union); `convert-message` uses `coerceUserMeta` (type-checked extraction) instead of a blind cast (H4, `7181e058`). *(codex #6 + arch.)*
- ☑ **Daemon `error` events surface** — `handle-daemon-event` maps `{type:'error'}` → `run.failed` (global or this-chat; other chats ignored) (H3, `f46fecb6`). *(codex #7.)*
- ☑ **Unsound message casts removed** — the 3 `as unknown as {message}` reads were unnecessary (typed via the ScopeRegistry); replaced with direct `useAuiState` selectors (H6, `841effe2`).
- ☑ **`features/chat/` directory restructure** — DONE (2026-06-06). Reframed after review: the code had already *improved* on the 06-04 proposal (the `runtime/` placeholder became `controller/`+`runtime/`+`view-model/`; the proposal's `cards/` became `gates/`), so the real drift was doc-vs-code. Landed: `tool-dispatch`→`tools/`, `tool-group-summary`→`view-model/`, `composer/`→`config-toolbar/`+`edit/`, a `features/chat/README.md` charter, and architecture.md's tree updated to the realized structure. **Intentionally dropped:** the `cards/`-by-family split — 15 flat card files are fine and families don't match the flat registry lookup. Moves-only, 455 tests green.

**🟡 Medium**
- ☑ Failed **history load renders as an empty chat** — DONE (2026-06-06). `extras.retry` (= `controller.refresh()`) + a "Couldn't load this chat / Retry" banner in `ChatThread` that reads `state.loadState.type === 'error'`. Tests cover load-fail → error → retry → ready.
- ☑ **`useConnectionState.init()` has no try/catch** — DONE (2026-06-06). Port acquisition is guarded → `disconnected`/`unavailable` + a 2s retry (sidecar may still be spawning); status-listener registration is separate. No longer pins on "connecting". Tested.
- ☑ **`isResultError` duplicated across 3 pill cards** — DONE (2026-06-06). Type-safe `isErrorResult`/`extractResultContent` extracted to `tools/shared/result.ts` (barrel-exported); Worktree/Schedule/MCP cards import them.
- ☑ **cancel_failed UI surfacing** — DONE (2026-06-06). **Toast infra added** (sonner `<Toaster />` themed + mounted at the app root, `components/ui/sonner.tsx`); `routeDaemonEvent` raises `toast.error` on `message.queued.cancel_failed`. *(This also unblocks the deferred composer rejection-toaster.)*

**🟢 Low**
- ☑ **CLAUDE.md drift** — the `composer.setRunConfig` note is corrected (config flows via REST + is server-authoritative, judo-B) and the count-aware reconcile + response-only reply seam are documented (`3391a256`). *(The `chat/README.md` charter is still a nice-to-have — folded into the restructure item above.)*
- ☑ **`TaskProgressCard` imports from the core sidecar** — DONE (2026-06-06). `TaskProgressItem` exported from `view-model/message-meta.ts` (identical shape) + imported locally; **zero `@qlan-ro/mainframe-core` imports remain** in `app-tauri/src`.

**✅ Already handled this session (not deferred):** codex #3 (subscribe-ack), #4 (queued snapshot rehydration), #5 (attachment reconcile) — fixed (`4b70efe1`) + tested + codex-APPROVED. codex #1 (gates not mounted) — the **parallel gates session** mounted inline gate dispatch (`35054382`). The thermo-nuclear batch (crash fix, `request<T>`, controller seam, dead-code, fullBytes de-casts, typed factory) — landed + tested. **Sandbox captures in the user message** — see the dedicated deferred line under *Composer* below.

---

## Parity gaps — desktop→app-tauri audit (2026-06-06)

A 5-area parallel sweep (messages · composer · tools · gates · runtime/parts) comparing the desktop chat surface against the app-tauri port. **Runtime/data + tool cards came back clean-or-better; most absences are the tracker-deferred items above (each verified by its tracker quote).** Below are the **UNTRACKED** gaps it surfaced — logged so they aren't silently "missed". They cluster in the composer; the data/runtime spine is solid.

**🔴 Silent failures (no user signal — fix first)**
- ☑ **`worktreeMissing` guard gone (composer)** — desktop disables input + send and shows a "worktree was deleted" banner (`desktop ComposerCard.tsx:355-363,392,477`); app-tauri `composer/Composer.tsx` never reads `worktreeMissing`. **DONE** — `Composer.tsx` reads `chatConfig.worktreeMissing`, disables Input + Send + the attachment dropzone, and renders a `chat-composer-worktree-missing` banner (with `worktreePath`). Tested in `composer/__tests__/Composer.test.tsx`.
- ☑ **Attachment rejection unsurfaced (composer)** — the adapter still throws on >5MB (`composer/attachment-adapter.ts`) but nothing renders it; desktop showed an inline error band (`ComposerCard.tsx:341-354`). **DONE** — the native composer swallows a rejected `add()` (dropzone `console.error`s; button path doesn't catch), so `attachment-adapter.add()` now fires `toast.error` (M1 toaster) before re-throwing. Tested in `composer/__tests__/attachment-adapter.test.ts`.

**🟠 Lost controls / features (untracked)**
- ☑ **Adapter (agent) selector dropped (composer toolbar)** — desktop has a Claude/Gemini/Codex/OpenCode dropdown disabled once the chat has messages (`ComposerCard.tsx:413-420`); app-tauri had none. **DONE** — new `config-toolbar/AdapterSelect.tsx` (shadcn DropdownMenu, mirrors ModelSelect), `useComposerTuning` gained `setAdapter` → PATCH `/config { adapterId }`, mounted leftmost in `ComposerToolbar` and `locked` once `thread.messages.length > 0`. Renders nothing with ≤1 adapter. Tested in `AdapterSelect.test.tsx` + `use-composer-tuning.test.ts`.
- ☐ **`/`-skills context picker + skill-injection gone** — desktop's context-picker button + `ContextPickerMenu` (`ComposerCard.tsx:292-306`) and the `pendingInvocation→setText` skill-injection (`:213-225`) have no app-tauri equivalent. Only the `@`-mention picker was deferred; the placeholder even lost "/ for skills". **SCOPED, NOT DONE — needs an architecture decision (deferred to its own session/PR).** This is a feature, not a port: it needs (1) a skills API client in app-tauri (`GET /api/adapters/:adapterId/skills?projectPath=` — desktop `lib/api/skills-api.ts`), (2) a place to hold **project-scoped** skills state (desktop uses a Zustand `useSkillsStore` with `fetchSkills`/`pendingInvocation`; app-tauri deliberately avoids Zustand for chat — likely a `features/skills` provider/context at the project level), (3) the `/` picker UI (shadcn `Command`, per the composer CLAUDE.md `@`-mention decision), and (4) injection wiring (pendingInvocation → `composer().setText`). Couples with the skill-name-resolve item below (same registry).
- ☑ **In-message image click-to-zoom lost** — desktop opens a lightbox on user/assistant thumbs; app-tauri rendered inert `<img>`. **DONE (single-image zoom)** — new `parts/ZoomableImage.tsx` (shadcn `Dialog`, no new dep) restores click-to-zoom; wired into UserMessage `InlineImageThumbs` + AssistantMessage's `image` part. Tested in `parts/__tests__/ZoomableImage.test.tsx`. NOTE: the desktop **multi-image gallery nav** (prev/next) remains a separate keep-ours lightbox (inventory line 60) — not restored here; single-image zoom is the recovered affordance.
- ☑ **Plan "Reject" button removed** — desktop offers Reject (deny, no message) + Revise (deny + feedback) + Approve (`PlanApprovalCard.tsx:196-210`). **DONE** — added a third `chat-plan-reject` button (bare deny) alongside Approve & "Keep planning" (revise); `buildPlanResponse` gained a `{ kind: 'reject' }` → `{ behavior: 'deny' }` (no message). Tested in PlanGate.test.tsx + build-control-response.test.ts.

**⚪ Needs a live check**
- ☑ **Enter-to-send-while-running (queue)** — desktop intercepts Enter mid-run to enqueue (`ComposerCard.tsx:396-406`); app-tauri relied on native `ComposerPrimitive.Send`. **CONFIRMED GAP + FIXED.** Source check (`@assistant-ui/react@0.14.14` `ComposerInput.js`/`ExternalThread.js`): native Enter mid-run is `if (isRunning && !hasQueue) return;` where `hasQueue = !!queue` (the native `ExternalThreadQueueAdapter`). We pass **no** queue adapter (by design — daemon-backed queue, not the native local Queue), so `capabilities.queue=false` and Enter no-op'd mid-run; combined with our Send→Cancel swap, the keyboard path to enqueue was lost. **Fix:** `Composer.tsx` adds an `onKeyDown` that intercepts mid-run Enter and calls `aui.composer().send()` directly (its `canSend` ignores `isRunning`; with no queue adapter it routes through `onNew` → `controller.sendMessage` → daemon enqueues). Mirrors desktop. Tested in `composer/__tests__/Composer.test.tsx`.

**🟡 Minor / latent**
- ☑ AskUserQuestion **`header` title ignored** — app-tauri uses the raw question text + a static "Question" eyebrow (`gates/AskUserQuestionGate.tsx:144-145`); desktop titles with the model's `header` (`AskUserQuestionCard.tsx:75`). **DONE** — the gate now titles with `header ?? questions[0].header` (mirroring desktop's fallback) and drops the question text to a `chat-question-text` body line when a header is used.
- ☑ Markdown **link right-click context menu dropped** — desktop's `LinkWithPreview` had a Copy/Open context menu (`markdown-text.tsx:115-128,157`). **DONE** — added a shadcn `context-menu` primitive and wrapped the link (composed with the existing Tooltip via nested `asChild`) with Copy link / Open link items.
- ☐ **Skill id→display-name not resolved** — desktop runs `resolveSkillName` for the `/skill` chip (`UserMessage.tsx:64`); app-tauri renders `metaCmd.name` raw, so the chip may show a slug. **BLOCKED on the skills-registry infra above** — `resolveSkillName(name, skills)` (exported from `@qlan-ro/mainframe-core`) needs the project's `Skill[]` list, which app-tauri doesn't fetch yet. Do alongside the `/`-skills picker (same registry). The chip already renders a readable fallback (the raw name) in the meantime.
- ☑ **`data-mf-composer-input` hook lost** — desktop tags the input so quote/find key off it (`ComposerCard.tsx:387`); app-tauri's input carries only `data-testid`. **DONE** — re-added `data-mf-composer-input` to the `Composer.tsx` Input.
- ☑ **MessageRenderBoundary not ported (resilience)** — desktop scopes assistant-ui `tapClientLookup` "Index out of bounds" crashes to ONE message. **DONE (ported as insurance).** The specific 0.14.14 race wasn't reproduced in a quick check, but the boundary is cheap and the failure mode (one throw kills the thread) is severe, so ported anyway: new `messages/MessageRenderBoundary.tsx` + `messages/bounded-messages.tsx` (`boundedMessageComponents`), wired into BOTH `ThreadPrimitive.Messages` mount points (ChatThread main thread + TaskCard subagent transcript). Tested in `messages/__tests__/MessageRenderBoundary.test.tsx`.
- ☑ Read-more clamp tightened 6→4 lines (`messages/ReadMoreBubble.tsx`) — cosmetic. **REVIEWED — kept at 4.** The 4-line clamp is intentional for the warm-chrome user card (the fade overlay `bottom-6 h-8` is tuned to it); desktop's 6 was not adopted. No artboard mandates 6, so not reverted.

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
8. ☑ **composer shell** — native `ComposerPrimitive.*` (Root/Input/Send/Cancel/AddAttachment/AttachmentDropzone/Attachments) restyled + Send↔Cancel swap on `thread.isRunning` + `ThreadPrimitive.ViewportFooter` (scroll-inset fix). Native `AttachmentAdapter` + shadcn attachment UI (thumb/preview/remove) + upload-on-send. Daemon-backed **queued messages** (pending cards + in-composer edit mode), NOT native `Queue` (`a660d84d`, `2059d69d`, `71f0a8ac`). Hardened by the controller-seam review fixes (`f5be810b`, `4b70efe1`). Verified live. *Deferred sub-features: `@`-mention picker, WorktreePopover (gated: git/worktree API), captures control (gated: sandbox surface), composer-drafts, rejection-toaster.*
9. ☑ **composer config toolbar** — model · permission · plan · effort · features as stateless shadcn controls, live `isRunning` disable. **Server-authoritative, NO optimism** (judo-B `538d769d`): the controller owns the config (seeds from REST on load, mirrors every `chat.updated` into `state.chatConfig`); `useComposerTuning` reads it live and a control just PATCHes — kills the optimistic-vs-broadcast flicker (`dbf70ba9`, `4d9b14a1`, `f5be810b`). **NOTE:** config flows via **REST** (`PATCH /chats/:id/config` + `/tuning`), NOT `setRunConfig.custom` — the daemon exposes those routes (**CLAUDE.md drift corrected this session**). `@`-mention picker (native `Unstable_TriggerPopover`) + worktree/captures controls deferred (see #8).
10. ☑ **permission/ask/plan cards** — DONE. 3 inline shadcn gate cards (`PermissionGate`/`AskUserQuestionGate` Back/Next wizard/`PlanGate` w/ exec-mode+clear-context) under `features/chat/gates/`, dispatched by `toolName` from `ChatGateMount` at the **thread tail** (decision: inline, NOT above-composer), reading queue-front via `useChatPermissionFront` (sorts `extras.permissions` by `askedAt`) + `replyToPermission`. Permission dismisses on answer; ask/plan persist via tool-result display cards. Hybrid: native inline parts + our extras reply (native `approval` gate IS usable under external-store but bypassed by choice — data is out-of-band). Plan: `docs/plans/2026-06-05-interactive-chat-gate-cards.md`. *(gates session)*
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

### Composer → `features/chat/composer/`
> Decompose the 485-line desktop `ComposerCard` — don't carry it. **Correction (2026-06-05):** the config toolbar was NOT gated — the daemon already serves every endpoint (desktop proves it); "missing from app-tauri" = wiring, not a missing surface. Only genuine **surfaces** (sandbox preview) are gated.
- ☑ **shell core** — `ComposerPrimitive` Root/Input/Send/Cancel restyle + running-swap · `ThreadPrimitive.ViewportFooter` (scroll-inset fix) · draft · send via `controller.sendMessage`. *(`a660d84d`)*
- ☑ **config toolbar (FULL)** — model · permission · plan · effort · features. Data layer: `lib/api/{adapters,chats}` (`getAdapters`/`getChat`/`setChatTuning` `PATCH /tuning` for effort+features / `setChatConfig` `PATCH /config` for model+plan+permission) + ported `lib/model-tuning`. Controls: `EffortPicker`/`FeaturesPopover`/`ModelSelect`/`PermissionSelect`/`PlanModeToggle` + `ComposerToolbar`, driven by `useComposerTuning` (each control a pure fn of the selected model's capabilities). **Verified live** (write loop persists). *(`dbf70ba9` + model/plan/permission)*
- ☑ **queued messages** — pending cool-cards at the thread tail (`QueuedUserTurn`, dashed `--mf-um-dash`, hover Edit/Cancel) + composer **edit mode** (`ComposerEditMode`, amber header, Save/Cancel-edit) via `composer-edit-context`; `editQueuedMessage`/`cancelQueuedMessage` REST. *(pending a live queued-message check — transient state.)*
- ☑ **attachments** — native `AttachmentAdapter` registered + upload-on-send (`attachmentIds`); **native shadcn `attachment` component** (thumb + preview Dialog + remove, non-deprecated `useAuiState`) + `ComposerAddAttachment` (paperclip) + `AttachmentDropzone`. Vendored `avatar` + `tooltip-icon-button`. **Verified live** (add → tile). Rejection-toaster deferred.
- ☐ **sandbox captures in the user message** — DEFERRED (with new designs, 2026-06-05). NOT actually gated: captures ride in the message as a `\0__MF_SANDBOX_CAPTURE__` sentinel + a `> **Preview captures**` block (+ image attachments); port desktop's `parseSandboxCaptureBlock` to strip it + render the context row (screenshot tiles + CSS-path inspect chips). Today the raw sentinel **leaks** as `MF_SANDBOX_CAPTURE` text in the bubble. (The capture-*creation* webview surface is separately gated.)
- ☐ **WorktreePopover** — needs worktree integration (verify whether it's REST-wireable like config before assuming gated).
- ☐ **mention/highlight:** `@`-mention picker = **native `Unstable_TriggerPopover` + custom `Unstable_TriggerAdapter`** (DECIDED 2026-06-05; sync adapter over async daemon path-search) + `ComposerHighlight` overlay.
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
