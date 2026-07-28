# Todo #243 — Skills Management UI (implementation plan)

**Route:** no-spec (plan works directly from the approved Agent Brief + Design direction on todo #243)
**Branch:** `todo/243-skills-management-ui` · **Worktree:** `.worktrees/todo-243-skills-management-ui`
**Date:** 2026-07-28

## Goal

Turn the Setup Advisor dialog from a single-purpose onboarding surface into a two-section surface, and add the second section: a Skills manager. The dialog header gains a segmented control (`Recommendations` | `Skills`); the existing toolbar button still opens on `Recommendations` and every current advisor behavior stays byte-identical. The Skills section lists the active adapter + project's skills grouped by scope, searches them by name and description, opens one to inspect its metadata and raw `SKILL.md` body, and deletes a project- or global-scope SKILL.md-backed skill behind a confirmation that names it. A successful (or failed) delete bumps one shared UI-side invalidation signal that the section, the composer `/`-trigger provider, and the sidebar Skills tab all re-fetch on, so no read surface goes stale without a reload. No create, no edit, no new daemon endpoints.

---

## Constraints that shape the work

From `CLAUDE.md` (root) and `packages/ui/CLAUDE.md`:

- Max **300 lines/file, 50 lines/function** — decompose rather than grow `SetupAdvisorHost.tsx` / `SetupAdvisorSheet.tsx`.
- **`data-testid` on every interactive element**, `<surface>-<element>` kebab-case, **keyed by skill id, never array index**. `ui/` primitives stay passthrough.
- **No `getState()` reach-through** — read stores through their hooks.
- **Tests required** for new logic; single-file test runs preferred (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`).
- **Read the `mainframe-design-system` skill before writing any markup or class names** (repo `.claude/skills/mainframe-design-system`).
- **Changeset required** before committing.
- Vitest projects are split: `*.test.tsx` runs under jsdom, `*.test.ts` under node. A DOM-touching `.test.ts` needs a `// @vitest-environment jsdom` pragma.

## Verified ground truth (read before planning against assumptions)

| Fact | Evidence |
|---|---|
| `Skill` type is final; no change needed | `packages/types/src/skill.ts` — `{id, adapterId, name, displayName, description, scope: 'project'\|'global'\|'plugin', pluginName?, filePath, content, invocationName?}` |
| List route serves `claude` **and** `mock-cli`; delete route is Claude-only | `packages/core-rs/crates/mainframe-server/src/routes/skills.rs:64-68` (list `match adapter.id()`) vs `:165` (`claude_supported` gate) |
| Unsupported-adapter response is HTTP 404 with the exact body `Adapter not found or does not support skills` | `routes/skills.rs:24` `NOT_SUPPORTED` + `fail(StatusCode::NOT_FOUND, NOT_SUPPORTED)` |
| Delete failures (incl. the plugin refusal) all collapse to HTTP 500 `Operation failed` | `routes/skills.rs:175-181` |
| Delete resolves the id against the daemon's own scan and removes `filePath`'s **parent directory** | `crates/mainframe-adapter-claude/src/skills.rs:398-415` |
| Command-derived entries are `.claude/commands/<group>/<cmd>.md` — deleting one would `remove_dir_all` the whole group | `skills.rs:233-284` (scan) + `:408-413` (delete) |
| Skill ids are `claude:<scope>:[<plugin>:]<name>` — they contain `:` | `skills.rs:204-208` |
| `deleteSkill` client wrapper does **not** exist; only `getSkills` does | `packages/ui/src/lib/api/skills.ts` (10 lines, one export) |
| Three independent skill fetchers, each a mount effect, no shared store | `features/skills/use-chat-skills.tsx:60-103`, `features/context-panel/use-sidebar-skills.ts:28-62`, (new) section hook |
| The advisor nav store is a bare open/close flag | `features/setup-advisor/use-setup-advisor.ts` |
| **Trap:** the toolbar wires `onClick={openSetupAdvisor}` — the click event becomes the first argument | `layout/MainToolbar.tsx:239-243` |
| Existing advisor testids all use the `automation-recommender-*` prefix | `SetupAdvisorHost.tsx:71`, `CategoryTabs.tsx:37`, `EvidenceDisclosure.tsx:20`, `RecommendationRow.tsx:90`, `SetupAdvisorSheet.tsx:36,51` |
| Segmented-control recipe to copy | `features/tasks/TasksBoard.tsx:93-115` |
| Canonical daemon-switch reset + its test | `features/daemon/reset-daemon-scoped-stores.ts`, `features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` |

## Decisions taken in this plan

Each deviates from, or resolves an ambiguity in, the brief. All are recorded in the lane result.

- **D1 — `npx skills` CLI detection is implemented as `skills-lock.json` detection, not process probing.** The brief's 2026-07-27 addendum asks the section to "use the `npx skills` CLI where it is available. Detect it." **The app has no way to run a process from the renderer**: `packages/app-tauri/src-tauri/src/lib.rs:97-133` registers no shell/exec command, and the acceptance criteria forbid new daemon endpoints. The only observable, endpoint-free evidence that the skills CLI manages this project is its lockfile. So: read `skills-lock.json` at the project root through the existing `GET /api/projects/:id/files` route (`lib/api/files.ts` `getProjectFile`). **Present** → each skill whose directory name matches a lockfile key shows a `via skills CLI · <source>` source line in its row and inspect view, and the delete confirmation adds a line stating the entry stays in `skills-lock.json` and `npx skills install` would restore it — information the daemon routes do not carry. **Absent or unreadable** → the section works unchanged on the daemon routes and shows one dismissible suggestion row. **This is a resolution of an unbuildable literal requirement, not the requirement itself — flag it to the user.** A true "is the CLI installed" probe needs either a Tauri exec command or a daemon capability route; both are out of scope here.
- **D2 — new testids use the `setup-advisor-*` / `skills-section-*` prefixes**, not `automation-recommender-*`. The old prefix is a legacy name for the recommendations body; the AC only requires that existing testids not change, and they do not.
- **D3 — the report still fetches on the open rising edge even when a caller opens straight onto `Skills`.** Keeps `SetupAdvisorHost`'s existing effect and all of its tests unchanged; the cost is one report fetch the user may not look at, which the advisor already pays on every open.
- **D4 — scope handling is grouping, not a filter control.** The AC reads "filter/group by scope"; grouped `SectionHeader` blocks satisfy it with one less control, and the design direction names `section-header.tsx` for exactly this.
- **D5 — the inspect view renders raw content in a `<pre>`, no markdown renderer, no `React.lazy`.** The design says lazy-load *if* it pulls a heavy renderer in; not pulling one in is strictly better and keeps the file small.
- **D6 — "adapter has no skills support" is detected by matching the daemon's exact error string.** `ApiRequestError` carries no HTTP status, and the daemon's 404 body is a fixed constant. The match is pinned to a named constant with a comment pointing at `routes/skills.rs:24`, and a test asserts the two strings agree.
- **D7 — the revalidation nonce is bumped by `resetDaemonScopedStores`, not reset to 0.** A monotonic counter reset to 0 can *suppress* a refetch (a consumer holding `1` would see `0` and not necessarily re-run in dep order); bumping always forces one. This is how the new store "joins the daemon-scoped reset" per the brief.
- **D8 — the delete affordance is gated by scope and backing file only, not by adapter id.** The delete route is Claude-only, but the brief puts the list/delete adapter-gating difference explicitly out of scope, and gating the button on `adapterId === 'claude'` would silently remove it under `mock-cli`.

## Architecture

```
packages/ui/src/
  lib/api/skills.ts                                  (M) + deleteSkill
  features/skills/
    use-skills-revalidation.ts                       (N) shared invalidation nonce
    use-chat-skills.tsx                              (M) subscribe nonce
  features/context-panel/
    use-sidebar-skills.ts                            (M) subscribe nonce
    SkillsList.tsx                                   (M) + "Manage skills" link
  features/daemon/reset-daemon-scoped-stores.ts      (M) bump nonce on daemon switch
  features/setup-advisor/
    use-setup-advisor.ts                             (M) + section dimension
    SectionSwitcher.tsx                              (N) header segmented control
    SetupAdvisorHeader.tsx                           (N) title + project + switcher
    SetupAdvisorHost.tsx                             (M) header extracted, body branches on section
    SetupAdvisorSheet.tsx                            (—) untouched
    skills/
      SkillsSection.tsx                              (N) section orchestrator
      SkillsSectionList.tsx                          (N) grouped list
      SkillRow.tsx                                   (N) one row
      SkillInspect.tsx                               (N) inspect view
      SkillsCliSuggestion.tsx                        (N) dismissible install row
      use-skills-section.ts                          (N) list fetch + unsupported/error state
      use-skills-cli.ts                              (N) skills-lock.json probe
      skill-filters.ts                               (N) pure: search, grouping, deletability
      skill-content.ts                               (N) pure: frontmatter/body split
  layout/MainToolbar.tsx                             (M) fix openSheet call site
```

Data flow: `SetupAdvisorHost` owns nav (`useSetupAdvisor`) and identity (`useActiveIdentity`), renders `SetupAdvisorHeader` + one of two bodies. `SkillsSection` is self-contained — it reads its own identity and port, so it can be rendered and tested standalone without the host.

---

## Tasks

Each task lists its files and a verification step. Test tasks come before the implementation they drive.

### Group A — red tests: delete wrapper + revalidation seam

**T1. Test `deleteSkill`'s URL contract.**
File: `packages/ui/src/lib/api/__tests__/adapter-resources.test.ts` (extend).
Add a `describe('deleteSkill')` covering: method is `DELETE`; URL is `<base>/api/adapters/claude/skills/<encodeURIComponent(id)>?projectPath=<encoded>`; a skill id containing `:` (`claude:project:review`) is percent-encoded in the path; the `okEmpty` envelope resolves; `{success:false,error}` rejects with that error message.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/adapter-resources.test.ts` — the new cases fail (`deleteSkill` is not exported).

**T2. Test the revalidation store.**
File: `packages/ui/src/features/skills/__tests__/use-skills-revalidation.test.ts` (new).
Cover: initial `nonce === 0`; `bumpSkillsRevalidation()` called outside React increments it; two bumps produce two distinct values; a subscriber added via `useSkillsRevalidation.subscribe` fires per bump.
Verify: `… vitest run src/features/skills/__tests__/use-skills-revalidation.test.ts` — fails (module missing).

**T3. Test the sidebar hook re-fetches on bump.**
File: `packages/ui/src/features/context-panel/__tests__/use-sidebar-skills.test.tsx` (extend).
Add: with a stable identity, `renderHook(useSidebarSkills)`, wait for the first `getSkills` call, `act(() => bumpSkillsRevalidation())`, assert `getSkills` was called a second time with the same args. Do **not** mock `use-skills-revalidation` — exercise the real store.
Verify: `… vitest run src/features/context-panel/__tests__/use-sidebar-skills.test.tsx` — new case fails.

**T4. Test the composer provider re-fetches on bump.**
File: `packages/ui/src/features/skills/__tests__/use-chat-skills.test.tsx` (extend).
Same shape as T3 against `SkillsProvider` / `useChatSkills`.
Verify: `… vitest run src/features/skills/__tests__/use-chat-skills.test.tsx` — new case fails.

**T5. Test the daemon-switch reset bumps the nonce.**
File: `packages/ui/src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` (extend).
Add: capture `useSkillsRevalidation.getState().nonce`, call `resetDaemonScopedStores()`, assert the nonce strictly increased (D7 — bumped, not zeroed).
Verify: `… vitest run src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` — new case fails.

### Group B — implementation: delete wrapper + revalidation seam

**T6. Add `deleteSkill`.**
File: `packages/ui/src/lib/api/skills.ts`.
```ts
export const deleteSkill = (port: number, adapterId: string, skillId: string, projectPath: string): Promise<void> => {
  const qs = new URLSearchParams({ projectPath });
  return requestEmpty(
    'DELETE',
    `${apiBase(port)}/api/adapters/${encodeURIComponent(adapterId)}/skills/${encodeURIComponent(skillId)}?${qs}`,
  );
};
```
Import `requestEmpty` alongside `request`. Send `projectPath` as a query param only (the daemon accepts query or body; query keeps the wrapper bodyless).
Verify: T1 passes.

**T7. Add the revalidation store.**
File: `packages/ui/src/features/skills/use-skills-revalidation.ts` (new).
A zustand store `{ nonce: number }` plus `bumpSkillsRevalidation()` (a module function calling `useSkillsRevalidation.setState(s => ({ nonce: s.nonce + 1 }))`, callable outside React) and a `useSkillsNonce()` selector hook. File header comment states *why* it exists: three independent fetchers, no daemon broadcast on skill change.
Verify: T2 passes.

**T8. Subscribe the composer provider.**
File: `packages/ui/src/features/skills/use-chat-skills.tsx`.
Add `const nonce = useSkillsNonce();` and append `nonce` to the effect dep array at line 103. No other change.
Verify: T4 passes; `… vitest run src/features/skills/__tests__/use-chat-skills.test.tsx` fully green.

**T9. Subscribe the sidebar hook.**
File: `packages/ui/src/features/context-panel/use-sidebar-skills.ts`.
Same change against the effect at line 62.
Verify: T3 passes; the file's whole suite green.

**T10. Bump on daemon switch.**
File: `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts`.
Add `bumpSkillsRevalidation()` to `resetDaemonScopedStores`, with a one-line comment stating it is bumped rather than zeroed (D7).
Verify: T5 passes.

### Group C — red tests: section nav + entry points

**T11. Test the nav store's section dimension.**
File: `packages/ui/src/features/setup-advisor/__tests__/use-setup-advisor.test.ts` (new).
Cover: default state is `{open: false, section: 'recommendations'}`; `openSheet()` with **no argument** opens on `recommendations`; `openSheet('skills')` opens on `skills`; `openSheet(someNonSectionValue as never)` still lands on `recommendations` (guards the `onClick={openSheet}` event-argument trap); `setSection('skills')` while open changes only the section; `closeSheet()` closes and leaves the section as-is.
Verify: `… vitest run src/features/setup-advisor/__tests__/use-setup-advisor.test.ts` — fails.

**T12. Test the host's section routing.**
File: `packages/ui/src/features/setup-advisor/__tests__/SetupAdvisorHost.section.test.tsx` (new).
Mock `@/lib/api/setup-advisor`, `@/features/sessions/use-active-identity`, `../SetupAdvisorSheet`, and `../skills/SkillsSection` (stub) — same style as the existing `SetupAdvisorHost.test.tsx`. Cover: opening via `openSheet()` renders the recommendations stub and not the skills stub; clicking `setup-advisor-section-skills` swaps bodies and keeps the dialog open; `openSheet('skills')` lands on the skills body directly; `aria-pressed` tracks the active segment; the report fetch still fires exactly once on the open rising edge **regardless of section** (D3); `automation-recommender-sheet` is still the `DialogContent` testid.
Verify: fails (host does not render a switcher).

**T13. Test the toolbar entry point.**
File: `packages/ui/src/layout/__tests__/MainToolbar.test.tsx` (extend).
Add: clicking `automation-recommender-open` leaves `useSetupAdvisor.getState().section === 'recommendations'` — i.e. the click event is not forwarded as the section argument.
Verify: fails until T19.

**T14. Test the sidebar link.**
File: `packages/ui/src/features/context-panel/__tests__/SkillsList.test.tsx` (extend).
Add: `sidebar-skills-manage` renders in both the populated and empty states; clicking it sets the nav store to `{open: true, section: 'skills'}`; the list still renders no delete affordance (`queryAllByTestId(/^sidebar-skill-delete/)` is empty).
Verify: fails.

### Group D — implementation: advisor shell (runs last; imports `SkillsSection` from Group F)

**T15. Add the section dimension to the nav store.**
File: `packages/ui/src/features/setup-advisor/use-setup-advisor.ts`.
```ts
export type AdvisorSection = 'recommendations' | 'skills';
```
State becomes `{ open, section, openSheet(section?), setSection(section), closeSheet() }`. `openSheet` normalizes its argument: anything that is not the literal `'skills'` resolves to `'recommendations'` (defends the `onClick` trap even after T19). Keep the file's existing header comment and extend it with the section rationale.
Verify: T11 passes.

**T16. Build the header segmented control.**
File: `packages/ui/src/features/setup-advisor/SectionSwitcher.tsx` (new).
Props `{ section: AdvisorSection; onSelect: (s: AdvisorSection) => void }`. Copy the enclosed-track recipe from `features/tasks/TasksBoard.tsx:93-115`: outer `flex items-center gap-0.5 rounded-[6px] bg-muted p-0.5`; each button `px-2 py-1 rounded text-label transition-colors` with `aria-pressed`, active `bg-background text-foreground shadow-sm`, inactive `text-muted-foreground hover:text-foreground`. Testids `setup-advisor-section-recommendations` and `setup-advisor-section-skills`. No icons — the two labels are the whole control. Read the `mainframe-design-system` skill first.
Verify: covered by T12; file under 60 lines.

**T17. Extract the dialog header.**
File: `packages/ui/src/features/setup-advisor/SetupAdvisorHeader.tsx` (new).
Moves the existing `DialogHeader`/`DialogTitle` block out of `SetupAdvisorHost.tsx:75-81` verbatim — `ScanSearch` icon, "Setup Advisor", the truncated project name — and appends `<SectionSwitcher … className="ml-auto" />` inside the same header row. Keep `className="shrink-0 border-b border-border px-4 py-3 pr-9"` unchanged (the `pr-9` clears the dialog's close button). Props: `{ projectName, section, onSelectSection }`.
Verify: T12's "existing chrome unchanged" assertions pass.

**T18. Route the host by section.**
File: `packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx`.
Read `section` and `setSection` from `useSetupAdvisor`; render `<SetupAdvisorHeader …/>` then either the existing `<SetupAdvisorSheet …/>` (unchanged props) or `<SkillsSection />`. The `[open, projectId]` fetch effect, the `reportProjectId` gating, `EMPTY_COPIED`, the `if (!projectId) return null` gate, and the `DialogContent` testid/classes all stay exactly as they are (D3).
Verify: `… vitest run src/features/setup-advisor/__tests__/SetupAdvisorHost.test.tsx src/features/setup-advisor/__tests__/SetupAdvisorHost.section.test.tsx` — both green, the pre-existing file **unmodified**. File stays under 120 lines.

**T19. Fix the toolbar call site.**
File: `packages/ui/src/layout/MainToolbar.tsx:242`.
`onClick={openSetupAdvisor}` → `onClick={() => openSetupAdvisor()}`. Nothing else changes; the `automation-recommender-open` testid stays.
Verify: T13 passes.

**T20. Link the sidebar tab into the section.**
File: `packages/ui/src/features/context-panel/SkillsList.tsx`.
Add a right-aligned "Manage skills" text button above the rows, rendered in every state including empty and loading, `data-testid="sidebar-skills-manage"`, calling `openSheet('skills')` read via `useSetupAdvisor((s) => s.openSheet)` (hook, not `getState()`). Rows stay read-only — no delete affordance here. Keep the file under 60 lines.
Verify: T14 passes.

**T21. Changeset + full-package verification.**
File: `.changeset/<generated>.md` via `pnpm changeset` (patch on `@qlan-ro/mainframe-ui`).
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean; `pnpm --filter @qlan-ro/mainframe-ui test` green; `git status` shows a changeset file.

### Group E — red tests: skills section

These tests mock `@/lib/api/skills` wholesale with a factory (`{ getSkills, deleteSkill }`), so they do not require Group B's source to exist. They must be observed failing before Group F.

**T22. Test the pure filters.**
File: `packages/ui/src/features/setup-advisor/skills/__tests__/skill-filters.test.ts` (new).
Cover `matchesQuery` (case-insensitive over `displayName`, `name`, `description`, `invocationName`; empty query matches all; whitespace-only query matches all), `groupByScope` (fixed order project → global → plugin; empty groups omitted; input order preserved inside a group), and `isDeletable`:
- `scope: 'project'`, `filePath: '/p/.claude/skills/review/SKILL.md'` → `true`
- `scope: 'global'`, `filePath: '/home/u/.claude/skills/tdd/SKILL.md'` → `true`
- `scope: 'plugin'`, SKILL.md-backed → `false`
- `scope: 'project'`, `filePath: '/p/.claude/commands/git/commit.md'` (command-derived) → `false`
- Windows separator `C:\p\.claude\skills\review\SKILL.md` → `true`
- a file named `MY-SKILL.md` → `false` (the check is the full segment, not a suffix)
Verify: `… vitest run src/features/setup-advisor/skills/__tests__/skill-filters.test.ts` — fails.

**T23. Test the content splitter.**
File: `packages/ui/src/features/setup-advisor/skills/__tests__/skill-content.test.ts` (new).
`parseSkillContent(raw)` → `{ frontmatter: string | null, body: string }`. Cover: leading `---\n…\n---\n` is split off; no frontmatter → `{frontmatter: null, body: raw}`; a `---` that appears only mid-body is not treated as frontmatter; an unterminated opening `---` returns the whole thing as body; CRLF line endings; empty string.
Verify: fails.

**T24. Test the list hook.**
File: `packages/ui/src/features/setup-advisor/skills/__tests__/use-skills-section.test.tsx` (new).
Mock `@/lib/api/skills`, `@/features/sessions/use-active-identity`, `@/features/sessions/runtime/daemon-port-context`. Cover: no `projectPath` → no fetch, `skills: []`, not loading; a missing `adapterId` falls back to `'claude'`; a present `adapterId` is used verbatim; a rejection whose message equals `Adapter not found or does not support skills` yields `unsupported: true` and `error: null` (D6); any other rejection yields `error` set and `unsupported: false`; `bumpSkillsRevalidation()` triggers a refetch; a project switch clears the previous list before the new response lands (no cross-project flash); a late response from a superseded fetch is ignored.
Add one assertion pinning D6: the module's exported `UNSUPPORTED_ERROR` constant equals the literal string in `routes/skills.rs:24`.
Verify: fails.

**T25. Test the section component.**
File: `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.test.tsx` (new).
Mock `../use-skills-section`, `../use-skills-cli`, `@/lib/api/skills`, `@/lib/toast`. Cover, one `it` each:
- **list** — one row per skill, testid `skills-section-row-<skill.id>`; scope group headers `skills-section-group-project` / `-global` / `-plugin` in that order.
- **search** — typing in `skills-section-search` narrows by name and by description; a no-match query shows `skills-section-no-results`, distinct from the empty state.
- **empty** — zero skills renders `skills-section-empty` with "No skills for this project yet" and no error styling.
- **unsupported** — `unsupported: true` renders `skills-section-unsupported` ("This adapter has no skills") and no list, no error.
- **error** — `error` set renders `skills-section-error` with a `skills-section-retry` button that calls `reload`.
- **inspect** — clicking a row opens `skills-section-inspect` showing displayName, description, scope, and the raw body; a plugin-scoped skill additionally shows its `pluginName`; `skills-section-inspect-back` returns to the list.
- **delete affordance gating** — `skills-section-delete-<id>` is present for a project-scope SKILL.md skill, present for a global one, and **absent** (not disabled) for plugin-scoped and command-derived entries.
- **delete confirm** — clicking delete opens `skills-delete-confirm`; its body contains the skill's display name and its on-disk directory; cancel closes it and calls nothing.
- **delete success** — confirming calls `deleteSkill(port, adapterId, skill.id, projectPath)`, then bumps the revalidation nonce (assert via the real store's value), closes the inspect view if the deleted skill was open, and fires `mfToast.success`.
- **delete failure** — a rejecting `deleteSkill` fires `mfToast.error` with the daemon message, still bumps the nonce (refetch, not optimistic removal), and leaves the row rendered.
- **CLI suggestion** — `cliAvailable: false` renders `skills-section-cli-suggestion` with a `skills-section-cli-copy` and a `skills-section-cli-dismiss` that removes the row; `cliAvailable: true` renders no suggestion and stamps `skills-section-row-<id>` for a lockfile-managed skill with its source.
- **testid stability** — two skills whose array order is swapped keep their id-keyed testids.
Verify: fails (component missing).

### Group F — implementation: skills section

**T26. Pure filters.**
File: `packages/ui/src/features/setup-advisor/skills/skill-filters.ts` (new).
Export `matchesQuery(skill, query)`, `groupByScope(skills): {scope, skills}[]` (fixed order, empty groups dropped), `isDeletable(skill)` = `scope !== 'plugin' && lastPathSegment(filePath) === 'SKILL.md'` (split on `/` and `\`), and `skillDirectory(skill)` (the parent path, for the confirm copy). No React.
Verify: T22 passes.

**T27. Content splitter.**
File: `packages/ui/src/features/setup-advisor/skills/skill-content.ts` (new).
`parseSkillContent(raw)` per T23. Pure, no dependencies.
Verify: T23 passes.

**T28. List hook.**
File: `packages/ui/src/features/setup-advisor/skills/use-skills-section.ts` (new).
```ts
export const UNSUPPORTED_ERROR = 'Adapter not found or does not support skills'; // routes/skills.rs:24
export function useSkillsSection(): {
  skills: Skill[]; loading: boolean; error: string | null; unsupported: boolean; reload: () => void;
  adapterId: string; projectPath?: string; projectId?: string; port: number;
}
```
Reads `useDaemonPort()` + `useActiveIdentity()`; adapter falls back to `'claude'`. Effect keyed on `[port, adapterId, projectPath, nonce, reloadSeq]`, with the `cancelled` flag and the clear-before-fetch pattern already used by `use-sidebar-skills.ts:35-38`. Classify a rejection by comparing `err.message` to `UNSUPPORTED_ERROR`. `reload()` bumps a local seq. Catch logs via `console.warn('[skills-section] …')`, matching the sibling hooks' desktop convention.
Verify: T24 passes.

**T29. Skills-CLI probe.**
File: `packages/ui/src/features/setup-advisor/skills/use-skills-cli.ts` (new).
`useSkillsCli(port, projectId)` → `{ available: boolean; entries: Record<string, {source: string}> }`. Reads `skills-lock.json` via `getProjectFile(port, projectId, 'skills-lock.json')`, `JSON.parse` inside a try/catch, and defensively reads `.skills` as an object of `{source}`. Any failure (missing file, bad JSON, wrong shape) → `{available: false, entries: {}}` with a `console.warn` only for a genuine parse failure — a missing file is expected and silent with an `/* expected */` comment. Header comment records D1 in one sentence.
Verify: covered through T25's CLI cases; `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean.

**T30. Row component.**
File: `packages/ui/src/features/setup-advisor/skills/SkillRow.tsx` (new).
Props `{ skill, lockSource?: string, onOpen, onDelete? }`. Layout per the design direction: name · `invocationName` in `font-mono text-caption text-mf-text-3` · scope chip (the `CHIP_BASE` recipe from `layout/MainToolbar.tsx:36-37` — it is module-private there, so restate the class string locally rather than exporting it) · `pluginName` when `scope === 'plugin'` · `via skills CLI · <lockSource>` when present. Testids `skills-section-row-<skill.id>` and `skills-section-delete-<skill.id>`; the delete button renders only when `onDelete` is provided. Read the `mainframe-design-system` skill before writing classes.
Verify: T25's list/gating cases pass.

**T31. Grouped list.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsSectionList.tsx` (new).
Maps `groupByScope(filtered)` to `SectionHeader` (`components/ui/section-header.tsx`, sentence-case captions — never a hand-rolled uppercase eyebrow) + rows. Testid `skills-section-group-<scope>` on each group. Owns no state.
Verify: T25's grouping case passes.

**T32. Inspect view.**
File: `packages/ui/src/features/setup-advisor/skills/SkillInspect.tsx` (new).
Props `{ skill, lockSource?, onBack, onDelete? }`. Header: back button (`skills-section-inspect-back`), displayName, scope chip, `pluginName` when plugin-scoped, `filePath`. Body: `parseSkillContent(skill.content)` — frontmatter in a lightly separated block above the body, both in `<pre className="whitespace-pre-wrap …">` (D5). Root testid `skills-section-inspect`. No edit affordance anywhere.
Verify: T25's inspect case passes.

**T33. CLI suggestion row.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsCliSuggestion.tsx` (new).
One `text-caption text-muted-foreground` row at the top of the section: "Add skills from the registry with the skills CLI." + the command `npx skills add <owner>/<repo> --skill <name> -a claude-code` + a copy button (`skills-section-cli-copy`, reusing `copyCommand` from `../copy-command`) + a dismiss button (`skills-section-cli-dismiss`). Never blocks, never errors.
Verify: T25's CLI cases pass.

**T34. Section orchestrator.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsSection.tsx` (new).
Composes T28–T33. Local state: `query`, `selectedId`, `pendingDeleteId`, `cliDismissed`. Renders, in order: the CLI suggestion (when `!available && !cliDismissed`), the search `Input` (`components/ui/input.tsx`, testid `skills-section-search`), then one of loading / `skills-section-unsupported` / `skills-section-error` + retry / `skills-section-empty` / `skills-section-no-results` / the list, or the inspect view when a skill is selected. Body height comes from the dialog's flex column — `flex-1 min-h-0 overflow-y-auto`, never a magic `max-h`.
Delete handler (keep under 50 lines; extract if it grows):
```
confirm → deleteSkill(port, adapterId, skill.id, projectPath)
  success → mfToast.success(`Deleted ${displayName}`); clear selection if it was the deleted skill
  failure → mfToast.error('Could not delete skill', { description: err.message })
  finally → bumpSkillsRevalidation(); clear pendingDeleteId
```
Confirmation uses `components/ui/confirm-dialog.tsx` with `destructive`, `testid="skills-delete-confirm"`, title naming the skill, body stating that `<skillDirectory(skill)>` will be removed from disk, plus (when lockfile-managed) that the entry remains in `skills-lock.json`.
Toasts come from `mfToast` in `@/lib/toast`, **not** sonner directly.
Verify: `… vitest run src/features/setup-advisor/skills/__tests__/SkillsSection.test.tsx` green; `wc -l` on every new file under 300.

---

## Cross-cutting verification (end of implementation)

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean (typecheck includes test files).
2. `pnpm --filter @qlan-ro/mainframe-ui test` — green.
3. `git diff --stat main...HEAD -- packages/ui/src/features/setup-advisor/SetupAdvisorSheet.tsx packages/ui/src/features/setup-advisor/CategoryTabs.tsx packages/ui/src/features/setup-advisor/RecommendationRow.tsx packages/ui/src/features/setup-advisor/EvidenceDisclosure.tsx packages/ui/src/features/setup-advisor/use-setup-advisor-store.ts` — **empty**. The recommendations body, its category strip, its rows, and its data store are untouched.
4. `grep -rn 'automation-recommender-' packages/ui/src --include=*.tsx | wc -l` — the six existing occurrences still present, unchanged.
5. `find packages/ui/src/features/setup-advisor -name '*.tsx' -o -name '*.ts' | xargs wc -l | awk '$1 > 300'` — no output.
6. `pnpm changeset` file present.

## Acceptance-criteria trace

| AC | Tasks |
|---|---|
| Top-level section nav; toolbar opens on Recommendations; existing testid unchanged | T11, T12, T13, T15–T19 |
| All current advisor behavior + testids preserved | T12, T18, cross-cutting checks 3–4 |
| List / group by scope / search, incl. a pre-send draft with a project | T22, T24, T25, T26, T28, T31 |
| Inspect shows name, description, scope/source, body; no create or edit | T23, T25, T27, T32 |
| Delete behind a naming confirmation; all three surfaces refresh | T1–T10, T25, T34 |
| Plugin-scoped and command-derived entries have no delete affordance | T22, T25, T26, T30 |
| Failed delete gives visible feedback and refetches (no optimistic removal) | T25, T34 |
| Sidebar tab stays read-only and links into the section | T14, T20 |
| No-skills adapter / unknown adapter resolve to a defined state | T24, T25, T28 |
| Stable id-keyed testids; component tests cover every flow | T22–T25, T30–T34 |
| No new or changed daemon endpoints | Nothing under `packages/core-rs` is touched by any task |
| Files < 300 lines, functions < 50 | Cross-cutting check 5; the decomposition in T16/T17 and T30–T34 |

## Risks

- **R1 — the `npx skills` addendum is only partially satisfiable.** See D1. If the user wants a real installed-CLI probe, it needs a Tauri exec command or a daemon capability route, both of which the acceptance criteria currently forbid. Surface this before implementation.
- **R2 — the unsupported-adapter check is a string match.** `ApiRequestError` drops the HTTP status, so D6 pins the daemon's constant by value. If the daemon reworks that message the section degrades to a generic error, not a crash. A follow-up could add `status` to `ApiRequestError`; out of scope here.
- **R3 — `mock-cli` can list but not delete** (`routes/skills.rs:64` vs `:165`). Under a mock-adapter session the delete affordance appears and the request returns HTTP 500 `Operation failed`, which the UI surfaces as a toast. Per D8 and the brief this is accepted, not fixed.
