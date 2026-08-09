# Todo #301 — Skills and agents must fetch independently

**Branch:** `todo/301-independent-skill-agent-fetch`
**Route:** no-spec (works from the approved Agent Brief + the 2026-08-09 rescope)
**Package:** `@qlan-ro/mainframe-ui` only

## Goal

`SkillsProvider` (`packages/ui/src/features/skills/use-chat-skills.tsx`) fetches skills and agents in one
`Promise.all` guarded by a single `catch` that clears both lists, so a failing skills fetch blanks the
composer's `@` agents picker and a failing agents fetch blanks the `/` skills picker. Make the two fetches
settle independently: each list is set from its own resolution and emptied only by its own rejection, the
single `loading` flag clears once both have settled, and every failure still logs through the existing
tagged `console.warn`. The shared prerequisite — resolving the chat's project path via `getProjects` — keeps
emptying both when it fails, because both fetches genuinely depend on it. The existing test file pins the
both-clearing behavior as correct in two cases; those cases are rewritten to the per-list contract, not
extended.

## Rescope this plan is written against

The brief covers two copies of the pattern. The sidebar copy is dead on this branch:
`packages/ui/src/features/context-panel/` does not exist and `useSidebarSkills` has zero consumers
(verified: `ls` returns "No such file or directory", `grep -rn useSidebarSkills packages/ui/src` returns
nothing). Everything the brief says about the two sidebar lists — the new per-list "couldn't load" caption,
the count badges, the `needs-ui` design gate — is out of scope and was dropped at the brief gate. This plan
covers the composer copy only.

## Decisions

1. **No error field is added to the `ChatSkills` context.** The rescope states the fix is "restoring an
   empty-but-working picker"; a picker whose own fetch failed renders as it does today. No consumer would
   read an error field, and the repo's no-dead-code rule forbids unused API surface. Keeping `ChatSkills`
   shape-identical (`{ skills, agents, loading }`) also means the consumer test mocks in
   `UserMessage.test.tsx`, `UserMessage.session-chip.test.tsx`, `UserMessage-send-failure.test.tsx`,
   `ComposerTriggers.test.tsx` and `instruction-chip.test.tsx` need no changes.
2. **The skills-branch warn string stays byte-identical:** `'[skills] failed to load skills'`. The rewritten
   test 5 keeps asserting it exactly. The agents branch logs `'[skills] failed to load agents'`. The
   `getProjects` catch may be reworded — test 2 asserts only `stringContaining('[skills]')`.
3. **`getProjects` rejecting, and a `projectId` absent from the returned list, still empty both lists.**
   This is the shared prerequisite the brief calls out as correct. Existing tests 2 and 4 stay as written.
4. **One `loading` flag, cleared when both fetches settle.** The two fetches always start together, so
   per-list loading buys nothing.
5. **No new component test for the composer pickers.** `ComposerTriggers` reads `skills` and `agents`
   straight from the context with no combined gating (`buildSkillsTriggerAdapter(skills)` and
   `useMentionTriggerAdapter(cache, agents, sessions.items)` are independent), and its own suite mocks
   `useChatSkills`/`useChatAgents` — a component test there would assert the mock, not the fix. The
   "`/` picker still lists skills when the agents fetch fails" acceptance criterion is covered at hook level.
6. **The two hooks are not collapsed into a shared helper.** Moot after the rescope: only one copy survives.

## Files touched

| File | Change |
|---|---|
| `packages/ui/src/features/skills/__tests__/use-chat-skills.test.tsx` | rewrite 2 cases, add 1 |
| `packages/ui/src/features/skills/__tests__/use-chat-skills.revalidate.test.tsx` | add 1 case |
| `packages/ui/src/features/skills/use-chat-skills.tsx` | split the fetch/catch |
| `.changeset/independent-skill-agent-fetch.md` | new, patch bump |

Unchanged and confirmed as such: `lib/api/skills.ts`, `lib/api/agents.ts`, `use-skills-revalidation.ts`, the
daemon routes, and every consumer of the context.

## Constraints

- Max 300 lines/file, 50 lines/function. `use-chat-skills.tsx` is 139 lines today; the effect body is ~40
  lines and must not grow past 50, so the per-list fetch goes into a module-scope helper.
- No silent catches — every rejection path logs a tagged `console.warn`.
- Every PR carries a changeset.
- Run vitest one file at a time (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`); large batches
  hit cross-file `React.act` failures.

---

## Task 1 — Rewrite the two test cases that pin the both-clearing bug

**File:** `packages/ui/src/features/skills/__tests__/use-chat-skills.test.tsx`

Rewrite exactly two existing cases to the per-list contract. Do not touch tests 1, 1b, 2, 3, 4 or 6.

**a. Section 5, `describe('useChatSkills — getSkills rejects')`** — retitle the `it` to
"keeps the fetched agents when the skills fetch rejects, and logs a warning". Mocks stay as they are
(`getSkills` rejects, `getAgents` resolves `[AGENT_FIXTURE]`). Assertions become:

- `result.current.skills` is `[]`
- `result.current.agents` is `[AGENT_FIXTURE]` — the change that makes this red
- `result.current.loading` is `false`
- `warnSpy` was called with `'[skills] failed to load skills'` and an `Error` (byte-identical to today)

**b. Section 7, the `useChatAgents` case titled
`'returns [] when getAgents rejects (covered by shared catch)'`** — the title and its inline comment
(`// The Promise.all rejects → catch resets both`) both encode the bug; delete both. Retitle to
"empties only agents when getAgents rejects, leaving skills rendered". Render `useChatSkills` instead of
`useChatAgents` so both lists are observable, keep the mocks (`getSkills` resolves `[SKILL_FIXTURE]`,
`getAgents` rejects), and assert:

- `result.current.agents` is `[]`
- `result.current.skills` is `[SKILL_FIXTURE]`
- `result.current.loading` is `false`
- `warnSpy` was called with `'[skills] failed to load agents'` and an `Error`

Keep the existing `warnSpy` mock-and-restore pattern in both.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/skills/__tests__/use-chat-skills.test.tsx`
fails, and the failures are only the two rewritten cases (`skills`/`agents` array mismatches and the missing
agents warn). Tests 1, 1b, 2, 3, 4, 6 still pass. This is the red phase; do not touch
`use-chat-skills.tsx` in this task.

## Task 2 — Add the both-reject case

**File:** `packages/ui/src/features/skills/__tests__/use-chat-skills.test.tsx`

Add one `describe`/`it` after the rewritten section 5: "empties both lists when both fetches reject".
`getProjects` resolves `[PROJECT_FIXTURE]`; `getSkills` and `getAgents` both reject. Assert both lists are
`[]`, `loading` is `false`, and that `warnSpy` received **both** `'[skills] failed to load skills'` and
`'[skills] failed to load agents'`.

**Verify:** the same single-file vitest run. The new case fails on the missing agents warn (today's single
catch logs the skills message only). Do not touch `use-chat-skills.tsx`.

## Task 3 — Add the revalidation-after-failure case

**File:** `packages/ui/src/features/skills/__tests__/use-chat-skills.revalidate.test.tsx`

Add a second `it` inside the existing `describe('useChatSkills — revalidation nonce')`: "renders skills after
a bumped nonce refetch that follows a failed skills fetch". Using the file's existing `beforeEach` mocks,
override `getSkills` to reject once and then resolve `[SKILL_FIXTURE]`
(`mockRejectedValueOnce(new Error('skills fetch failed')).mockResolvedValue([SKILL_FIXTURE])`), spy on
`console.warn` and restore it at the end. Render `useChatSkills` with the file's `wrapper`, wait for
`loading` to settle and assert `skills` is `[]` while `agents` is `[AGENT_FIXTURE]` (agents survived the
skills failure). Then `act(() => bumpSkillsRevalidation())` and wait for `result.current.skills` to equal
`[SKILL_FIXTURE]`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/skills/__tests__/use-chat-skills.revalidate.test.tsx`
— the existing case passes, the new one fails on the mid-test `agents` assertion. Do not touch
`use-chat-skills.tsx`.

## Task 4 — Split the fetch so each list settles on its own

**File:** `packages/ui/src/features/skills/use-chat-skills.tsx`

Replace the `Promise.all` + single `catch` inside the effect (lines 83–99 today) with two independent,
never-rejecting fetches. Add one module-scope helper above `SkillsProvider`:

```ts
async function loadList<T>(label: string, fetch: () => Promise<T[]>, apply: (items: T[]) => void): Promise<void>
```

It awaits `fetch()` and calls `apply(items)`; on rejection it logs
``console.warn(`[skills] failed to load ${label}`, err)`` and calls `apply([])`. It never rethrows, so the
caller needs no outer catch for these two.

In the effect, after the project path resolves, call it twice and await both:

```ts
await Promise.allSettled([
  loadList('skills', () => getSkills(port, adapterId, path), (items) => { if (!cancelled) setSkills(items); }),
  loadList('agents', () => getAgents(port, adapterId, path), (items) => { if (!cancelled) setAgents(items); }),
]);
```

Traps this task must respect:

- **Each `apply` checks `cancelled` on its own.** Today one check inside the `Promise.all` continuation
  covers both writes; that check does not survive the split.
- **`setLoading(false)` stays in the existing `finally`,** after both have settled. Do not move it into
  either branch: the flag means "both settled".
- The `label` argument is what produces `'[skills] failed to load skills'` — byte-identical to today — and
  `'[skills] failed to load agents'`.
- Keep the outer `try/catch` around `getProjects` and the path lookup: a rejection there still empties both
  and still warns. Reword its message to `'[skills] failed to resolve the project path'`; it keeps the
  `[skills]` tag test 2 asserts on.
- Keep the pre-fetch `setSkills([])` / `setAgents([])` stale-clear and the `cancelled` cleanup exactly as
  they are — switching project or adapter must still blank both before the refetch.
- Update the file's header comment only if the split makes it wrong; do not leave a comment describing the
  old shared-catch behavior.

**Verify:**
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/skills/__tests__/use-chat-skills.test.tsx` — all cases green, including tests 1, 1b, 2, 3, 4 and 6.
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/skills/__tests__/use-chat-skills.revalidate.test.tsx` — both cases green.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
- The effect body and the helper are each under 50 lines; the file is under 300.

## Task 5 — Regression-check the context consumers

No consumer changes are expected, because `ChatSkills` keeps its shape. Confirm it:

- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/smart-actions/__tests__/instruction-chip.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/UserMessage.test.tsx`

**Verify:** all three suites green with no edits to their files. If any needs an edit, the context shape
changed — revisit Task 4 rather than patching the mock.

## Task 6 — Changeset

**File:** `.changeset/independent-skill-agent-fetch.md`

Patch bump on `@qlan-ro/mainframe-ui`. One line, in the repo's changeset voice: the composer's skills and
agents lists now load independently, so one failing fetch no longer empties the other picker.

**Verify:** the file names `"@qlan-ro/mainframe-ui": patch` and the front matter parses (`pnpm changeset status`
runs clean, or `pnpm changeset version --snapshot` in a throwaway checkout if status is unavailable offline).

---

## Acceptance criteria mapped to tasks

| Criterion (from the brief, post-rescope) | Task |
|---|---|
| Agents reject, skills resolve → skills rendered, agents empty | 1b, 4 |
| Skills reject, agents resolve → agents rendered, skills empty | 1a, 4 |
| Both reject → both empty | 2, 4 |
| `/` picker lists skills when agents fail; `@` picker lists agents when skills fail | 1, 2, 4 (hook level — Decision 5) |
| Chat-provider tests asserting both-clearing are rewritten, not extended | 1 |
| Project/adapter switch still clears both before the refetch | 4 (test 6 unchanged) |
| Successful revalidation after a failure renders the fetched list | 3, 4 |
| Every failure path still logs a tagged warn; no silent catch | 1, 2, 4 |
| UI typecheck passes, touched suites pass per file, PR carries a changeset | 4, 5, 6 |

## Out of scope

Sidebar error captions and count badges (the surface is deleted). Error state in the `/` and `@` pickers.
Retry buttons, backoff, toasts. Changes to the daemon skills/agents routes or their envelope. Merging the
two hook copies. Todo #243 skills-management UI beyond leaving the revalidation subscription intact.
Todo #247 and the mobile submodule.
