# Performance Audit — packages/ui + packages/app-tauri

**Generated:** 2026-07-08 (wave 1 + wave 2)
**Scope:** the merged app-tauri UI (`packages/ui/src` — all features, lib, store, components, app, layout) and the Tauri Rust shell (`packages/app-tauri/src-tauri/src`), audited on the post-merge tree.
**Method:** the `code-audit` performance lens (9-family generator checklist + architectural generators), two waves:
- **Wave 1** — 5 parallel Opus agents partitioned by surface (chat · sessions/stores · secondary features · infrastructure · Rust shell); grep-driven enumeration, hot-path weighted; per-family counts + clean-coverage claims.
- **Wave 2** — 3 Opus agents targeting wave 1's structural blind spots: an adversarial re-audit of every wave-1 "clean" verdict, a line-level deep read of the ~90 chat files wave 1 only grep-touched, and end-to-end traces of five user flows across the directory seams no partitioned agent could see.
- Orchestrator re-verified the highest-stakes claims in source (assistant-ui's repository publish path, the reload-storm trigger, the boot env capture, virtuoso/React.lazy presence).

**Convergence:** wave 2 produced ~30 new findings including 3 HIGHs and refuted 4 of wave 1's 9 clean verdicts — the audit was NOT dry after one wave. Remaining known gaps after wave 2: GPU/compositing costs (backdrop-blur layers, shadows, animations — no wave audited paint), and the live-profiling completeness check (golden interactions against production-scale data), which no static pass replaces.

---

## Executive Summary

- **A production-reproduced critical (2026-07-08): pasting ~100k lines into the composer freezes the app.** Every input event runs three O(text) passes on the main thread — the controlled-input round trip, `TextareaAutosize`'s hidden-clone layout of the full value, and the highlight overlay's full-text reparse + second DOM mirror layout. Fix: paste-to-attachment above a threshold + degrade highlight/autosize on large text (Priority 1b).
- **The most expensive defect is architectural: the chat pipeline has no delta seam (A1).** Whole messages from the daemon → whole-state reducer → a freshly rebuilt `ExportedMessageRepository` per streamed delta, which assistant-ui answers with `clear()` + full re-import + re-normalization of every part of every message. Chat streaming is **O(N²) per turn**. Verified in assistant-ui's installed source.
- **A second seam multiplies it (A2):** `extras` bundles the whole mutable state + fresh callbacks behind one slot, so **every** tool card, message, and composer control re-renders per streamed delta.
- **Wave 2 found the unit work being multiplied:** an **O(L²) diff-gutter algorithm** in the default-open Edit cards (~90k iterations per delta for a 300-line diff), an unmemoized Myers diff re-run per delta while an Edit streams, collapsed MCP cards `JSON.stringify`-ing full payloads per render, whole-result regex scans per render in five card types, user messages re-parsing their markdown per delta, and the Task card re-importing its entire nested subagent transcript per delta. A1/A2 set the frequency; these set the cost per tick. Both need fixing.
- **The bundle has no lazy seam:** zero `React.lazy` in the package (violating the repo's own rule). CodeMirror + language packs + MergeView, xterm + CSS, and the viewer graph all load at boot; `store/intent-subscriber.ts` imports the viewer graph at module load for one pure function.
- **Windowing exists but isn't adopted:** `react-virtuoso` shipped with the sessions sidebar; the run console, 10k-entry file tree, review tree, CSV viewer, task lists, and the chat thread still render unbounded collections in full.
- **Event-driven refetch storms during runs:** every `chat.updated` triggers a full `GET /chats` resync of all sessions (≤5×/sec behind a 200 ms debounce); every `context.updated` fans out to ~5 REST calls (duplicate `useSessionContext` instances + an undebounced ChangesPanel) — both for the entire duration of every active run.
- **Cold boot has three independent removable chunks:** the Rust shell blocks 1–5 s on login-shell env capture *before the window exists*; the first `/health` probe polls at the 2 s steady-state cadence (up to ~1.8 s dead time); and the last-session transcript fetch is serialized behind the full session-list load although its target is known from localStorage at launch.
- **The Rust shell has real ones beyond boot:** no backpressure anywhere in the PTY→webview pipeline; the preview capture converts a ~59 MB retina image **on the macOS main thread** (visible freeze per capture) and then ships the PNG as a JSON number array (4–6× inflation); a blocking HTTP POST on the main thread in presence.
- **A hitchhiker classic:** dragging the surface divider serializes **all** session workspaces + synchronous `localStorage.setItem` at pointer-move rate (~100×/sec).
- **What's genuinely healthy** (confirmed by both waves, including adversarial re-audit): the xterm write path (zero React per chunk, bounded scrollback), settings, features/daemon, the send-message path (optimistic paint, batched uploads, no waterfalls), the session-switch visible path (warm-state paint), lib/api's own batching, Rust lock/borrow discipline, and all the previously-merged sidebar fixes.

### Findings by area (both waves, deduplicated)

| Area | Critical | High | Medium | Low |
|------|:--------:|:----:|:------:|:---:|
| Chat (streaming pipeline + cards + composer paste) | 3 | 3 | 5 | 4 |
| Sessions / stores / layout persist | 0 | 2 | 4 | 3 |
| Secondary features (editor/viewers/run/files/workflows/git) | 0 | 2 | 7 | 6 |
| Context panel / preview JS | 0 | 1 | 3 | 1 |
| Infrastructure (ws/api/primitives/boot) | 0 | 0 | 4 | 6 |
| Tauri Rust shell | 0 | 2 | 4 | 4 |
| **Total** | **3** | **10** | **27** | **24** |

Architectural (`arch`) roots: 10 — each ranks above the point findings it spawns.

---

## Priority 1 — Chat streaming rebuilds the world per delta (critical, arch)

**A1 — No delta seam in `controller → projection → assistant-ui`.**
`features/chat/controller/project-messages.ts:124` rebuilds `ExportedMessageRepository.fromArray(...)` inside `useMemo(..., [state])` (`runtime/use-chat-thread-runtime.ts:116`); state changes on every `display.message.updated`. Verified in `@assistant-ui/core/dist/runtimes/external-store/external-store-thread-runtime-core.js:100-106`: a new repository reference short-circuits only on identity equality, otherwise `clear()` + `import()`; `fromArray` re-runs `fromThreadMessageLike` over every part of every message first. ~3 full-history passes per delta × dozens of deltas/sec = **O(N²) per streaming turn**. The WeakMap convertMessage cache trims one pass only.
**Fix:** switch to the external-store `messages` + `convertMessage` adapter path (aui then applies per-message caching and incremental `addOrUpdateMessage`), or hold one stable repository and mutate the changed message. Absorbs: the gap-triggered full refresh (`controller/handle-daemon-event.ts:31`), the reattach full re-seed (S1 below), and most of the unwindowed-thread per-delta cost.

**A2 — `extras` is one broad snapshot slot (high, arch).**
`runtime/use-chat-thread-runtime.ts:118` builds `extras` on `[controller, port, state]` → new identity + fresh callbacks every delta; every `useChatExtras`/`useChatId` consumer (all tool cards, `UserMessage`, `Composer`, tuning, gates, skills, queued turns) re-renders per delta, defeating the reducer's own `sameComposerConfig` dedup.
**Fix:** narrow memoized slices (`chatConfig`, `permissions`, `queued`, stable callback bag) + field-level selectors with equality bail-outs.

**The unit work A1/A2 multiply (wave 2 — fix these too; they stay hot even after the seams):**
- **[high] `tools/shared/diff.tsx:169-170`** — per-line gutter numbers via `countOldLines`/`countNewLines` rescanning from index 0 inside the line `.map` → **O(L²) per hunk render**; Edit cards are default-open, so this runs per delta (300-line diff ≈ 90k iterations/delta/card). Fix: one forward pass with running counters.
- **[high/med] `tools/cards/EditFileCard.tsx:155-207` + `WriteFileCard.tsx:115-119`** — `computeFallbackHunks` (Myers diff via `structuredPatch`), `countDiffStats`, `resolveResultText` all unmemoized per render; during a streaming Edit the diff re-runs on the growing strings every delta. Fix: `useMemo` on `(oldString,newString,result)`; skip the fallback diff until the result settles.
- **[med] `tools/cards/MCPToolCard.tsx:64-65`** — `JSON.stringify(args, null, 2)` + full result stringify run unconditionally per render on collapsed cards. Move inside the `open` branch.
- **[med] `tools/shared/result.ts:86-126` + Bash/Read/Search/Edit/Write cards** — `stripErrorXml` global-regex over the entire result per render; `SearchCard.tsx:74`/`ReadFileCard.tsx:67` re-split whole results per render for a header count. Memoize by `result` identity.
- **[med] `messages/UserMessage.tsx:154,212,221-224`** — every user turn re-parses its full markdown per delta (raw `react-markdown`, unlike the memoized assistant path) + `parsePlanUserMessage` unmemoized; the extras subscription is only needed for the rare retry path. Narrow the selector; memoize on `cleanText`.
- **[med] `tools/cards/TaskCard.tsx:105-113,162-166`** — the nested subagent transcript re-imports (`fromArray` in `map-assistant-blocks.ts:174`) and re-renders wholesale per delta while a subagent streams; unwindowed (a nested instance of the unbounded-thread problem). Stabilize the projected `messages` reference; window the transcript.
- **[low] `tools/tool-dispatch.tsx:20-23`** — no `React.memo` boundary on tool cards (pays off once A1 lands).

## Priority 1b — Large paste freezes the app: three O(text) passes per input event (critical, **reproduced in production 2026-07-08**)

A ~100k-line paste into the composer froze the app (webview main thread saturated; the Rust host stayed healthy — the 5-min memory sampler never skipped a beat, no crash, no error logs — the signature of a renderer main-thread freeze; a frozen renderer also cannot log, which is why the logs are clean).

**Mechanism — every input event (the paste itself and every subsequent keystroke) runs three independent O(text) operations synchronously:**
1. **Controlled-input round trip** — assistant-ui's `ComposerInput.tsx:354` does `aui.composer().setText(e.target.value)` per change → store update → React re-render of the composer subtree carrying the multi-MB string.
2. **`TextareaAutosize`** — `ComposerPrimitive.Input` resolves to `react-textarea-autosize` (`ComposerInput.tsx:419`; our `Composer.tsx:141` does not use `asChild`, so it is active). It computes height by laying out the full value in a hidden sibling textarea — a full multi-MB text layout per change, despite `max-h-48` showing only ~8 lines.
3. **The highlight overlay** — `composer/highlight/ComposerHighlight.tsx:26-34` subscribes to `s.composer.text`, re-runs `mainframeUserFormatter.parse` (full-string regex `matchAll` with lookbehind, `messages/user-directives.ts:42-89`) and replaces the text of a `whitespace-pre-wrap` div mirroring the **entire** composer content — a second full multi-MB layout per keystroke. The overlay is load-bearing: the textarea is `text-transparent` (`Composer.tsx:150`), so the overlay is the only visible text — it cannot simply be removed.

At 100k lines each event costs seconds; input events queue faster than they drain → sustained freeze. Family 1 + 5 — and a lens lesson now encoded: **user-pastable input is unbounded input** (wave 1 saw mechanism 3 and misfiled it as LOW, "bounded by user-controlled composer length").

**Fix shape (layered):**
- **Paste-to-attachment (best UX, the industry pattern):** intercept paste above a threshold (~10k chars / 200 lines) and convert it into a file attachment chip ("pasted.txt") instead of inline text — the attachment adapter infrastructure already exists (`composer/attachment-adapter.ts`). Keeps the composer permanently small.
- **Threshold degrade as the backstop:** above N chars, skip `renderHighlights` (render the raw string, toggle the textarea's `text-transparent` off so text stays visible) and replace autosize with a fixed-rows textarea, restoring O(1) keystrokes even when large text does land inline.
- Memoizing the parse alone does NOT fix this — the two layout passes (autosize clone + overlay mirror) dominate.

## Priority 2 — No lazy seam: everything ships and initializes at boot (high, arch)

Zero `React.lazy` in `packages/ui/src` (verified). `editor/cm-setup.ts` (CodeMirror + 16 language imports + legacy modes + MergeView), `terminal/terminal-cache.ts` (xterm + CSS), `viewers/viewer-router.tsx` (all viewers) sit in the main bundle; `store/intent-subscriber.ts:25` imports the viewer graph at module load solely for the pure `pickViewerKind`; no `manualChunks` in `vite.config.ts`.
**Fix:** `React.lazy` boundaries at the surface/tab host (editor, terminal, diff, viewers); extract `pickViewerKind`; dynamic-`import()` grammars inside `resolveLanguage` (swap via the existing `lang` Compartment, `CmEditor.tsx:216`). Largest time-to-interactive win available.

## Priority 3 — Windowing exists but is unadopted (high, arch)

`react-virtuoso` is a dependency (sessions sidebar) but nothing else uses it:
- **Run console (hottest):** `run/ConsolePane.tsx:142-144` — whole-store `logsOutput` subscription + unmemoized 500-entry `selectLogs` filter per render + unwindowed `LogLines`; every PTY chunk re-renders every mounted console. Plus the **write path** (wave 2): `store/sandbox.ts:95-98` copies the whole ≤500-entry buffer per output line. Root: one flat log array above its consumers — partition by `scopeKey|name` (arch) + batch appends per rAF.
- **File tree:** `files/FileTree.tsx:177-191,278` — full recursive render of expanded dirs (10k+ entries) + `[...entries].sort()` inside render per open dir.
- **Review file tree:** `review/ReviewFileTree.tsx:64-96` — hundreds of files × 5-span meters, unwindowed.
- **CSV viewer:** `viewers/CsvViewer.tsx:156-174` — tens of thousands of `<td>`s; filter re-scans all rows per keystroke, undebounced.
- **Chat thread:** `thread/ChatThread.tsx:87` — all N messages mounted (compounded by A1; nested case in TaskCard above).

## Priority 4 — Event-driven refetch storms during runs (high, arch)

- **`chat.updated` → full session-list resync:** `sessions/ws/use-session-list-router.ts:85-98` + `runtime/chats-remote-adapter.ts:64-67` — full `GET /chats`, re-map of all N sessions, fresh `threadItems` identity into aui, ≤5×/sec behind the 200 ms debounce, for every active run. Compounds with `buildAttentionMap` O(projects×sessions) per reload (`sidebar/SessionSidebar.tsx:124-127`). Fix: gate reload to list-visible field changes; single-pass the attention map; long-term a per-chat delta into the thread list (blocked by aui 0.14.14's missing mutate-one-thread API — revisit on upgrade).
- **`context.updated` → ~5 REST calls per event (wave 2):** duplicate `useSessionContext()`/`useSidebarSkills()` instances (`context-panel/BottomPanel.tsx:16-17` + `ContextInspector.tsx:16`/`SkillsList.tsx:6`/`AgentsList.tsx:6`) → 2× `GET /context` + 2× skills/agents per switch; `ChangesPanel.tsx:127-131` refetches `getGitStatus`+`getBranchDiffs`+`getSessionFiles` per event with **no debounce**. Fires repeatedly while an agent edits files. Fix: one provider owning context/skills; debounce ChangesPanel; seam: `chatId`-filtered `onEventOfType` (extends the ws-client finding).
- **Full-refetch-instead-of-delta elsewhere:** todos (`tasks/use-todos-store.ts:83-99` — every drag refetches all), workflow steps (`workflows/use-workflows-events.ts:14-33` — full run-tree refetch per step event; `patchRun` already exists for run updates, extend to steps), workflows list N+1 (`use-workflows-store.ts:44-46` — one `listRuns` HTTP call per workflow, unbounded fan-out).

## Priority 5 — Cold boot: three removable chunks (high combined)

Stack additively on every launch:
1. **[med-high, Rust] Shell-env capture blocks before the window exists** — `lib.rs:78`: `resolve_shell_env_with_timeout()` (1–5 s) runs before `tauri::Builder`, so bundle parse/React mount/health polling can't even start. Its only consumer is `boot_daemon` inside `.setup()`. Fix: capture concurrently, join at daemon boot.
2. **[med] First `/health` probe at steady-state cadence** — `app/useConnectionState.ts:18,75-120`: initial readiness and liveness share `POLL_INTERVAL_MS=2000`; a missed first probe costs up to ~1.8 s behind the `ready` gate that blocks all REST loads. Fix: fast initial backoff (150→300→…→2000 ms).
3. **[med] Boot history waterfall (wave 2, cross-boundary)** — the last-session id is in localStorage at launch, but its transcript fetch waits for `GET /chats` → pick → switch → `controller.load()`. Fix: on `ready`, warm `chatControllerRegistry.getOrCreate(lastSessionId, port).load()` in parallel with `adapter.list()` — the switch then paints from a warm controller. (Also `port()`/`status()` IPC serialized at `useConnectionState.ts:108-109` — `Promise.all`, trivial.)

## Priority 6 — Rust shell (high/medium)

- **[high, arch] PTY→webview has no backpressure** — `terminal/reader.rs:26-33` + `terminal/mod.rs:236-241`: eager drain into `Channel.send` with no flow control; a fast producer grows the IPC queue unbounded and kernel PTY backpressure never reaches the child. Fix: bounded channel the reader blocks on + coalesce 8 KB reads into larger batches (`reader.rs:24`).
- **[high] Preview capture converts the image on the macOS main thread (wave 2)** — `preview/capture_macos.rs:89-158`: the `takeSnapshot` completion block (main thread) does `TIFFRepresentation()` re-encode → bitmap decode → per-pixel RGBA loop (~59 MB for a retina window) — a visible UI freeze per capture. Fix: raw-copy `bitmapData()` in the block; reshape/crop/encode on the Tokio worker; memcpy fast-path for unpadded rows.
- **[med-high] `preview_capture` returns `Vec<u8>` → PNG as a JSON number array (wave 2)** — `preview/mod.rs:313-317`: 4–6× payload inflation + giant JSON parse per capture. The correct idiom already exists in-tree (`InvokeResponseBody::Raw`, `terminal/mod.rs:238`). Fix: `tauri::ipc::Response::new(bytes)`.
- **[med] `report_activity` blocks the main thread** — `presence.rs:63-76,122-128`: sync command → blocking `ureq` POST (≤~1 s if the daemon wedges) + a fresh `Agent` (new pool/TCP connect) per call (both call sites). Fix: enqueue onto the reporter thread; one `OnceLock<Agent>`.
- **[med] Sync fs in async commands** — `commands/fs.rs:59-86`: `std::fs::read*` + full-buffer base64 park Tokio workers (the comment claims otherwise). Fix: `tokio::fs`/`spawn_blocking`.
- **[low-med] Log bridge** — `log_sink.rs:197-217`: per-line sync IPC + `data.to_string()` paid even for level-filtered lines. Batch; serialize only above threshold.
- **[low] Preview `tabs` map does not self-evict on child-webview death** outside `preview_destroy`/window-destroy (`preview/mod.rs:190-198,293-301`); bridge JS rebuilds the inspect-highlight div per mousemove (`bridge.rs:50-59`).

## Priority 7 — Hitchhikers & per-interaction storms (medium-high)

- **[med-high] Divider drag persists ALL session workspaces per pointermove (wave 2)** — `layout/SurfDivider.tsx:35-40` → `store/layout.ts:190-196` → `layout-persist.ts:34-43`: zustand `persist` partialize serializes every session's panes/tabs + sync `localStorage.setItem`, ~100×/sec during a drag, plus a `new Map(sessions)` clone per move. Fix: transient non-persisted frac during drag, commit on pointerup. Same pattern smaller: `PanelResizeHandle.tsx:26-28` (ui-prefs write per move).
- **[med] Preview occlusion observes the whole document (wave 2)** — `preview/use-preview-occlusion.ts:60-69`: body-wide MutationObserver (childList+subtree) + capture-phase scroll → rAF `querySelectorAll`(doc, 5 selectors) + `getBoundingClientRect` per frame while chat streams under a mounted preview. Fix: observe portal roots only; cache the anchor rect.
- **[med] Session-switch reattach re-downloads the full transcript (wave 2)** — `chat-ws-subscription.ts:133`: `isReattach()` always re-seeds (GET /messages + GET /chat + resume + pending) behind `subscribe:ack`, even when nothing streamed while dormant. Background-only (warm state paints first), but it's bandwidth + a renorm storm per switch. Fix: cursor/delta fetch (A1's seam); until then skip the re-seed when no gap was detected.
- **[med] Attachments grid O(N²) refetch (wave 2)** — `context-panel/SessionAttachmentsGrid.tsx:22-29`: effect deps include `loaded`; in-flight items re-fetch per resolution — N base64 payloads fetched up to N times. Fix: requested-ids ref or one mount effect per chat.

## Priority 8 — Infrastructure & remaining mediums

- **[med, arch] ws-client broadcasts every event to every handler** — `lib/daemon/ws-client.ts:78`: ~10 persistent subscribers each run a `switch` per frame including per-token deltas. Fix: `onEventOfType` dispatch map (client-side only). Root of several feature-side costs (context-panel, sandbox router).
- **[med] `TruncatedWithTooltip` per-mount weight** — `components/ui/truncated-with-tooltip.tsx:44-52` + `use-is-truncated.ts:20`: ResizeObserver + TooltipProvider + Radix root per row label. Fix: root provider + observer-on-hover. Lighter twin: `hint.tsx` (36 sites).
- **[med] Sessions row unread subscription** — `sidebar/SessionRow.tsx:176`: whole-Set subscription; select a per-row boolean (blast radius currently capped by the virtualization window).
- **[med] `use-chat-skills` over-fetch + waterfall (wave 2)** — `use-chat-skills.tsx:72-84`: fetches the entire projects list to resolve one path (available from `useActiveIdentity`, as the sibling hook proves), then serial `getSkills`/`getAgents`. Fix: drop the hop; `Promise.all`.
- **[low-med] git Branch popover (wave 2)** — `BranchGroupSection.tsx:69` unmemoized `groupBranches` per render; no `memo` children (voiding BranchList's own `useMemo`s); undebounced search. Popover-scoped.
- **[low-med] `session-todos.byChat` grow-only (wave 2)** — `store/session-todos.ts:38`: no per-chat eviction; reconnect re-emits per resumed chat → O(N²) burst. Prune on archive/close.
- **Low (grouped):** editor per-keystroke `doc.toString()`+onChange chain (`CmEditor.tsx:143`); composer highlight full reparse per keystroke; file-open prefetch gap + redundant viewer-gate frame (`intent-subscriber.ts:69` → `EditorTab.tsx:130,232`); terminal first-open `cachedHomedir()` IPC on the critical path + xterm-build/PTY-spawn strictly serial (`terminal-intent-subscriber.ts:38`, `create-terminal.ts:22-32`); drag-layer double reflow per pointermove (`SurfaceDragLayer.tsx:32-77`); `store/adapters.ts:19` fresh-array selector; ws-client unbounded `pendingMessages` + linear `filePathMap` scan per file event; git-status over-fetch to count (`use-changes-count.ts:18`); `TaskListView` unmemoized derivations; O(N) session `find` per switch (`use-session-list-router.ts:70,125`); `bytesToDataUrl` per-byte concat (cold).

---

## Wave-2 verdicts on wave-1 "clean" claims

| Claim | Verdict |
|---|---|
| Terminal JS chunk path (no React per chunk, bounded scrollback) | **CONFIRMED** (verified twice, incl. installed xterm source) |
| `features/settings/` | **CONFIRMED** (gated fetches, Promise.all, no polling) |
| `features/daemon/` | **CONFIRMED** (shared snapshot via `useSyncExternalStore`, deliberate no-polling design) |
| Send-message path | **CONFIRMED LEAN** (optimistic paint, batched uploads, inherent-only serialization) |
| Rust lock/borrow discipline (preview) | **CONFIRMED** — but the work *inside* the blocks was the miss (N1/N4) |
| `features/git/` "fully memoizes" | **PARTIALLY REFUTED** (unmemoized `groupBranches`, no memo children, undebounced search) |
| `lib/api` "no waterfalls" | **PARTIALLY REFUTED at composite callers** (`use-chat-skills`, workflows N+1) |
| Store write paths "delta-proportional" | **REFUTED** (sandbox append copy-per-line, layout persist per pointermove, session-todos grow-only) |
| `features/preview/` JS | **REFUTED** (document-wide MutationObserver per frame) |
| `features/context-panel/` (unaudited in wave 1) | **REFUTED** (duplicate context/skills fetchers, O(N²) attachments) |

## What's Working Well (survived adversarial re-audit — preserve)

xterm write path & terminal cache; settings; features/daemon; send-message flow; session-switch visible path (warm-state paint, derived-`isActive` fan-out control); `lib/api` module-level batching; shiki lazy singleton; Rust preview lock/borrow + capture-borrow discipline; presence background thread cadence; store caps where present (`recent-directories`, editor `CACHE_CAP`, unread prune); all previously-merged sidebar fixes (virtuoso, memo rows, archived split, stable projections).

## Known open items (prior audits, unchanged)

`chat-controller-registry` grow-only (dispose never called); daemon-side `emitDisplay`/`enrichChat` costs (`packages/core`, out of scope here).

## Recommended fix order

0. **Paste freeze (Priority 1b)** — the only finding with a confirmed production incident; small, self-contained fix (paste-to-attachment + threshold degrade).
1. **A1 delta seam** (critical; absorbs 4 other findings) + the wave-2 card unit-work batch (O(L²) diff first — trivial and huge).
2. **Lazy seam** (Priority 2) + cold-boot cluster (Priority 5) — the perceived-startup package.
3. **A2 extras slicing** + windowing adoption (Priority 3, run console first).
4. **Refetch storms** (Priority 4: reload gating, context provider dedup, ChangesPanel debounce).
5. **Rust batch**: capture off-main-thread + Raw response (one PR), PTY backpressure, presence enqueue.
6. The medium/low tail opportunistically, `[arch]` seams before their point findings.

---

*Diagnostic only — no source files modified. Wave sub-reports with per-family counts live in the session transcripts. The remaining validation step no static pass replaces: profile the golden interactions (boot, send/stream, switch, pill filter, terminal under load, capture) against production-scale data and reconcile — anything hot that no finding covers is a missing generator to add to the lens.*
