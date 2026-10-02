# Compact transcript mode implementation plan

**Goal:** Add the approved global Compact transcript option while preserving Verbose rendering and selectors.

**Architecture:** Keep assistant-ui's message, part and readonly-thread contexts. Build compact rows from ordered native parts, render their details through the existing card registry, and keep disclosure choices in an app-session store keyed by conversation identity. Pure label, status and diff calculations stay in bundleable view-model/shared modules.

**Tech stack:** React, TypeScript, Zustand, Radix, pinned `@assistant-ui/react@0.15.13`, Vitest and the existing browser/E2E tooling.

**Spec:** [Approved spec](../specs/2026-10-02-todo-371-compact-transcript.md), commit `d6a85bdb80e631b78c122b295f3a3da0507835d3`. The [research](../research/2026-09-29-compact-transcript-mode.md) supplies API facts; the approved spec overrides its older product recommendations.

Execution stays in `todo/371-compact-transcript`. The parent owns review, implementation dispatch and live QA. No second review loop or human checkpoint is part of this plan.

## Constraints

- Desktop UI only. No mobile, daemon API, protocol, dependency-version or persisted-conversation changes.
- PR #742 and PR #743 are open dependencies, not prerequisites. Do not merge, cherry-pick or stack on either. Base sessions lack their signals.
- Never stamp a tool start at mount, borrow a message timestamp, infer a reasoning duration from a turn, or infer status/creation/counts from result prose.
- Keep existing Verbose IDs, grouping, card actions, error treatment and default disclosure behavior. Compact gets separate IDs.
- Every changed/new file stays at most 300 lines and every changed/new function at most 50 lines. Split focused components and test tables before growing files. Existing large test files need new focused siblings, not added blocks.
- Each group owns its implementation and tests. Use focused failing tests, implement, rerun the affected tests, then typecheck and lint the changed code. Preserve other workers' edits.
- Implementation adds the required UI changeset with the group that exposes the feature. The stage-only plan commit has no changeset.

## Established facts

Paths below are relative to the repository. Native paths are relative to the installed package resolved from `packages/ui/node_modules`; they are read-only references.

| Source and stable symbol                                                                                                                                                                                          | Consequence                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/ui/src/features/chat/messages/AssistantMessage.tsx`, `AssistantMessage`; `tools/group-parts.ts`, `makeChatGroupBy`                                                                                      | Current Verbose uses native `GroupedParts`, daemon explore groups and `ReasoningGroup`. Move this branch intact to `VerboseParts` before adding the preference branch.                                                               |
| Installed `@assistant-ui/core/src/react/primitives/message/MessageGroupedParts.tsx`, `MessagePrimitiveGroupedParts`; `MessageParts.tsx`, `MessagePrimitivePartByIndex`                                            | Group nodes expose ordered `indices`; indexed rendering needs `components`, including `tools.Override`. Keep part contexts rather than manually spreading raw parts into cards.                                                      |
| Installed `@assistant-ui/core/src/utils/normalizePartStatus.ts`, `toMessagePartStatus`                                                                                                                            | A tool with any result becomes native complete; a tool without a result inherits message status. Neither alone proves per-call success, especially partial output or empty completion.                                               |
| `packages/ui/src/features/chat/view-model/convert-acp-item.ts`, `toolPart`; `tool-call-result.ts`, `toolCallResult`; `acp-item-accumulator.ts`, `AcpItemAccumulator`                                              | ACP already carries item status and deduplicates by item ID. Projection currently drops status except `isError`; empty content becomes `undefined`. Preserve lifecycle in the UI projection without changing wire types.             |
| `packages/types/src/acp/tool-call.ts`, `ToolCallStatusSchema`; `packages/types/src/adapter.ts`, `ControlRequest`; `packages/ui/src/features/chat/runtime/chat-extras.ts`, `useChatExtras`                         | Existing statuses and `request.toolUseId` are the source for lifecycle and pending-permission correlation. Gates remain in `ChatGateMount`. Do not manufacture declined/cancelled distinctions the provider did not supply.          |
| `packages/ui/src/features/chat/tools/tool-dispatch.tsx`, `MessageToolLeaf`; `registry.ts`, `resolveToolCard`; `register-cards.ts`, `TOOL_REGISTRY` population                                                     | One exact-name registry owns cards. `mcp__` is the established namespace rule. Plan/question/workflow tools can bypass compact disclosure using their exact registry names.                                                          |
| `packages/ui/src/features/chat/tools/cards/EditFileCard.tsx`, `useEditCardState`; `WriteFileCard.tsx`, `WriteFileCard`; `tools/shared/diff.tsx`, `countDiffStats`, `computeFallbackHunks`                         | Edit prefers structured hunks, then old/new-string fallback; Write counts structured hunks only. Extract this canonical calculation. Write content alone does not establish net additions or creation.                               |
| `packages/ui/src/features/chat/tools/cards/TaskCard.tsx`, `SubagentTranscript`, `TaskCard`; `messages/nested-transcript-context.tsx`, `NestedTranscriptProvider`                                                  | Task currently adds its own collapsed gate around `ReadonlyThreadProvider`. Compact must reveal the nested transcript directly and reset any outer forced-detail context before rendering children.                                  |
| `packages/ui/src/features/chat/tools/shared/card-shell.tsx`, `CollapsibleCardShell`; `cards/BashCard.tsx`, `BashCard`; `cards/marker-pill.tsx`, `useMarkerOpen`; `cards/FallbackToolCard.tsx`, `FallbackToolCard` | Native card bodies use several disclosure owners. A small context consumed by those owners can open details in compact expansion while leaving their Verbose defaults unchanged.                                                     |
| Installed `@assistant-ui/react/src/hooks/useToolCallElapsed.ts`, `useToolCallElapsed`; core `src/types/message.ts`, `ToolCallTiming`                                                                              | Timing is optional `{startedAt, completedAt?}` in epoch milliseconds. The hook ticks only itself, but uses native inferred tool status and clamps negative intervals. Compact needs validation and explicit lifecycle-aware ticking. |
| `packages/ui/src/features/chat/messages/ReasoningGroup.tsx`, `useReasoningDuration`                                                                                                                               | Existing clock measures a whole-message running window. Keep it in Verbose; compact reasoning must not call it. Base has no reliable reasoning-phase timing.                                                                         |
| `packages/ui/src/store/ui-prefs.ts`, `useUiPrefs`, `partializeUiPrefs`; `features/settings/panes/general/AppearanceControls.tsx`, `PickerRow`                                                                     | Store is version 6, key `mf:ui-prefs`. Add version 7 and sanitize same-version hydration as well as migration. Picker is the existing settings pattern.                                                                              |
| `packages/ui/src/features/chat/thread/ChatThread.tsx`, `ChatThread`; `use-thread-bottom-pin.ts`, `useThreadBottomPin`; installed React `src/primitives/reasoning/useScrollLock.ts`, `useScrollLock`               | Viewport is a size-query container; a separate ResizeObserver also pins to bottom. Native scroll lock alone cannot coordinate that observer or restore a changed row offset.                                                         |
| `packages/ui/src/features/side-chat/side-chat-scope.tsx`, `useSideAwareThreadId`; `tools/chat-tool-context.ts`, `useChatId`                                                                                       | Side chats need their own root scope. Nested readonly threads replace native extras, so inherit the root chat ID explicitly for existing full-output actions.                                                                        |
| `packages/ui/src/features/chat/find/search-messages.ts`, `searchMessages`                                                                                                                                         | Search reads `[data-text-part]`, not arbitrary card text. Compact bodies and labels must not add that attribute.                                                                                                                     |
| `.agents/test-worktree.md`, browser target; `packages/e2e/tests-tauri/tool-cards.spec.ts`, existing card scenarios                                                                                                | Reuse the prepared isolated browser session for UI QA and existing provider-boundary recordings for supported runtime cases. Do not change old verbose selectors to make tests pass.                                                 |

## Task graph

| ID  | Kind | Deliverable                                                                       | Depends on | Parallel safe                               |
| --- | ---- | --------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| G1  | core | Trustworthy projected lifecycle and shared diff calculations                      | none       | Yes, with G3                                |
| G2  | core | Conservative labels and ordered compact row model                                 | G1         | Yes, with G3                                |
| G3  | ui   | Validated global preference and Appearance picker                                 | none       | Yes, with G1/G2                             |
| G4  | ui   | Compact renderer, durable disclosure, local timers and scroll-safe native details | G1, G2, G3 | No; owns shared transcript/card integration |

No independent test-only group is needed. Parent can review G1/G2/G3 independently, then G4 as the complete feature.

## G1: Preserve lifecycle and extract canonical diff data

Own modifications:

- `packages/ui/src/features/chat/view-model/convert-acp-item.ts`
- `packages/ui/src/features/chat/view-model/tool-call-result.ts`
- `packages/ui/src/features/chat/view-model/__tests__/convert-acp-item-tool-results.test.ts`
- `packages/ui/src/features/chat/tools/shared/diff.tsx`
- `packages/ui/src/features/chat/tools/cards/EditFileCard.tsx`
- `packages/ui/src/features/chat/tools/cards/WriteFileCard.tsx`

Create:

- `packages/ui/src/features/chat/view-model/tool-call-lifecycle.ts`
- `packages/ui/src/features/chat/tools/shared/diff-data.ts`
- `packages/ui/src/features/chat/view-model/__tests__/tool-call-lifecycle.test.ts`
- `packages/ui/src/features/chat/view-model/__tests__/convert-acp-item-lifecycle.test.ts`
- `packages/ui/src/features/chat/tools/shared/__tests__/diff-data.test.ts`

Interface: `projectToolLifecycle(status)` returns optional JSON-safe `{acpStatus}` for `part.providerMetadata.mainframe`. It carries only existing ACP status, preserving other provider metadata. `resolveToolDiff(kind, args, result)` returns `{hunks, stats}` with nullable hunks/stats for `Edit` or `Write`; stats is `{added, removed}`. `countDiffStats` and `computeFallbackHunks` move into this pure module and remain re-exported from `diff.tsx` for existing callers.

- [ ] Add projection tests for pending/in-progress with and without partial output, successful empty output, failed empty output, missing terminal signal, duplicate updates, replay and nested calls. Assert the original order and IDs survive.
- [ ] Carry explicit ACP lifecycle in the existing native provider metadata field. For explicit `completed` or `failed` with genuinely empty content, project result `''` so native details also stop spinning; failure still carries `isError` and never becomes success. Leave unresolved/cancelled no-output calls undefined. This overlaps PR #743's planned terminal normalization and deliberately uses the same semantics, without importing that PR. Adjust the existing failed-empty expectation, and do not add timing here.
- [ ] Extract the exact Edit hunk precedence and Write structured-only count behavior. Validate optional/malformed arguments and result hunks at this boundary; invalid counts are unavailable, never zero by default. Keep known empty hunks as valid zero counts. Both cards and compact summaries call this one helper.
- [ ] Preserve card rendering and open-diff content, including `originalFile`/`modifiedFile`. Add cases for structured +3/-1, fallback edit, empty strings, malformed hunks and Write without a patch. Re-run existing Edit/Write and conversion suites without changing their selectors or unrelated expectations.

Verification: projected completed-empty calls have an explicit terminal fact and native result; unresolved calls do not. Shared helper numbers agree with the detailed cards. No Rust or shared wire schema diff is present.

## G2: Build the pure row model and command labels

Create under `packages/ui/src/features/chat/view-model/compact/`:

- `types.ts`, `tool-status.ts`, `tool-kind.ts`, `file-summary.ts`
- `command-actions.ts`, `shell-command.ts`, `command-label.ts`
- `tool-label.ts`, `build-compact-rows.ts`
- `__tests__/tool-status.test.ts`, `__tests__/file-summary.test.ts`
- `__tests__/command-actions.test.ts`, `__tests__/command-label.test.ts`
- `__tests__/build-compact-rows.test.ts`, `__tests__/fixtures.ts`

Interface: `buildCompactRows(indexedParts, pendingToolIds)` consumes ordered `{index, part}` native enriched parts plus the current root conversation's pending tool IDs. It returns discriminated `tool`, `reasoning` and `passthrough` rows. Every row retains original part indices. Tool rows also retain ordered `toolCallIds`, kind, status, full label and optional complete diff totals; single rows may retain vetted timing. No row owns a clock or persistent identity based on its array index.

- [ ] Define a small explicit tool-name table: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `LS`, `WebSearch`, `WebFetch`, `Bash`, `Task`. Keep Glob and Grep distinct if their summaries describe different operations. Recognize MCP only by the existing namespace convention. Unknown and marker tools remain individually expandable. `ExitPlanMode`, `AskUserQuestion`, `Workflow`, `RunWorkflow` are passthrough full cards.
- [ ] Resolve awaiting approval first from the actual pending ID or native unresolved approval. Then respect explicit rejection/cancellation and projected lifecycle/error facts, followed by native incomplete status. Success requires explicit completed lifecycle or a genuine terminal result with no conflicting active lifecycle/error. A settled message alone does not turn missing output into success. Preserve an unknown/settled label when the available facts cannot distinguish outcomes.
- [ ] Use one verb table for active/success/failed/stopped/declined states. Keep row text muted at every status. A recognized test/lint/build command gets an outcome phrase only with explicit success. Changing output text alone must never alter classification or status.
- [ ] Read optional `part.providerMetadata.codex.commandActions` defensively. Accept a complete supported action list only when its semantics form one faithful label; unknown, malformed or mixed actions fall back as a whole. `reportedDurationMs` is optional provider data, not a start time; never derive a live clock from it. A finite nonnegative reported duration may describe a terminal single call when no valid interval exists.
- [ ] Tokenize a bounded set of simple commands without executing a shell. Unwrap supported `sh/bash/zsh -c/-lc`, environment assignments, `env` options and `sudo` options only when the complete wrapper parses. Reject ambiguous separators, pipes, substitution, control flow and heredocs to description/raw fallback. Classify known read/search/list tools, package-manager lint/typecheck/test/format/build/install scripts and common Git verbs. Preserve quoted paths and program basenames; unknown options fail closed.
- [ ] Structured action, recognized command, provider description, then safe single-line raw command is the label order. Strip control characters for display, render as text, and keep full sanitized labels for tooltips. Unknown active calls use a useful description or `Running <program>`/`Running command`. Shell calls never merge.
- [ ] Merge only adjacent successful calls of the same allowlisted kind with meaningful summaries. Blank text can be skipped; reasoning, prose, images, passthrough cards, another kind and all nonsuccess states terminate the run. Never cross messages. Missing information that prevents a meaningful merged label keeps calls separate.
- [ ] Count distinct known paths, show a useful common directory, omit root-only directories, and retain repeated-operation counts on a single file. Normalize separators for comparisons without inventing filesystem resolution. Sum per-operation diff stats, including repeated edits; one unavailable member suppresses the aggregate. Use `Wrote` unless explicit structured creation information exists. Never sum durations.
- [ ] Add table-driven tests for every spec boundary, repeated paths, unknown paths, different roots, malformed JSON-shaped values, huge labels, +3/-1 plus +5/-2 giving +8/-3, mixed actions, wrappers and output-word invariance. Test deterministic indices and stable membership after streaming regrouping.

Verification: all model tests run without React or wall-clock timers. Metadata-present tests use explicit component/model input; they do not claim base transport emits that data.

## G3: Persist and expose the preference

Own modifications:

- `packages/ui/src/store/ui-prefs.ts`
- `packages/ui/src/features/settings/panes/general/AppearanceControls.tsx`

Create:

- `packages/ui/src/store/__tests__/ui-prefs-transcript.test.ts`
- `packages/ui/src/features/settings/panes/general/__tests__/AppearanceControls.test.tsx`

Interface: export `TranscriptMode = 'verbose' | 'compact'`; add `transcriptMode`, `setTranscriptMode` and persistence to `useUiPrefs`. Keep key `mf:ui-prefs`, bump version to 7. G4 selects this field at the message rendering boundary.

- [ ] Cover clean storage, v6 records, older migration records, invalid strings/null/objects and invalid values in a v7 payload. Sanitize during persist merge as well as migration because Zustand skips migration at the current version. Preserve unrelated widths, sections, dialog sizes and warnings.
- [ ] Add a `Transcript` PickerRow with `Verbose` and `Compact`. Give the group an accessible name and preserve ToggleGroup's announced selection. IDs are `settings-appearance-transcript-verbose` and `settings-appearance-transcript-compact`; empty selection does not clear the preference.
- [ ] Test keyboard selection, immediate store updates and rehydration into a fresh module. Re-run existing migration and General pane tests to catch unrelated preference loss.

Verification: old installs still select Verbose; Compact survives rehydrate/restart and unrelated fields remain intact.

## G4: Integrate compact rendering and its interactions

Own modifications:

- `packages/ui/src/features/chat/messages/AssistantMessage.tsx`
- `packages/ui/src/features/chat/thread/ChatThread.tsx`
- `packages/ui/src/features/chat/thread/use-thread-bottom-pin.ts`
- `packages/ui/src/features/chat/tools/chat-tool-context.ts`
- `packages/ui/src/features/chat/tools/shared/card-shell.tsx`
- `packages/ui/src/features/chat/tools/cards/BashCard.tsx`
- `packages/ui/src/features/chat/tools/cards/FallbackToolCard.tsx`
- `packages/ui/src/features/chat/tools/cards/MCPToolCard.tsx`
- `packages/ui/src/features/chat/tools/cards/marker-pill.tsx`
- `packages/ui/src/features/chat/tools/cards/TaskCard.tsx`

Create under `packages/ui/src/features/chat/`:

- `messages/VerboseParts.tsx`
- `messages/compact/CompactParts.tsx`, `CompactRows.tsx`, `CompactToolRow.tsx`, `CompactReasoningRow.tsx`
- `messages/compact/CompactToolDetails.tsx`, `CompactElapsed.tsx`, `compact-timing.ts`
- `messages/compact/transcript-scope.tsx`, `disclosure-store.ts`, `use-compact-disclosure.ts`
- `messages/compact/use-compact-scroll-anchor.ts`
- `tools/shared/compact-detail-context.tsx`, `tools/cards/SubagentTranscript.tsx`
- `thread/ChatThreadViewport.tsx`, `thread/ChatThreadIndicators.tsx`, `thread/transcript-scroll-context.tsx`
- `messages/compact/__tests__/CompactParts.test.tsx`, `CompactToolRow.test.tsx`, `CompactReasoningRow.test.tsx`
- `messages/compact/__tests__/CompactElapsed.test.tsx`, `compact-timing.test.ts`, `disclosure-store.test.ts`
- `messages/compact/__tests__/CompactDetails.test.tsx`, `CompactTranscript.integration.test.tsx`, `fixtures.tsx`
- `thread/__tests__/compact-scroll-anchor.test.tsx`

Also create `packages/e2e/tests-tauri/compact-transcript.spec.ts` and `.changeset/compact-transcript-mode.md` with a UI minor entry. Keep each test file under 300 lines; split scenario fixtures by responsibility within the listed compact test directory if needed.

Interfaces: `TranscriptScopeProvider` carries stable root thread identity, root chat ID, ancestor call path and root permission data through readonly runtimes. `useCompactDisclosure(memberKeys)` exposes any-open state and writes one choice to all members. `CompactElapsed` accepts validated supplied timing plus resolved active state and display format. `CompactParts`/`CompactRows` and typed fixture factories are importable for run-local component QA without a product route.

- [ ] Move the existing `GroupedParts` branch to `VerboseParts` without changing output or IDs. `AssistantMessage` selects the preference but retains its error branch, message root, context menu and footer. Both nested and top-level messages select the same store field. New parts still use the native indicator policy.
- [ ] Group compact activity with stable `groupBy`: tool calls and whitespace form candidate activity blocks, reasoning forms separate blocks, and text/images/pinned cards remain leaves. Within each block, select `s.message.parts` through `useAuiState`, retain the group's original indices and call G2's model. This is the same part-state collection the installed `GroupedParts` consumes. Render passthrough leaves through existing native part dispatch. Never render the native group children as well as indexed rows.
- [ ] Render each expanded tool index with `MessagePrimitive.PartByIndex` and a stable `components.tools.Override` that resolves the existing registry. A compact-detail context opens shell/card/fallback/marker bodies on mount, including available failed MCP details. It is absent in Verbose. Preserve file links, image thumbnails, open-diff and full-output actions; sibling action clicks must not toggle the compact row.
- [ ] Extract `SubagentTranscript` from TaskCard. The compact Task override renders it directly, with the existing readonly thread and bounded message components, bypassing TaskCard's second disclosure. Verbose TaskCard still uses its current trigger. Supply a nested identity provider in both paths and reset forced-detail context before descendant messages. Empty agents still have their named outer row and explicit status.
- [ ] Mount root scope above message content using `useSideAwareThreadId`, not main-thread identity. Carry root chat ID from extras for nested ToolResultExpand requests; use inherited ID only when nested extras are absent. Namespace each disclosure key as a collision-safe tuple of root thread, ancestor call IDs, message ID and tool call ID. Reasoning uses message identity plus its first original part position, never the regrouped row ordinal. Store this Map outside components, without localStorage or cleanup on unmount. Navigation, remount, mode changes and streaming preserve it; merged state is any-open and toggle writes every member. Do not transfer choices across chats/agents or erase still-replayable calls.
- [ ] Use Radix disclosure controls with an accessible name, visible focus, `aria-expanded` and domain-keyed `chat-compact-toggle-{encoded identity}` IDs. Keep the full label available by hover and keyboard focus. Errors use a tinted icon plus accessible failure text, while row text stays muted. All decorative spinners respect reduced motion. Timer text is not a live region and cannot alter the button's name every second.
- [ ] Validate supplied timestamps as finite nonnegative milliseconds; reject invalid/future starts and completion before start. Individual terminal intervals retain their supplied completion duration; valid subsecond intervals render `0:00`. Missing/invalid intervals render no number. Never add durations for merged rows. Prefer native interval over an optional validated terminal reported duration.
- [ ] Keep ticking inside `CompactElapsed` only, with a one-second interval and cleanup on completion/unmount. Native `useToolCallElapsed` cannot accept corrected lifecycle or reject malformed intervals, so the thin compact timer takes validated data and explicit active state. It never stamps starts. Fake-timer tests and a render counter must prove the text advances and freezes without rerendering `CompactParts`, rebuilding rows or changing disclosure state. Remount/reconnect fixtures keep the original supplied times.
- [ ] Compact reasoning uses `Thinking`/`Thought` and expands available text. Its presentation accepts optional `phaseTiming: {startedAt: number; completedAt?: number}` and `running` props for fixture coverage; the actual base runtime supplies none. Do not read `useReasoningDuration`, message timing or tool timing as reasoning timing. Test active supplied phase ticking and completed `Thought for Ns`, plus untimed replay with no number. A reasoning row always splits tool runs.
- [ ] Extract the thread viewport and indicator components as needed to keep the touched ChatThread function/file within limits. Provide the existing viewport ref and an explicit brief interaction lock to `useThreadBottomPin`. Disclosure calls native `useScrollLock` on the non-scrolling outer row before mutation, then measures/restores the row's offset in a layout effect. Suppress/cancel the separate bottom-pin observer during this adjustment; preserve whether it was following before the action and resume normal future bottom following afterward. Clamp restoration to legal scroll range. Avoid competing smooth/height animations during anchoring.
- [ ] Bound expanded details with `max-height: min(24rem, 50cqh)` under the actual transcript viewport size container, `overflow-y:auto`, `min-width:0` and contained overscroll. Nested content inherits the root viewport cap and anchors within its nearest scrolling disclosure area. Compact owns this new bounded scroll area; existing verbose cards retain their single-scroll-owner checks. Do not add hidden body text to find-in-chat's `[data-text-part]` scope.
- [ ] Add component integration tests for active mode switches, permissions still in the footer, same IDs in main/side/nested scopes, split/merge/remount persistence, direct nested expansion and all native actions. Test failed rows collapsed by default, partial output, completed empty output, full cards, prose/images order and the existing turn/runtime error branch. Run the existing AssistantMessage, ReasoningGroup, TaskCard, tool dispatch and card suites unchanged except deliberate completed-empty expectations owned by G1.
- [ ] Add focused E2E cases through the existing recording/daemon fixture for picker persistence, default Verbose selectors, compact disclosure, pending gates and nested rendering. Use explicit fixture messages for metadata the base transport cannot supply; do not add fake daemon timing or mutate React stores in a running app to make these cases pass.

Verification: run focused suites one file at a time, UI typecheck and ESLint on changed TypeScript files using the repository's installed tooling. Check formatting, file/function limits, changeset and staged secret scan before implementation commits. Run the relevant existing card/settings E2E scenarios through their configured project, retaining the original selector contract. Exact commands are selected from the checkout's scripts at execution time; this plan predicts no test output. No current UI lint script exists, so invoke installed ESLint for the owned TypeScript paths rather than treating an empty recursive lint run as validation.

## Live QA and evidence

Parent owns the prepared browser session at daemon port `31517`, Vite port `6005`, data directory `/tmp/live-qa/todo-371-session-20261002/data`. Preparation is complete; no runtime launch is claimed. Use `.agents/test-env.sh` and the existing session receipt for launch/teardown, not another ad-hoc server.

- Real Claude and Codex sessions prove the base runtime's absent-metadata fallback, both modes, native actions, pending approve/deny gates, active switches, side chat and nested transcripts. Record which lifecycle distinctions each provider actually delivered.
- A separate run-local browser page may import the real Vite components and mount explicit native parts with AuiProvider. Reuse the committed fixtures for known timestamps, structured commands, completed-empty calls, missing signals and a 20-plus-call turn. This proves component behavior only; it does not prove upstream transport. No product QA route, fabricated daemon signal or React-store mutation is needed.
- Capture light and dark themes, reduced motion, long filenames and a 320 CSS-pixel chat. Measure visible row top before/after mouse and keyboard toggles; it stays within 2 CSS pixels when scroll range allows. Scroll away from bottom and deliver output/ticks; scrollTop stays fixed. Repeat while following bottom to show ordinary following still works. Measure expanded body against both 24rem and half the real viewport.
- Inspect focus, selected/expanded states, status names, timer announcements and reachable actions. Check no horizontal page overflow, no full-card disappearance, no accidental hidden-tool search matches and no lost disclosure after switching away/back.
- Browser `setZoom` is a no-op. Browser QA can verify the Compact UI-scale picker/persistence, but cannot prove native 0.92 zoom. Record that limitation unless the parent adds a native-target pass. Likewise, record unavailable provider timing/reasoning metadata rather than calling fixtures live-provider proof.

Spec coverage: AC1 maps to G3; AC2–3 and AC10–14 map to G4; AC4–7 map to G1/G2; AC8–9 map to G4 timing tests; AC12 also maps to G1 lifecycle; AC15 applies to every group. Review should focus on inferred native completion, partially available metadata, cross-scope identity collisions, nested action routing and the two independent bottom-follow mechanisms.
