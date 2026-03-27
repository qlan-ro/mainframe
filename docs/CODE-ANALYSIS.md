# Code Analysis Report

**Generated:** 2026-03-27
**Analyzed by:** 8 specialized Opus subagents

## Executive Summary

| Dimension | Critical | High | Medium | Low | Total |
|-----------|----------|------|--------|-----|-------|
| TypeScript | 1 | 8 | 8 | 5 | 22 |
| Node.js | 4 | 8 | 13 | 4 | 29 |
| React | 4 | 7 | 9 | 5 | 25 |
| UI/UX | 5 | 5 | 7 | 5 | 22 |
| Tailwind | 2 | 4 | 4 | 3 | 13 |
| Architecture | 2 | 5 | 7 | 4 | 18 |
| Clean Code | 5 | 14 | 12 | 6 | 37 |
| Tech Debt | 4 | 12 | 11 | 5 | 32 |
| **Total** | **27** | **63** | **71** | **37** | **198** |

## Top Priorities

1. **[critical]** `packages/mobile/components/**` — Zero accessibility labels across entire mobile app. Screen readers cannot identify any interactive element. *(flagged by: UI/UX)*
2. **[critical]** `packages/core/src/server/routes/path-utils.ts:7-8` — `realpathSync()` in `resolveAndValidatePath()` blocks event loop on every file API request. *(flagged by: Node.js, Architecture)*
3. **[critical]** `packages/core/src/workspace/worktree.ts:59-122` — `execFileSync` in `createWorktree()`, `removeWorktree()`, `isGitRepo()` blocks event loop during route handling. *(flagged by: Node.js, Architecture, Clean Code, Tech Debt)*
4. **[critical]** `packages/mobile/package.json:12` — Types dependency uses `^0.2.0` instead of `workspace:*`, risking type drift across monorepo. *(flagged by: Architecture, Tech Debt)*
5. **[critical]** `packages/core/src/chat/event-handler.ts:96-154` — `any` typed parameters in `SessionSink` callbacks bypass type checking on the most active data pipeline. *(flagged by: TypeScript)*
6. **[critical]** `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx:1-592` — 592-line file (2x limit) with no memoization on `filteredLogs`, massive SRP violation. *(flagged by: React, Clean Code, Architecture, Tech Debt)*
7. **[critical]** `packages/desktop/src/renderer/index.css` — `--color-mf-text-tertiary` never defined; 15 usages render with no color. *(flagged by: Tailwind)*
8. **[critical]** `packages/desktop/src/renderer/components/settings/SettingsModal.tsx:88` — Settings modal lacks `role="dialog"`, `aria-modal`, `aria-label`. *(flagged by: UI/UX)*
9. **[high]** `packages/desktop/src/renderer/hooks/useChatSession.ts:11` + 11 components — Full store destructure + unstable `find()` selectors cause cascading re-renders. *(flagged by: React)*
10. **[high]** `packages/mobile/store/chats.ts:8` — Mobile `pendingPermissions` still uses single `ControlRequest` per chat (same bug already fixed on desktop). *(flagged by: TypeScript, Tech Debt)*

## Cross-Cutting Themes

### 1. Sync I/O in Server Code
`realpathSync`, `execFileSync`, `existsSync`, `readFileSync` used in hot paths across `worktree.ts`, `path-utils.ts`, `session.ts`, `manager.ts`, `config.ts`. Blocks the event loop and violates project rules. **6+ files affected.**

### 2. Oversized Files
**16 files** exceed the 300-line limit. Worst offenders: `PreviewTab.tsx` (592), `history.ts` (495), `RemoteAccessSection.tsx` (452), `chat-manager.ts` (442), `ChatsPanel.tsx` (434).

### 3. Zustand Re-render Storms
Full store destructures and unstable `find()` selectors in 11+ components cause cascading re-renders on every store update. Desktop needs `useShallow` adoption.

### 4. Mobile Accessibility
Zero `accessibilityLabel`, `accessibilityRole`, or `accessibilityHint` across the entire mobile codebase. Screen readers cannot use the app.

### 5. Silent Error Swallowing
8+ instances of `.catch(() => {})` and empty `catch {}` blocks in core and mobile code, violating project rules.

### 6. Desktop/Mobile Code Duplication
Event routers, chat stores, and init hooks are structurally duplicated between desktop and mobile with no shared abstraction.

---

## Detailed Reports

### TypeScript

#### Critical
- **`packages/core/src/chat/event-handler.ts:96,104,115,133,154`** — Multiple `any` typed parameters in `SessionSink` callback implementations (`onMessage(content: any[])`, `onToolResult(content: any[])`, `onPermission(request: any)`). The `SessionSink` interface in `packages/types/src/adapter.ts` defines properly typed signatures (`MessageContent[]`, `ControlRequest`), but the implementation ignores them. **Fix:** Replace `any[]` with `MessageContent[]` and `any` with `ControlRequest` to match the `SessionSink` interface.

#### High
- **`packages/core/src/chat/external-session-service.ts:140`** — Type assertion `as DaemonEvent` on `sessions.external.count` event. The cast is unnecessary since the variant exists in the union. **Fix:** Remove the `as DaemonEvent` cast.

- **`packages/core/src/git/git-service.ts:170,200,221,235,291,325`** — Six `catch (err: any)` blocks disable type checking on error property access. **Fix:** Use `catch (err: unknown)` with type guards.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts:90,111`** — Unsafe `as ReadonlyJSONObject` casts on objects containing `undefined` values. **Fix:** Define a transformer that strips `undefined` values before casting.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/messages/UserMessage.tsx:61`** — `parseRawCommand()` returns `{ isCommand?: boolean }` but local type expects `{ isCommand: boolean }`. **Fix:** Accept optional or provide a default.

- **`packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:90`** — `slashMatch` typed as `RegExpMatchArray | null | false`, indexing `false` is implicit `any`. **Fix:** Use a ternary to keep type as `RegExpMatchArray | null`.

- **`packages/desktop/src/main/index.ts:101`** — Electron `MenuItem.role` comparison with wrong casing `'toggledevtools'` vs `'toggleDevTools'`. **Fix:** Use correct casing.

- **`packages/desktop/src/main/index.ts:105`** — `Menu.buildFromTemplate` receives `MenuItem[]` instead of `MenuItemConstructorOptions[]`. **Fix:** Map to constructor options.

- **`packages/core/tsconfig.json:5`** — `noUncheckedIndexedAccess: false` weakens the base config's strict setting in the most critical server package. **Fix:** Remove override and fix resulting type errors.

#### Medium
- **`packages/core/src/chat/chat-manager.ts:432`** — `existsSync` called on every `enrichChat()`, blocking event loop. **Fix:** Use async `access()` or cache results.

- **`packages/core/src/plugins/manager.ts:1,127-141`** — `readdirSync`, `existsSync`, `readFileSync` in `loadAll()`. **Fix:** Convert to `node:fs/promises` async equivalents.

- **`packages/core/src/chat/lifecycle-manager.ts:171-176`** — Uses `promisify(execFileCb)` instead of project's `execGit` helper. **Fix:** Use `execGit` for consistency.

- **`packages/core/src/chat/event-handler.ts:96-131`** — `buildSessionSink` is ~220 lines, exceeding limits. **Fix:** Extract `onMessage`, `onResult`, `onToolResult` into named helpers.

- **`packages/types/src/display.ts:38`** — `permission_request` has `request: unknown` instead of `ControlRequest`. **Fix:** Use the proper type.

- **`packages/core/src/server/routes/agents.ts:95`** — `req.query.projectPath || req.body?.projectPath` mixes sources without validation. **Fix:** Use Zod validation.

- **`packages/mobile/store/chats.ts:8`** — `pendingPermissions: Map<string, ControlRequest>` stores single permission per chat. Same bug already fixed on desktop. **Fix:** Change to `Map<string, ControlRequest[]>`.

- **`packages/core/src/auth/token.ts:36`** — `generatePairingCode()` uses `b % chars.length` with modulo bias. **Fix:** Use rejection sampling.

#### Low
- **`packages/types/src/settings.ts:13-15`** — Runtime value `GENERAL_DEFAULTS` exported from types-only package. **Fix:** Move to core.

- **`packages/core/src/plugins/config-context.ts:9`** — Mutable `string[]` for keys allows duplicates. **Fix:** Use `Set<string>`.

- **`packages/core/src/adapters/index.ts:35`** — `version || undefined` converts empty string to `undefined`. **Fix:** Use `??`.

- **`packages/desktop/src/renderer/lib/adapters.ts:62`** — `family` possibly `undefined` from regex capture, no null check. **Fix:** Add guard.

- **`packages/desktop/src/renderer/lib/api/http.ts:1-2`** — `import.meta.env` missing Vite client types. **Fix:** Add `/// <reference types="vite/client" />`.

---

### Node.js

#### Critical
- **`packages/core/src/server/routes/path-utils.ts:7-8`** — `realpathSync()` in `resolveAndValidatePath()`, called on every file API request, blocks the event loop. **Fix:** Replace with async `realpath` from `node:fs/promises`.

- **`packages/core/src/workspace/worktree.ts:78-82`** — `execFileSync` in `createWorktree()` called from route handlers. **Fix:** Use existing `execFileAsync`.

- **`packages/core/src/workspace/worktree.ts:109-121`** — `removeWorktree()` uses three sequential `execFileSync` calls. **Fix:** Convert to async `execFileAsync`.

- **`packages/core/src/workspace/worktree.ts:59`** — `isGitRepo()` uses `execFileSync`. **Fix:** Convert to async.

#### High
- **`packages/core/src/plugins/builtin/claude/session.ts:127`** — `accessSync(this.projectPath)` blocks event loop before spawning. **Fix:** Use `await access()`.

- **`packages/core/src/plugins/builtin/claude/session.ts:317-333`** — `getContextFiles()` uses `existsSync()` and `readFileSync()` in a loop (up to 6 files). **Fix:** Convert to async.

- **`packages/core/src/chat/chat-manager.ts:432`** — `existsSync(chat.worktreePath)` in `enrichChat()` called on every list/get request. **Fix:** Use async `stat` or cache.

- **`packages/core/src/chat/chat-manager.ts:270`** — `.catch(() => {})` on `doGenerateTitle()` silently swallows errors. **Fix:** Log with `logger.warn`.

- **`packages/core/src/plugins/builtin/claude/adapter.ts:86`** — `session.kill().catch(() => {})` silently swallows errors. **Fix:** Log with `log.warn`.

- **`packages/core/src/plugins/manager.ts:128-141`** — `loadAll()` uses `readdirSync`, `existsSync`, `readFileSync`. **Fix:** Convert to async.

- **`packages/core/src/index.ts:146-152`** — No `unhandledRejection` handler. Will crash daemon on Node 22+. **Fix:** Add `process.on('unhandledRejection', ...)`.

#### Medium
- **`packages/core/src/plugins/builtin/claude/history.ts:495`** — 495 lines, exceeds 300-line limit. **Fix:** Extract discovery and transform logic into separate modules.

- **`packages/core/src/chat/chat-manager.ts:442`** — 442 lines, exceeds limit. **Fix:** Extract `sendMessage` and helpers.

- **`packages/core/src/plugins/builtin/claude/session.ts:357`** — 357 lines, exceeds limit. **Fix:** Extract `getContextFiles()` and helpers.

- **`packages/core/src/launch/launch-manager.ts:336`** — 336 lines, exceeds limit. **Fix:** Extract `waitForPort` and env allowlist.

- **`packages/core/src/git/git-service.ts:336`** — 336 lines, exceeds limit. **Fix:** Split read/write operations.

- **`packages/core/src/chat/lifecycle-manager.ts:327`** — 327 lines, exceeds limit.

- **`packages/core/src/server/routes/files.ts:314`** — 314 lines, exceeds limit.

- **`packages/core/src/server/routes/search.ts:64`** — Reads entire file into memory as Buffer, converts to string, then splits. 3x memory for large files. **Fix:** Use `createReadStream` with `readline.createInterface`.

- **`packages/core/src/launch/launch-manager.ts:262-280`** — SIGKILL timeout never `unref()`'d, can keep process alive during shutdown. **Fix:** Add `timeout.unref()`.

- **`packages/core/src/server/websocket.ts:83`** — Async `ws.on('message')` handler — if `sendError` throws, it's an unhandled rejection. **Fix:** Ensure `sendError` never throws (currently guarded).

- **`packages/core/src/db/chats.ts:17-68`** — SELECT column list duplicated across 4 methods. **Fix:** Extract `SELECT_COLUMNS` constant and `mapRow()` helper.

- **`packages/core/src/chat/event-handler.ts:96-131`** — `buildSessionSink` ~220 lines. **Fix:** Extract into named helpers.

- **`packages/core/src/server/routes/agents.ts:95`** — Mixed query/body param without validation. **Fix:** Use Zod.

#### Low
- **`packages/core/src/server/routes/auth.ts:19-20`** — Module-level Maps won't work if clustered. **Fix:** Add comment.

- **`packages/core/src/tunnel/tunnel-manager.ts:192`** — Error swallowed in `verify()`, but `log.debug` does handle it. Acceptable.

- **`packages/core/src/config.ts:55`** — Silent catch on invalid JSON config. **Fix:** Add `logger.warn`.

- **`packages/core/src/index.ts:27`** — `execFileSync` in `enrichPath()` at startup with 5s timeout. **Fix:** Reduce to 2s or make async.

---

### React

#### Critical
- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx:261`** — `filteredLogs` recomputed every render without `useMemo`. `logsOutput` updates on every log line, triggering O(n) filtering. **Fix:** Wrap in `useMemo`.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx:1-592`** — 592 lines with webview lifecycle, drag resize, screenshots, inspect mode, log filtering all in one component. **Fix:** Extract `PreviewWebview`, `ConsolePanel`, `InspectMode`, `ProcessControls`.

- **`packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx:1-452`** — 452 lines with 5 co-located components. **Fix:** Extract each sub-component.

- **`packages/desktop/src/renderer/components/panels/ChatsPanel.tsx:1-434`** — 434 lines. **Fix:** Extract `NewSessionPopover` and `buildGroups`.

#### High
- **`packages/desktop/src/renderer/store/chats.ts:85-108`** — Every `addMessage`/`setMessages`/`updateMessage` creates `new Map(state.messages)`, causing all subscribers to re-render. **Fix:** Use `useShallow` or switch to plain object.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx:242`** + 11 files — `s.chats.find((c) => c.id === chatId)` returns unstable references. **Fix:** Add stable `getChatById` selector or use `useShallow`.

- **`packages/desktop/src/renderer/hooks/useChatSession.ts:11`** — Full store destructure causes re-render on ANY store change. **Fix:** Use individual selectors with `useShallow`.

- **`packages/desktop/src/renderer/hooks/useAppInit.ts:36-93`** — Sequential waterfall for independent fetches. **Fix:** Use `Promise.all` for `getAdapters`, `getProviderSettings`, `getPlugins`.

- **`packages/mobile/hooks/useAppInit.ts:18-33`** — Sequential waterfall. **Fix:** Parallelize with `Promise.all`.

- **`packages/mobile/components/chat/MarkdownText.tsx:5-146`** — Not memoized, re-renders on every parent render. **Fix:** Wrap in `React.memo`.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/parts/SyntaxHighlightedCode.tsx:76-81`** — Unnecessary `useEffect` + `useRef` for mounted tracking. **Fix:** Use `AbortController` or local `cancelled` flag.

#### Medium
- **`packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx:250-287`** — `threadListAdapter` depends on entire `chats` array, recreated on any chat update. **Fix:** Extract with granular selectors.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx:138`** — Selector returns full messages array when only a boolean is needed. **Fix:** Derive boolean in selector.

- **`packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:69`** — Full skills store destructure. **Fix:** Use individual selectors.

- **`packages/mobile/hooks/useConnectionState.ts:8`** — `setTimeout(callback, 0)` in subscribe is fragile. **Fix:** Call synchronously or rely on `useSyncExternalStore`.

- **`packages/mobile/app/sandbox.tsx:84-88`** — Auto-opens launch sheet every time process stops. **Fix:** Gate on initial load flag.

- **`packages/mobile/components/chat/MessageList.tsx:13`** — `useMemo(() => [...messages].reverse(), [messages])` runs on every message addition. Acceptable for `FlatList inverted` but verify necessity.

- **`packages/desktop/src/renderer/components/panels/FilesTab.tsx:44-48`** — 5 separate selectors from `useTabsStore`. **Fix:** Consolidate with `useShallow`.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx:104-137`** — Misleading `useMemo` dependency on stable setter. **Fix:** Use `[]`.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx:1-390`** — 390 lines. **Fix:** Extract `BranchSelect` and form sections.

#### Low
- **`packages/desktop/src/renderer/components/chat/assistant-ui/messages/AssistantMessage.tsx:21`** — Inline `() => null` creates new reference per render. **Fix:** Define outside component.

- **`packages/mobile/app/(tabs)/sessions/index.tsx:59-78`** — `filtered` computed without `useMemo`. **Fix:** Wrap in `useMemo`.

- **`packages/mobile/components/chat/Composer.tsx:63-68`** — `useCallback` depends on unstable `picker` object. **Fix:** Depend on `picker.selectItem`.

- **`packages/desktop/src/renderer/components/git/BranchPopover.tsx:1-364`** — 364 lines. **Fix:** Extract `RenameView`.

- **`packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:329`** — 329 lines, borderline. **Fix:** Extract `PickerItemRow`.

---

### UI/UX

#### Critical
- **`packages/mobile/components/**`** — Zero accessibility labels across the entire mobile codebase. No `accessibilityLabel`, `accessibilityRole`, or `accessibilityHint` on any interactive element. **Fix:** Add accessibility props to every `TouchableOpacity`, `Pressable`, and `TextInput`.

- **`packages/mobile/components/chat/ChatHeader.tsx:60-63`** — `MoreHorizontal` button has no `onPress` handler. Renders a visually interactive element that does nothing. **Fix:** Wire to an action sheet or remove until implemented.

- **`packages/desktop/src/renderer/components/chat/ImageLightbox.tsx:68-73`** — Lightbox `<img>` has no `alt` attribute. **Fix:** Add descriptive `alt` text.

- **`packages/desktop/src/renderer/components/SettingsModal.tsx:88`** — Settings modal lacks `aria-modal`, `role="dialog"`, `aria-label`. **Fix:** Add proper ARIA attributes.

- **`packages/desktop/src/renderer/components/DirectoryPickerModal.tsx:150-153`** — Directory picker modal lacks ARIA attributes and uses `bg-opacity-50` (v3 syntax). **Fix:** Add ARIA attributes and fix Tailwind syntax.

#### High
- **`packages/mobile/components/chat/Composer.tsx:248-249`** — Send button uses hardcoded `#f97312` instead of theme token. Disabled state `opacity: 0.4` is too subtle. **Fix:** Use `bg-mf-accent` and increase disabled opacity.

- **`packages/mobile/components/ProjectCard.tsx:46`** — Git branch hardcoded to `"main"` regardless of actual branch. **Fix:** Show actual branch or omit.

- **`packages/desktop/src/renderer/index.css:149`** — `user-select: none` on `body` with incomplete re-enable list. Cannot select text in tool cards, permission cards, error messages. **Fix:** Add `user-select: text` to content regions.

- **`packages/desktop/src/renderer/components/TitleBar.tsx:93-99`** — Search trigger `<div>` has no keyboard accessibility. **Fix:** Use `<button>` or add `role="button" tabIndex={0}`.

- **`packages/desktop/src/renderer/components/chat/PlanApprovalCard.tsx:159`** — `<select>` has `appearance-none` with no visible boundary, hard to identify as interactive. **Fix:** Add subtle background on hover.

#### Medium
- **`packages/mobile/components/ConnectionOverlay.tsx:17-73`** — All inline styles with hardcoded colors bypassing design system. **Fix:** Use NativeWind theme classes.

- **`packages/mobile/components/GlassPill.tsx:29,35-36`** — Hardcoded `backgroundColor: '#ffffff22'`. **Fix:** Use conditional theming.

- **`packages/mobile/components/chat/Composer.tsx:164-178`** — Image remove button is 20x20, below 44x44 minimum touch target. **Fix:** Add `hitSlop`.

- **`packages/desktop/src/renderer/components/TutorialOverlay.tsx:166-284`** — Entire overlay uses inline styles instead of Tailwind/tokens. **Fix:** Migrate to Tailwind classes.

- **`packages/mobile/app/welcome.tsx:97`** — `rounded-mf-input` (4px) too sharp for mobile inputs. **Fix:** Use `rounded-xl` or `rounded-lg`.

- **`packages/desktop/src/renderer/index.css:433-437`** — `input:focus-visible` has `outline: none`, removing focus ring. **Fix:** Add subtle ring style.

- **`packages/desktop/src/renderer/components/panels/ChatsPanel.tsx:266-345`** — 4 icon buttons with `gap-0.5` and `p-1` — too tight for trackpad/touch. **Fix:** Increase to `gap-1` and `p-1.5`.

#### Low
- **`packages/mobile/components/SessionRow.tsx:17-22`** — `ADAPTER_INITIALS` maps both `claude` and `codex` to `'C'`. **Fix:** Use `'Cl'` and `'Co'` or distinct icons.

- **`packages/desktop/src/renderer/components/StatusBar.tsx:66`** — Status bar git button is under 32px minimum desktop click target. **Fix:** Use `min-h-7`.

- **`packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx:20-22`** — `opacity-60` applies to entire element, not just background. **Fix:** Isolate if needed.

- **`packages/mobile/components/chat/tools/index.tsx:228`** — Bash output uses hardcoded checkmark detection for coloring. **Fix:** Use `done` boolean.

- **`packages/desktop/src/renderer/components/SearchPalette.tsx:239`** — `paddingTop: '20%'` positions dialog unpredictably on varying screen sizes. **Fix:** Use `pt-[15vh]`.

---

### Tailwind

#### Critical
- **`packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx:91,101,125,...` and `GeneralSection.tsx:67,79`** — `text-mf-text-tertiary` references `--color-mf-text-tertiary` which is never defined. 15 usages render with no color. **Fix:** Define the token in `@theme` block and `:root`, or replace with `text-mf-text-secondary opacity-60`.

- **`packages/desktop/src/renderer/components/ui/tooltip.tsx:24`** — Uses `animate-in`, `fade-in-0`, `zoom-in-95` etc. from `tailwindcss-animate`, which is not installed. Classes are dead code. **Fix:** Install `tw-animate-css` or replace with native CSS keyframes.

#### High
- **`packages/desktop/src/renderer/components/editor/LineCommentPopover.tsx:96`** — Uses `placeholder-mf-text-secondary/40` (v3 syntax). In Tailwind v4, correct syntax is `placeholder:text-mf-text-secondary/40`. **Fix:** Update syntax.

- **`packages/desktop/src/renderer/components/Toaster.tsx:10-12`** — Hardcoded hex arbitrary values (`bg-[#0a2e1a]`, `border-[#1a5c34]`, etc.) for toast backgrounds. **Fix:** Define semantic toast tokens.

- **`packages/desktop/src/renderer/components/git/ConflictView.tsx:15`** — Hardcoded `bg-[#7f1d1d]` for conflict warning. **Fix:** Use semantic token.

- **`packages/desktop/src/renderer/components/ui/tooltip.tsx:24`** — Uses `bg-[var(--mf-panel-bg)]` arbitrary syntax instead of `bg-mf-panel-bg` semantic tokens. **Fix:** Use semantic utility classes.

#### Medium
- **`packages/desktop/src/renderer/components/TutorialOverlay.tsx:167-284`** — Inline `style={}` with hardcoded hex colors instead of Tailwind classes. **Fix:** Migrate to Tailwind with `mf-*` tokens.

- **`packages/desktop/src/renderer/components/todos/TodoCard.tsx:7-21`** and **`FileTypeIcon.tsx:4-20`** — Default Tailwind palette colors (`bg-red-500/15`, `text-blue-400`) outside design system. **Fix:** Define semantic tokens or accept as intentional.

- **`packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx:99,249`** and **`WorktreePopover.tsx:233`** — Default palette `bg-blue-500`, `bg-green-500` for status dots. **Fix:** Use `bg-mf-info`, `bg-mf-success`.

- **Multiple files** — `w-X h-X` instead of v4 `size-X` shorthand. ~40 instances across 20+ files. **Fix:** Replace with `size-N`.

#### Low
- **`packages/desktop/src/renderer/components/chat/assistant-ui/parts/SyntaxHighlightedCode.tsx:109`** — Nested arbitrary selectors with `!important` overrides for third-party library. **Fix:** Move to CSS class in `index.css`.

- **`packages/desktop/src/renderer/index.css:169-175`** — `scrollbar-none` defined outside `@layer utilities`. **Fix:** Move to `@utility` block for v4.

- **`PreviewTab.tsx:399`, `StopPopover.tsx:70`, `LaunchPopover.tsx:103`, `TitleBar.tsx:150`** — `text-red-400`/`text-red-300` instead of `text-mf-destructive`. **Fix:** Use semantic token.

---

### Architecture

#### Critical
- **`packages/mobile/package.json:12`** — Mobile depends on `@qlan-ro/mainframe-types` with `"^0.2.0"` instead of `"workspace:*"`. Types package is at `0.4.0`. **Fix:** Change to `"workspace:*"`.

- **`packages/core/src/workspace/worktree.ts:57-83`** — `createWorktree()`, `isGitRepo()`, `removeWorktree()` use synchronous `execFileSync` in request-handling paths. **Fix:** Convert to async using already-imported `promisify(execFile)`.

#### High
- **`packages/core/src/chat/chat-manager.ts` (442 lines)** — God object with 25+ public methods and 8 dependencies. **Fix:** Extract into thin facade forwarding to sub-managers.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` (592 lines)** — Nearly double the limit. **Fix:** Extract injected JS to `preview-scripts.ts`, device presets to data file, toolbar to component.

- **`packages/core/src/plugins/builtin/claude/history.ts` (495 lines)** — Well above limit. **Fix:** Split into `history-parser.ts`, `diff-extractor.ts`, and orchestration.

- **16 additional files exceed 300-line limit** — Including `RemoteAccessSection.tsx` (452), `ChatsPanel.tsx` (434), `WorktreePopover.tsx` (390), `BranchPopover.tsx` (364), `session.ts` (357), `launch-manager.ts` (336), `git-service.ts` (336), `MainframeRuntimeProvider.tsx` (334), `ContextPickerMenu.tsx` (329), `lifecycle-manager.ts` (327), `MarkdownText.tsx` (325), `lsp-client.ts` (316), `files.ts` (314).

- **`packages/core/src/db/chats.ts:17-95,221-245`** — SELECT column list and row transformation duplicated 4 times. **Fix:** Extract `CHAT_SELECT_COLUMNS` constant and `mapRow()` method.

#### Medium
- **`packages/core/src/workspace/worktree.ts:114,117-122`** — Three empty `catch {}` blocks swallow git errors silently. **Fix:** Add `logger.warn` or explanatory comments.

- **`packages/core/src/chat/chat-manager.ts:270`** — Silent `.catch(() => {})` on title generation. **Fix:** Log with `logger.warn`.

- **`packages/mobile/lib/event-router.ts` and `packages/desktop/src/renderer/lib/ws-event-router.ts`** — Duplicated event routing logic. Mobile missing handlers for `context.updated`, `sessions.external.count`, `plugin.*`. **Fix:** Extract shared `BaseEventRouter` or factory into types package.

- **`packages/mobile/store/chats.ts` and `packages/desktop/src/renderer/store/chats.ts`** — Structurally identical Zustand stores with minor differences. **Fix:** Extract common store slice into shared module.

- **`packages/core/src/index.ts:5,27`** — `execFileSync` at startup blocks for up to 5 seconds. **Fix:** Convert to async.

- **`packages/types/src/plugin.ts:1`** — Types package has dev dependency on `pino` for `Logger` type. **Fix:** Define minimal `Logger` interface in types.

- **`packages/mobile/lib/event-router.ts:78,83,87,91`** — Raw `console.log`/`console.warn` instead of structured logger. **Fix:** Create `packages/mobile/lib/logger.ts`.

#### Low
- **`packages/mobile/lib/api.ts:2-3`** — Two separate imports from same module. **Fix:** Merge.

- **`packages/core/src/logger.ts:2`** — Sync I/O for log directory management at module load. **Fix:** Convert to async.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx:228,287`** and **`lsp-client.ts:292`** — Silent `.catch(() => {})` in renderer. **Fix:** Add `console.warn` with tag.

- **`packages/core/src/plugins/builtin/claude/session.ts:2`** — Imports `readFileSync` and `accessSync` in server module. **Fix:** Use async alternatives.

---

### Clean Code

#### Critical
- **`packages/core/src/plugins/builtin/claude/history.ts` (495 lines)** — 7+ functions with nearly identical JSONL file-reading boilerplate. **Fix:** Extract generic `scanJsonlFile(path, lineHandler)` helper. Split into `history-loader.ts` and `history-extractors.ts`.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` (592 lines)** — Massive SRP violation. **Fix:** Extract `PreviewWebview`, `ProcessToolbar`, `ConsoleOutput`, `InspectorOverlay`. Move `INSPECT_SCRIPT` to separate file.

- **`packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx` (452 lines)** — 5 self-contained components in one file. **Fix:** Extract each into `settings/remote-access/`.

- **`packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` (434 lines)** — Mixes persistence, data transformation, popover, and panel. **Fix:** Move `buildGroups` to utility, `NewSessionPopover` to own file, persistence to `useCollapsedState` hook.

- **`packages/core/src/chat/chat-manager.ts:179-280`** — `sendMessage` is 101 lines, 2x the limit. **Fix:** Extract `routeCommand()`, `processAndSendMessage()`, `handleFirstMessage()`.

#### High
- **`packages/core/src/plugins/builtin/claude/session.ts:107-173`** — `spawn()` is 67 lines. **Fix:** Extract `buildSpawnArgs()` and `wireChildEvents()`.

- **`packages/core/src/plugins/builtin/claude/session.ts:253-309`** — `respondToPermission()` is 57 lines. **Fix:** Extract `buildPermissionPayload()`.

- **`packages/core/src/plugins/builtin/claude/session.ts:312-341`** — `getContextFiles()` uses sync I/O. **Fix:** Convert to async.

- **`packages/core/src/plugins/manager.ts:125-135`** — `loadAll()` uses `readdirSync`. **Fix:** Replace with async.

- **`packages/core/src/workspace/worktree.ts:57-64`** — `isGitRepo()` uses `execFileSync`. **Fix:** Convert to async.

- **`packages/core/src/workspace/worktree.ts:66-83`** — `createWorktree()` uses `mkdirSync` and `execFileSync`. **Fix:** Convert to async.

- **`packages/core/src/workspace/worktree.ts:107-123`** — `removeWorktree()` uses sync I/O plus two empty `catch {}`. **Fix:** Convert to async, add logging.

- **`packages/core/src/config.ts:47-61`** — `getConfig()` uses sync I/O. **Fix:** Provide async variant for route handlers.

- **`packages/core/src/git/git-service.ts`** — 6 `catch (err: any)` blocks. **Fix:** Use `catch (err: unknown)` with type narrowing.

- **Duplicated `fuzzyMatch`** — Identical in `packages/core/src/server/routes/files.ts:80` and `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:28`. **Fix:** Extract to shared utility.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx` (390 lines)** — **Fix:** Extract `BranchSelect` and `useWorktreeActions` hook.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx` (377 lines)** — Contains inline SVG, hook, and 3 sub-components. **Fix:** Extract each.

- **`packages/desktop/src/renderer/components/git/BranchPopover.tsx` (364 lines)** — **Fix:** Decompose before adding features.

#### Medium
- **`packages/core/src/chat/chat-manager.ts:270`** — Silent `.catch(() => {})`. **Fix:** Add logging.

- **`packages/core/src/plugins/builtin/claude/adapter.ts:86`** — Silent `.catch(() => {})`. **Fix:** Add logging.

- **`packages/mobile/hooks/useContextPicker.ts:50-52`** — Three consecutive silent catches. **Fix:** Log warnings.

- **`packages/mobile/hooks/useChatSession.ts:68,70`** — Silent catches on `addMention()`. **Fix:** Log.

- **`packages/desktop/src/renderer/lib/lsp/lsp-client.ts:292`** — Silent `.catch(() => {})`. **Fix:** Log.

- **`packages/core/src/plugins/builtin/claude/session.ts` (357 lines)** — Slightly over limit. **Fix:** Extract utilities.

- **`packages/core/src/launch/launch-manager.ts:98-234`** — `start()` is 137 lines (3x limit). **Fix:** Extract `waitForSpawn()`, `handleExit()`, `startTunnelIfNeeded()`.

- **`packages/core/src/chat/event-handler.ts:66-291`** — `buildSessionSink()` is 225 lines. **Fix:** Extract each callback into named functions.

- **`packages/core/src/plugins/builtin/todos/index.ts:130-181`** — Repetitive field-setting logic (8 `if` blocks). **Fix:** Use field mapping array.

- **`packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:329`** — 87-line JSX render method. **Fix:** Extract `PickerItemRow`.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx:140-239`** — `onNew` callback ~100 lines. **Fix:** Extract helpers.

- **`packages/core/src/chat/lifecycle-manager.ts:230-286`** — `doLoadChat()` is 57 lines with mixed responsibilities. **Fix:** Extract mention-scanning and plan/skill extraction.

#### Low
- **`packages/core/src/plugins/builtin/claude/history.ts:370`** — Typo: "JONL" should be "JSONL".

- **`packages/core/src/plugins/builtin/claude/events.ts:113-122`** — Duplicated skill-path extraction logic. **Fix:** Extract helper.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`** — 5 `eslint-disable` for `any` on webview ref. **Fix:** Define `ElectronWebview` interface.

- **`packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:261`** — 168-character `data-testid` expression. **Fix:** Extract to helper.

- **`packages/mobile/components/chat/MarkdownText.tsx` (325 lines)** — Most of file is style object. **Fix:** Extract `mdStyles` to `markdown-styles.ts`.

- **`packages/core/src/chat/lifecycle-manager.ts:7-8`** — Import and variable split across non-adjacent lines. **Fix:** Group together.

---

### Tech Debt

#### Critical
- **`packages/mobile/package.json:13`** — `@qlan-ro/mainframe-types: "^0.2.0"` instead of `workspace:*`. Types package is at `0.4.0`. **Fix:** Change to `"workspace:*"`.

- **`packages/core/src/workspace/worktree.ts:109-122`** — `execFileSync` with two silent `catch {}` blocks. **Fix:** Convert to async, add logging.

- **`packages/core/src/chat/chat-manager.ts:270`** — `.catch(() => {})` on title generation. **Fix:** Add logging.

- **`packages/core/src/plugins/builtin/claude/adapter.ts:86`** — `.catch(() => {})` on session kill. **Fix:** Add logging.

#### High
- **`packages/core/src/plugins/builtin/claude/history.ts` (495 lines)** — Exceeds limit by 65%. **Fix:** Split into parser, extractor, and orchestrator.

- **`packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` (592 lines)** — Nearly double the limit. **Fix:** Extract sub-components.

- **`packages/core/src/chat/chat-manager.ts` (442 lines)** — Exceeds limit. **Fix:** Further decompose.

- **`packages/core/src/plugins/builtin/claude/session.ts` (357 lines)** — Over limit, uses sync I/O. **Fix:** Split and convert to async.

- **`packages/core/src/git/git-service.ts:170,200,221,235,291,325`** — Six `catch (err: any)` patterns. **Fix:** Define typed `GitError` interface.

- **`packages/core/src/server/routes/git-write.ts:45,59`** — Two more `catch (err: any)`. **Fix:** Same typed error approach.

- **`packages/core/src/config.ts:4`** — All file ops use sync APIs. **Fix:** Keep sync for startup, convert `saveConfig` to async.

- **`packages/core/src/plugins/manager.ts:127-141`** — `loadAll()` uses sync I/O. **Fix:** Convert to async.

- **`packages/core/src/lsp/lsp-connection.ts:184-207`** — Monkey-patches `ws.send` with `(ws as any).send`. **Fix:** Use proper wrapper/proxy pattern.

- **16 files exceed 300-line limit** — Led by `PreviewTab.tsx` (592), `history.ts` (495). **Fix:** Decompose. Priority: core files first.

- **`packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx` (452), `ChatsPanel.tsx` (434), `WorktreePopover.tsx` (390), `BranchPopover.tsx` (364), `MainframeRuntimeProvider.tsx` (334), `ContextPickerMenu.tsx` (329), `lifecycle-manager.ts` (327), `launch-manager.ts` (336), `files.ts` (314), `lsp-client.ts` (316), `MarkdownText.tsx` (325)`** — All over limit.

#### Medium
- **`packages/core/src/messages/message-parsing.ts:3`** — TODO: parsing logic is Claude-specific, belongs under `adapters/claude/`. **Fix:** Move with re-export for backward compat.

- **`packages/core/src/messages/message-parsing.ts:7`** — `IMAGE_COORDINATE_NOTE_RE` has TODO "remove this". Dead regex still exported. **Fix:** Remove.

- **`packages/core/src/plugins/builtin/claude/skills.ts:7`** — TODO to rename to `claude-tools.ts`. **Fix:** Rename.

- **`packages/core/src/plugins/builtin/claude/events.ts:81` and `history.ts:93`** — `TODO(task-support)` for unimplemented task-notification rendering. **Fix:** Track as feature task.

- **`packages/mobile/store/chats.ts:8`** — `pendingPermissions` still uses single `ControlRequest` per chat (bug already fixed on desktop). **Fix:** Align with queue-based pattern.

- **`packages/mobile/hooks/useContextPicker.ts:50-52`** — Three silent `.catch(() => {})`. **Fix:** Add logging.

- **`packages/mobile/components/ConnectionOverlay.tsx:106`** — Silent `.catch(() => {})` on connect. **Fix:** Log.

- **`packages/mobile/hooks/useChatSession.ts:68,70`** — Two silent catches on mention-adding. **Fix:** Log.

- **`packages/core/src/index.ts:27`** — `execFileSync` at startup with 5s timeout. **Fix:** Document or reduce timeout.

- **`packages/mobile/store/sandbox.ts:59` and `packages/mobile/lib/event-router.ts:78,83,87,91`** — Raw `console.log`/`console.warn` in production mobile code. **Fix:** Replace with structured logger.

- **`packages/core/src/logger.ts:2`** — Sync I/O for log directory management at module load. **Fix:** Convert to async.

#### Low
- **`packages/core/src/plugins/builtin/claude/skills.ts:7`** — Stale TODO about file rename.

- **`packages/core/src/__tests__/message-loading.test.ts:533`** — `TODO(task-support)` in test. **Fix:** Track with feature.

- **`packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerHighlight.tsx:14`** — Empty `catch {}` in UI. **Fix:** Add comment or logging.

- **`packages/mobile/package.json:39`** — Mobile uses Tailwind v3 (`^3.4.19`), desktop uses v4 (`^4.2.2`). **Fix:** Evaluate upgrade when nativewind supports v4.

- **`packages/core/src/config.ts:55`** — Empty catch on JSON parse. **Fix:** Add `logger.warn`.
