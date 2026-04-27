# PR Mutation Detection

**Status:** Approved · **Date:** 2026-04-21

## Summary

Extend PR detection to catch `gh pr edit|ready|merge|close|comment|reopen|review` (and GitLab/Azure equivalents) by parsing the PR identifier from the Bash command args, not just from the tool_result output. Emissions use the existing `source: 'mentioned'` — no new source state, no UI change.

## Motivation

Today, `packages/core/src/plugins/builtin/claude/events.ts` only stashes Bash tool_use IDs for PR-creation commands (`gh pr create`, `glab mr create`, `az repos pr create`) and relies on URL scraping in tool_result text. That works for creates (the URL is the output) and for passive mentions, but silently misses PR mutations when:

- the command output omits the PR URL (`--json` with a url-less field set, quiet flags, newer `gh` behaviors, errored-but-partially-succeeded mutations),
- the mutation completes silently.

The goal is a reliable "this session touched PR #N" signal: if the agent ran a mutation command against a specific PR and it succeeded, that PR should show up in the chat's detected-PR list, even if the URL never appears in stdout.

## Scope

Detect the following commands and emit `source: 'mentioned'` when the PR identifier can be extracted from the **command args**:

| Provider | Commands |
|----------|----------|
| GitHub | `gh pr edit`, `gh pr ready`, `gh pr merge`, `gh pr close`, `gh pr reopen`, `gh pr comment`, `gh pr review` |
| GitLab | `glab mr update`, `glab mr merge`, `glab mr close`, `glab mr reopen`, `glab mr note` |
| Azure | `az repos pr update` |

Explicitly **out of scope**:

- `git push`, `git commit`, `git branch` — no PR identifier in args or reliable output.
- `gh pr view`, `gh pr list`, `gh pr diff`, `gh pr checkout`, `gh pr status` — read-only or repo-level, not per-PR mutations.
- Number-only args (`gh pr edit 42`) — the owner/repo context is ambiguous without a `git remote` shell-out, which we've chosen not to add. These still get caught by the existing output-URL scraper (Path A) when the command prints the PR URL on success, so coverage remains practically unchanged.

## Detection logic

Two detection paths run in parallel on every Bash tool call. Both feed `sink.onPrDetected()`; the frontend's existing `(owner, repo, number)` dedup in `chats.addDetectedPr` (`packages/desktop/src/renderer/store/chats.ts`) absorbs overlap, and the existing `mentioned → created` upgrade rule still applies.

**Path A (existing, unchanged):** scan tool_result text with `extractPrFromToolResult`. If the originating tool_use_id is in `session.state.pendingPrCreates`, emit `source: 'created'`; otherwise `source: 'mentioned'`.

**Path B (new):** at assistant tool_use time, if the command matches a mutation pattern **and** the args contain a parseable PR reference, stash `(toolUseId → {owner, repo, number, url})` in a new `session.state.pendingPrMutations: Map<string, DetectedPrCore>`. At user tool_result time, if the result's `tool_use_id` is in that map and `is_error !== true`, emit `sink.onPrDetected({...stashed, source: 'mentioned'})` and delete the entry.

### Parseable PR references in args

A command arg is parseable when it is one of:

1. A full PR/MR URL — any of the three existing URL regexes (`PR_URL_REGEX`, `GITLAB_MR_URL_REGEX`, `AZURE_PR_URL_REGEX`) matches.
2. GitHub's compact `owner/repo#N` syntax — new regex: `^([^/\s#]+)\/([^/\s#]+)#(\d+)$`. Only accepted for `gh pr *` commands (the syntax is gh-specific).

Anything else — bare number, no identifier at all, or unrecognized format — means Path B skips. Path A still runs.

### Why wait for tool_result instead of emitting at tool_use

Two reasons:

1. **Error filtering.** `is_error: true` on the tool_result means the command failed; we don't want to claim the agent "touched" a PR that rejected the mutation (auth failure, merge conflict, PR-not-found, etc.). This mirrors the create path, which only marks `'created'` when a URL actually appears in the result.
2. **Symmetry.** The existing stash-and-consume pattern for creates is well-understood and tested. Keeping mutations on the same shape avoids two divergent lifecycles.

## Types

No changes to `packages/types/src/adapter.ts`. `DetectedPr.source` stays `'created' | 'mentioned'`.

New internal type local to `events.ts`:

```ts
type DetectedPrCore = Omit<DetectedPr, 'source'>;
```

New session state in `packages/core/src/plugins/builtin/claude/session.ts`:

```ts
pendingPrMutations: Map<string, DetectedPrCore>; // tool_use_id → pr info
```

Initialized to `new Map()` alongside `pendingPrCreates`.

## Implementation outline

All changes live in `packages/core/src/plugins/builtin/claude/events.ts` except the session-state field.

New exports:

```ts
export const PR_MUTATION_COMMANDS: RegExp[] = [
  /\bgh\s+pr\s+(edit|ready|merge|close|reopen|comment|review)\b/,
  /\bglab\s+mr\s+(update|merge|close|reopen|note)\b/,
  /\baz\s+repos\s+pr\s+update\b/,
];

export function isPrMutationCommand(command: string): boolean;

export function parsePrIdentifierFromArgs(
  command: string
): DetectedPrCore | null;
```

`parsePrIdentifierFromArgs` tries the three URL regexes first, then the `owner/repo#N` pattern (only if the command starts with `gh pr `). Returns the first match's `{url, owner, repo, number}` or `null`.

In `handleAssistantEvent`, right after the existing `isPrCreateCommand` block:

```ts
if (input?.command && isPrMutationCommand(input.command)) {
  const pr = parsePrIdentifierFromArgs(input.command);
  if (pr) session.state.pendingPrMutations.set(block.id as string, pr);
}
```

In `handleUserEvent`, inside the `tool_result` branch, after the existing Path A block:

```ts
const toolUseId = block.tool_use_id as string | undefined;
if (toolUseId && session.state.pendingPrMutations.has(toolUseId)) {
  const isError = block.is_error === true;
  const stashed = session.state.pendingPrMutations.get(toolUseId)!;
  session.state.pendingPrMutations.delete(toolUseId);
  if (!isError) {
    sink.onPrDetected({ ...stashed, source: 'mentioned' });
  }
}
```

Path A and Path B both running means the same `(owner, repo, number)` could be emitted twice for a single command (URL also appears in output). The frontend store already short-circuits the duplicate emission; no change needed there.

## Testing

New file: `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`.

Cases:

1. `gh pr edit https://github.com/org/repo/pull/42 --add-label bug` → emits `{owner: 'org', repo: 'repo', number: 42, source: 'mentioned'}`.
2. `gh pr ready org/repo#42` → emits the same.
3. `gh pr edit 42` (number-only) → Path B does not emit; if the tool_result stdout includes the URL, Path A emits as `'mentioned'`.
4. `gh pr merge https://github.com/org/repo/pull/42 --squash` with `is_error: true` on tool_result → no emission.
5. `glab mr update https://gitlab.com/org/repo/-/merge_requests/7` → emits with GitLab URL.
6. `az repos pr update --id 5` → Path B skips (no URL in args); if output has URL, Path A handles.
7. One assistant turn with both `gh pr create` and `gh pr edit <url>` for different PRs → first is `'created'` (at tool_result with URL), second is `'mentioned'`.
8. `gh pr view 42` → neither path B nor A emits (no URL in args, no URL in typical view output for this test fixture).
9. Command arg contains a URL but is not a mutation command (e.g., `echo https://github.com/org/repo/pull/42`) → Path B skips; Path A emits `'mentioned'` from the output, same as today.

Mock `SessionSink` as in the existing `pr-detection.test.ts`. Assertions use `expect(sink.onPrDetected).toHaveBeenCalledWith(...)` / `.not.toHaveBeenCalled()`.

No new frontend tests: the store's dedup path is already covered by `chats.ts` tests, and no UI behavior changes.

## UI

No changes. New `'mentioned'` emissions render with the existing faded-badge styling in `PrBadge.tsx`. The `mentioned → created` upgrade still works because a later `gh pr create` on the same PR goes through the unchanged create path.

## Documentation

Update `docs/adapters/claude/PR_TRACKING.md`:

- "What Mainframe Currently Does" is already stale (says "Nothing"). Rewrite it to describe both paths:
  - Path A: tool_result URL scraping (source: `'created'` when tool_use was a create command, else `'mentioned'`).
  - Path B: command-args parsing for mutation commands (source: `'mentioned'`).
- Update the "Detected Commands" table's "What Mainframe Can Do" section to reflect that mutations are now tracked.

## Scope summary

| File | Change |
|---|---|
| `packages/core/src/plugins/builtin/claude/events.ts` | Add `PR_MUTATION_COMMANDS`, `isPrMutationCommand`, `parsePrIdentifierFromArgs`. Extend `handleAssistantEvent` and `handleUserEvent`. |
| `packages/core/src/plugins/builtin/claude/session.ts` | Add `pendingPrMutations: Map<string, DetectedPrCore>` to state; initialize to `new Map()`. |
| `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts` | New test file, ~9 cases. |
| `docs/adapters/claude/PR_TRACKING.md` | Update "What Mainframe Currently Does" section. |

No type changes in `packages/types`. No changes to `packages/desktop`. No changes to the daemon event router, HTTP/WS protocol, or SQLite schema.
