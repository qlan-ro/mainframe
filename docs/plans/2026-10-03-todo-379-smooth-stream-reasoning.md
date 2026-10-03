# Smooth-stream reasoning parts

Todo #379, size small, no-spec route. Approved design and acceptance criteria are in external lane-state `task-context.md`. Base `d1b5d721f19eab8f0e8356d6b75b749984d672cc`, branch `todo/379-smooth-stream-reasoning`.

Make live reasoning reveal with the existing prose animation. Completed history is immediately visible; completing a mounted stream drains its remaining text. Keep plain text, whitespace, group expansion, timing labels and scroll behavior. No provider, transport, status-projection or Markdown changes. This uses merged #371/#735 and has no dependency on blocked #384/#374 or their pending Compact renderer.

## Established facts

Paths below are relative to `packages/ui/src/features/chat/` unless qualified.

- `messages/VerboseParts.tsx::VerboseParts` renders reasoning directly in a `whitespace-pre-wrap` div inside native `GroupedParts`. `messages/compact/CompactRows.tsx::ReasoningText` returns raw text via native `PartByIndex`. Both provide a native part scope; both leaves need wiring.
- `parts/use-held-displayed-text.ts::useHeldDisplayedText` uses `INTERNAL.useSmooth(partText, true)` for prose. It keeps smoothing enabled through completion and independently freezes selected prose. Reuse its animation contract without changing that hook or adding a second timer.
- Installed `@assistant-ui/react@0.15.13/src/utils/smooth/useSmooth.ts::useSmooth` initializes completed content to full text, reveals running content progressively, drains append updates after completion, resets on part/text discontinuity, and honors reduced motion. This source was read in the primary checkout's installation; #379 pins the same version but its own dependencies were not installed during planning. Verify the installed version before implementation checks. Its optional smooth-status context is not required by a plain-text leaf.
- `view-model/convert-acp-item.ts::partStatus` gives explicit streaming priority, marks nonstreaming replay complete and leaves live nonstreaming status unspecified. Use the resolved native part state; do not derive status from group/thread running or add the pending #384 capability logic.
- `messages/ReasoningGroup.tsx::ReasoningGroup` owns Verbose expansion/duration. `messages/compact/CompactReasoningRow.tsx::CompactReasoningRow` owns Compact typography/timing; `CompactDisclosure` owns toggling/scroll anchoring. Preserve these components and keys. Closed details may unmount, so reopening a completed part must mount directly at full text.
- `parts/__tests__/streaming-smooth.test.tsx::Harness` exercises real conversion/projection and the native runtime with fake animation clocks plus real `MessageChannel` flushes. Its mid-reveal completion test is the useful pattern; its prose-only renderer does not test reasoning.

## G1: Shared reasoning leaf and both renderer paths

Kind: ui. Depends on: none. parallel_safe: false. Tests and implementation are one group.

Owned files:

- `packages/ui/src/features/chat/parts/ReasoningText.tsx` (new)
- `packages/ui/src/features/chat/messages/VerboseParts.tsx`
- `packages/ui/src/features/chat/messages/compact/CompactRows.tsx`
- `packages/ui/src/features/chat/parts/__tests__/reasoning-smooth.test.tsx` (new)
- `packages/ui/src/features/chat/parts/__tests__/reasoning-smooth-fixtures.tsx` (new)
- `packages/ui/src/features/chat/messages/__tests__/reasoning-renderers.test.tsx` (new)
- `.changeset/smooth-stream-reasoning.md` (new, UI patch)

1. Add focused failing tests with actual native reasoning-part scope and production conversion/projection. Keep reusable runtime/clock fixtures separate. Exercise the real leaf, not a mocked animator, and flush native store updates before inspecting intermediate text.
2. Implement shared `ReasoningText`, typed as `ReasoningMessagePartComponent`. Subscribe to the current native reasoning part with `useAuiState`; call `INTERNAL.useSmooth(part, true)` inside render and return its text as a plain React fragment. Keep hook order stable and guard unexpected part kinds with an empty completed reasoning state. Do not gate smoothing on running, use group status, trim text or add Markdown. Native smoothing handles completion, discontinuity, identity changes and cleanup. No smooth-status provider is needed because group labels retain native status.
3. Keep Verbose's existing div and replace only its text child with the shared leaf. Replace Compact's local raw-text component with the same leaf in the existing `reasoningComponents` map. Preserve fragment behavior there so adjacent parts gain no new blocks, margins or separators. Do not change disclosure state, timing, search markers or scroll code.
4. Couple regression coverage to those edits: running text reveals a strict prefix then full content; completed replay appears full at first mount; a final appended update and immediate idle drains fully; completed close/reopen does not retype; earlier reasoning remains settled as a later part streams. Check empty text, multiline/trailing whitespace, interruption, non-append replacement and part identity changes by exact final `textContent`. Respect reduced motion and stop animation after unmount.
5. Render real `VerboseParts` and `CompactParts` under the native runtime, using existing Compact fixture/provider patterns. In both modes, open details, update a running part, finish it, close/reopen and assert full text with existing typography and labels. Include completed-first/running-later parts and unchanged disclosure state while frames advance. Keep grouping/timing/scroll regressions green; avoid relying only on the wrapper tests that mock native parts.

## Exit criteria and evidence

Run the focused reasoning suites, existing prose smoothing, ReasoningGroup, Compact reasoning/disclosure and affected message tests; then UI typecheck, affected-file lint and formatting. Add the patch changeset and keep changed files below 300 lines/functions below 50. The production change should stay limited to the shared leaf and two call sites; tests may use the dedicated fixture module above. Parent owns independent review and live QA, including actual progressive reveal and unchanged toggle/scroll behavior in both modes. No app was launched or product tests run while authoring this plan. Do not infer success from static source inspection or import pending #384 fixes to make tests pass.
