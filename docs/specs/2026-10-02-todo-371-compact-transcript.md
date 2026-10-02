# Compact transcript mode

Todo #371. Approved design dated 2026-10-01. Baseline commit `0ea3eb85d956abb2e126561970ee54337a8f918e`.

## Problem

Tool cards take up much of a long assistant turn. Users must scroll past command output and repeated file operations to follow the assistant's explanation. Desktop currently offers verbose cards and explore groups, with no transcript-density preference.

Compact mode gives each step a short, readable row and keeps its full details available on demand. The approved design supersedes conflicting recommendations in the [merged research](../research/2026-09-29-compact-transcript-mode.md), including merging across thinking, client-stamped tool durations, and destructive text for routine tool failures.

## Behavior

Settings > General > Appearance contains a Transcript picker with Verbose and Compact. Verbose is selected for new users and existing installations with no valid saved choice. The choice persists locally across app restarts and applies immediately to all desktop chats, including side chats and nested subagent transcripts. Switching modes during a turn preserves the conversation, pending approvals, and active work.

Verbose retains its current rendering, grouping, card actions, and controls.

Compact keeps assistant prose and images in order. Tool activity appears between them as muted, single-line rows with a status icon, a readable action, and relevant filenames, counts, diff totals, or elapsed time. Long labels truncate visually, with the full label available on hover and keyboard focus. All steps remain available while a turn runs and after it finishes.

Adjacent successful calls of the same kind merge only when a specific summary remains meaningful. Reads, edits, writes, file searches, directory listings, web searches, and page fetches may merge within their own kind. Prose, images, thinking, full cards, a different kind, or a non-successful call end a run. Blank spacer text does not end a run. Calls never merge across messages or turns. Running, failed, stopped, declined, awaiting-approval, shell, MCP, subagent, and unknown calls remain individual rows. A shell call remains individual even when its description identifies reading or searching.

Single-file rows name the file. Multi-file rows count distinct known files and include a shared directory when useful, such as "Read 3 files in sessions/**tests**". Repeated operations on one file name that file and the operation count. A directory consisting only of a filesystem root adds no useful context and is omitted. Unknown paths do not become invented filenames or file counts. Calls without enough information for a meaningful merged label remain separate.

Edits and writes show available added and removed line counts using the same calculation as their detailed cards. A merged row sums the included calls' counts, including repeated edits to a file. These are operation totals, not a net workspace diff. If any included call lacks trustworthy counts, the merged row omits its total; expansion still shows each call's available counts. Use "Wrote" unless structured data explicitly establishes file creation. Output wording alone cannot establish "Created".

Command labels prefer structured action information when available. Otherwise, recognize a small set of common commands after removing supported shell, environment, and privilege wrappers. Recognizable actions include reads, searches, listings, lint, typecheck, tests, formatting, builds, installs, and common Git operations. An ambiguous compound command must not receive a summary that misrepresents the whole command. Fall back to the provider's description, then a safely rendered, truncated command. A running command without a useful action or description reads "Running <program>", or "Running command" when the program is unknown.

Success, failure, stopped, declined, and awaiting-approval states come from explicit lifecycle or permission information. Labels use the matching tense, such as "Reading file.ts", "Read file.ts", "Failed to read file.ts", and "Waiting for approval". "Tests passed" and similar outcome labels require a recognized command and explicit successful completion. Output containing words such as "failed" or "passed" never changes the state or supplies an outcome.

Running calls show an activity indicator. When genuine per-call timing is available, their elapsed time advances locally and stops at completion. Reopening or reconnecting uses the same supplied start and completion times. Missing or invalid timing shows no number. Do not start a tool clock when its row mounts, use a message timestamp as a tool start, or derive a duration from the turn's length. Completed individual calls may retain a known duration; merged rows do not add durations of calls that might overlap. Valid subsecond tool intervals display as "0:00".

Thinking remains a separate expandable row and always ends a merge run. It reads "Thinking" while active and "Thought" after completion. With reliable timing for that reasoning phase, it shows a locally updating elapsed value while active and "Thought for Ns" when complete. Without that timing, including untimed history, it omits the number. A whole-message running window is not a reasoning duration. Expansion reveals the available reasoning text.

Rows start collapsed, including failures. Clicking a row or pressing Enter or Space expands its existing detailed card or cards in original order. File links, open-diff actions, output expansion, and other native card actions retain their behavior. Each subagent has its own row; expanding it reveals the available nested transcript, which uses the global mode. A subagent without messages still has a named row and status.

Disclosure choices belong to the chat and the underlying calls. They survive streaming, row regrouping, switching modes, navigating away and back, and row remounts during the app session. If calls merge, the merged row is open when any member was open. Toggling the merged row applies that choice to all its members. Equal call identifiers in different chats or nested transcripts do not share choices. App restart may reset disclosure choices.

Expanded output scrolls within a bounded area no taller than the smaller of 24rem and half the transcript viewport. Expanding or collapsing keeps the clicked row anchored in the viewport, except where the scroll range makes that impossible. While the user reads older content, new tool output and timer ticks do not pull the transcript to the bottom. Existing follow-at-bottom behavior remains available.

Plan, answered-question, and workflow cards stay visible as full cards. Pending permission and question controls remain usable in their existing location. Awaiting-approval calls remain identifiable even while collapsed. Tool failures use a tinted error icon and an accessible failure label; their row text stays muted. Turn and runtime errors keep their existing destructive treatment.

Every disclosure and setting control has an accessible name, visible focus, and an announced selection or expanded state. Status is conveyed by text or an accessible label as well as its icon. Reduced-motion settings suppress decorative activity animation. Timer ticks do not repeatedly announce themselves to screen readers.

## Not Included

- [platform] Mobile rendering or changes to the mobile repository.
- [declined] Per-chat overrides, a chat-header switch, a new shortcut, or a command-palette action. The global Appearance picker is the control for this release.
- [declined] Inferring intent, creation, success, failure, or counts from output text; classifying tools by arbitrary name substrings.
- [declined] Mixed-action count sentences or a latest-step-only live transcript.
- [deferred] Finished-turn folding behind "Worked for ...", tracked separately as todo #374.
- [deferred] Adding daemon timing capture or Codex command metadata transport. Todos #373 and #372 own those capabilities; this feature accepts their absence.
- [deferred] Persistent disclosure choices across app restarts and indexing hidden tool output for find-in-chat.

## Edge cases

- Old or malformed saved preferences select Verbose without resetting unrelated preferences.
- Replayed history without timing stays untimed. A call delivered only at completion may have a near-zero observed duration; that is not evidence of its provider execution time.
- Missing, malformed, unknown, or mixed structured command actions fall back conservatively. A shell read does not merge with a native file read.
- Missing file paths, descriptions, patches, or reasoning text never crash the transcript or produce fabricated details. An unknown tool uses its available name and remains expandable.
- A pending permission takes precedence over a generic running presentation. Denial, cancellation, and failure remain separate from successful completion when the provider supplies those distinctions.
- A call explicitly known to have completed with empty output stops spinning. When no terminal signal reaches the renderer, it may remain active until the message settles; an empty output alone is not proof of success.
- A failed edit does not contribute successful diff totals to adjacent rows. Partial totals do not masquerade as complete totals.
- Duplicate updates or reconnects do not duplicate calls, reset supplied timestamps, or transfer disclosure choices to another call.
- Find-in-chat keeps its existing rendered-text-part scope. This release neither searches hidden tool bodies nor promises that expanding a tool makes its output searchable.
- Narrow chats and long filenames retain reachable disclosure controls, status, and card actions without horizontal page overflow. Nested transcripts obey the same rules.

## Acceptance criteria

1. With clean preferences, an older persisted preference record, or an invalid transcript value, the picker selects Verbose. Choosing Compact survives restart; unrelated preferences retain their values.
2. Changing the picker updates an open main chat, side chat, and expanded nested transcript. Switching during an active turn leaves its work, message order, and pending permission unchanged.
3. Existing verbose component and end-to-end checks retain their selectors and expected behavior, including explore groups, reasoning, tool cards, errors, and nested transcripts.
4. A fixed fixture with three adjacent successful reads of distinct files in one directory shows one named, counted row. Inserting reasoning, prose, an image, a full card, an edit, a failure, or a pending approval splits that run. Blank spacer text does not split it.
5. Running, failed, stopped, declined, shell, MCP, subagent, and unknown calls each retain their own row. Structured command actions improve a shell row's label without merging it with another row.
6. Fixed fixtures cover repeated reads and edits of one file, different directories, missing paths, structured patches, edit fallback counts, and unavailable counts. Two edits with counts +3/-1 and +5/-2 produce +8/-3; unavailable member counts suppress the aggregate.
7. Command fixtures cover structured reads and searches, unknown and mixed actions, supported shell/env/sudo wrappers, recognized lint/test/build commands, provider descriptions, and safe raw-command fallback. Changing only output text from "passed" to "failed" changes neither status nor outcome label.
8. Known tool timing advances once per second while active and freezes at supplied completion. Reconnect and remount preserve that value. Untimed and malformed history show no number. A render counter or profiler confirms timer ticks do not rerender the transcript or rebuild its rows.
9. A thinking row separates two otherwise mergeable calls, expands to its text, and shows a duration only with reliable phase timing. Replayed untimed reasoning shows "Thought" without a number.
10. Mouse and keyboard disclosure reveal the same detailed cards and actions available in Verbose. A subagent disclosure reveals its nested transcript. Expansion survives navigation, mode changes, streaming, and regrouping by call identity; separate chats and nested agents remain independent.
11. Expanded output obeys the height cap. In a long transcript scrolled away from the bottom, toggling a visible row keeps its top within 2 CSS pixels where scroll range permits; incoming output and timer ticks do not move the scroll position. A chat already following the bottom continues its normal follow behavior.
12. Pending tool permissions can be approved or denied with the row collapsed or expanded. Plan, answered-question, and workflow cards remain visible. An explicitly completed empty-output fixture stops its activity indicator; a missing terminal signal never becomes a fabricated successful result.
13. A tool failure has a tinted icon, an accessible failure name, and muted row text. A turn/runtime error retains the existing destructive presentation. All new interactive elements have accessible names and domain-keyed test IDs; existing verbose test IDs remain intact.
14. Live QA records Claude and Codex sessions, nested transcripts, both modes, light and dark themes, reduced motion, compact UI scale, a 320 CSS-pixel chat width, long filenames, and a turn with at least 20 calls. It covers timing/metadata-present fixtures and absent-metadata fallback; unavailable upstream signals are recorded as limitations.
15. Relevant unit/component tests, typecheck, and lint pass. The implementation stays within the repository's file/function limits and introduces no daemon API or protocol change for this display preference.

## Decisions

- [reversible] Keep the approved global picker, default Verbose, and per-step design. Existing users retain their current transcript unless they opt in.
- [reversible] Merge only successful same-kind calls with meaningful summaries, and let thinking break runs. This preserves the approved order and status visibility.
- [reversible] Keep every shell call individual, including structured reads. The approved design overrides the research's older proposal to merge Codex shell reads with native reads.
- [reversible] Count distinct known files and sum available operation diff counts; omit incomplete aggregates. This avoids overstating coverage or presenting operation totals as a net diff.
- [reversible] Use "Wrote" without explicit creation metadata, and preserve conservative command fallbacks. Result prose is not a trustworthy source of outcomes.
- [reversible] Use supplied per-call timing only and omit unknown reasoning durations. The current renderer has no per-call timing, and its broader reasoning clock cannot establish a reasoning phase duration.
- [reversible] Consume optional metadata when available without stacking or importing the open dependency PRs. PR #742 and PR #743 were both open and unmerged at specification time; their absence must remain a supported state.
- [reversible] Expand each subagent directly to its available nested transcript. An extra compact summary must not make users hunt for the agent's work.
- [reversible] Keep disclosure choices per chat and call for the app session, using any-open behavior on merge. This preserves inspection during streaming without adding durable preference storage for every call.
- [reversible] Start failure rows collapsed and use a tinted icon with accessible status. Users can inspect the existing error detail without routine failures dominating the turn.
- [reversible] Cap expanded output at 24rem or half the transcript viewport, whichever is smaller. A single command cannot consume the entire visible transcript.
- [reversible] Preserve the current find-in-chat scope. Hidden-output indexing is separate work, and the existing search does not search arbitrary tool-card text.

No hard-to-reverse product decision is required. This feature changes presentation and a local preference, with no new persisted conversation format or daemon contract.
