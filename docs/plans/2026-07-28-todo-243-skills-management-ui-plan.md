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
| List route serves `claude` **and** `mock-cli`; delete route is Claude-only, and a non-Claude delete short-circuits to **HTTP 404** `Adapter not found or does not support skills` before any filesystem work — not to a 500 | `routes/skills.rs:64-68` (list `match adapter.id()`) vs `:26-31` (`claude_supported` requires `a.id() == "claude"`) + `:165-167` (the gate returns `NOT_SUPPORTED`) |
| Unsupported-adapter response is HTTP 404 with the exact body `Adapter not found or does not support skills` | `routes/skills.rs:24` `NOT_SUPPORTED` + `fail(StatusCode::NOT_FOUND, NOT_SUPPORTED)` |
| Delete failures surface **unevenly**. The plugin refusal and an unresolvable skill id return HTTP 500 `Operation failed`; a filesystem failure returns HTTP 200 `{"success":true}`, because `delete_skill` discards the removal result | `routes/skills.rs:175-181` (the 500 path) vs `crates/mainframe-adapter-claude/src/skills.rs:398-415` — `let _ = fs::remove_dir_all(&skill_dir).await; Ok(())` at `:413` swallows EACCES and a partially-completed recursive removal alike |
| Delete resolves the id against the daemon's own scan and removes `filePath`'s **parent directory** | `crates/mainframe-adapter-claude/src/skills.rs:398-415` |
| Command-derived entries are `.claude/commands/<group>/<cmd>.md` — deleting one would `remove_dir_all` the whole group | `skills.rs:233-284` (scan) + `:408-413` (delete) |
| Skill ids are `claude:<scope>:[<plugin>:]<name>` — they contain `:` | `skills.rs:204-208` |
| `deleteSkill` client wrapper does **not** exist; only `getSkills` does | `packages/ui/src/lib/api/skills.ts` (10 lines, one export) |
| `ApiRequestError` carries `message` + `details` but **not** the HTTP status, although `extractError` has `res.status` in both of its return paths | `packages/ui/src/lib/api/http.ts:51-58` (class), `:77-87` (`extractError`) |
| `apiBase(port)` **ignores** its `port` argument and returns the active daemon's `baseUrl` | `packages/ui/src/lib/api/http.ts:11-13` |
| `DialogHeader` is `flex flex-col gap-1.5` — a sibling appended next to `DialogTitle` stacks *below* it, it does not sit beside it | `packages/ui/src/components/ui/dialog.tsx:71-72` |
| `DialogTitle` inside the advisor header is already `flex items-center gap-2` and holds the icon, the title, and the truncating project name | `packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx:75-81` |
| `ConfirmDialog` has exactly one consumer, mounted at app root behind the `use-git-confirm` bridge; `body` is `string \| undefined` rendered as a single `<p>` | `packages/ui/src/components/ui/confirm-dialog.tsx:4-14,38`, `packages/ui/src/app/AppShell.tsx:194`, `packages/ui/src/features/git/GitConfirmDialog.tsx` |
| Three different `CHIP_BASE` class strings already exist, all module-private | `layout/MainToolbar.tsx:36`, `features/sessions/filter/TagFilterBar.tsx:43`, `features/automations/steps/agent/ChipButton.tsx:14` |
| Nothing in the repo references `skills-lock.json` (`grep -rn 'skills-lock'` over the worktree, excluding `node_modules`/`target`, returns nothing) | absence of evidence — the reason D1 no longer plans against it |
| Three independent skill fetchers, each a mount effect, no shared store | `features/skills/use-chat-skills.tsx:60-103`, `features/context-panel/use-sidebar-skills.ts:28-62`, (new) section hook |
| The advisor nav store is a bare open/close flag | `features/setup-advisor/use-setup-advisor.ts` |
| **Trap:** the toolbar wires `onClick={openSetupAdvisor}` — the click event becomes the first argument | `layout/MainToolbar.tsx:239-243` |
| Existing advisor testids all use the `automation-recommender-*` prefix | `SetupAdvisorHost.tsx:71`, `CategoryTabs.tsx:37`, `EvidenceDisclosure.tsx:20`, `RecommendationRow.tsx:90`, `SetupAdvisorSheet.tsx:36,51` |
| Segmented-control recipe to copy | `features/tasks/TasksBoard.tsx:93-115` |
| Canonical daemon-switch reset + its test | `features/daemon/reset-daemon-scoped-stores.ts`, `features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` |

## Decisions taken in this plan

Each deviates from, or resolves an ambiguity in, the brief. All are recorded in the lane result.

- **D1 — `npx skills` CLI detection is not implemented at all; the section ships only the always-safe half, a static dismissible suggestion row.** The brief's 2026-07-27 addendum asks the section to "use the `npx skills` CLI where it is available. Detect it." **The app has no way to run a process from the renderer**: `packages/app-tauri/src-tauri/src/lib.rs:97-133` registers no shell/exec command, and the acceptance criteria forbid new daemon endpoints. An earlier draft of this plan proposed detecting the CLI by reading a `skills-lock.json` at the project root, but **that contract is uncited**: nothing in this repo references such a file, and the plan had no evidence for its name, its location, its shape, or the assumption that its keys equal skill directory names. Planning file parsing against an unverified external format is how a section ships a feature that silently never activates. So detection is cut: no lockfile read, no `via skills CLI` source line, no lockfile clause in the delete confirmation. What ships is `SkillsCliSuggestion` (T33) — one dismissible row naming the install command, correct whether or not the CLI is present. **Real detection stays blocked on the R1 user ruling**: it needs either a Tauri exec command, a daemon capability route, or a citation for the lockfile contract, and all three are out of scope here.
- **D2 — new testids use the `setup-advisor-*` / `skills-section-*` prefixes**, not `automation-recommender-*`. The old prefix is a legacy name for the recommendations body; the AC only requires that existing testids not change, and they do not.
- **D3 — the report still fetches on the open rising edge even when a caller opens straight onto `Skills`.** Keeps `SetupAdvisorHost`'s existing effect and all of its tests unchanged; the cost is one report fetch the user may not look at, which the advisor already pays on every open.
- **D4 — scope handling is grouping, not a filter control.** The AC reads "filter/group by scope"; grouped `SectionHeader` blocks satisfy it with one less control, and the design direction names `section-header.tsx` for exactly this.
- **D5 — the inspect view renders raw content in a `<pre>`, no markdown renderer, no `React.lazy`.** The design says lazy-load *if* it pulls a heavy renderer in; not pulling one in is strictly better and keeps the file small.
- **D6 — "adapter has no skills support" is detected by HTTP status, not by matching the daemon's error string.** `routes/skills.rs` returns `404` for exactly one reason — `NOT_SUPPORTED` — so `err.status === 404` is as precise as the string match and survives a message reword. The three-line boundary fix (`readonly status` on `ApiRequestError`, set from `res.status` in both `extractError` paths) lives inside `packages/ui`; the alternative was a cross-repo string constant that no test could meaningfully guard, since a test comparing a UI literal to itself cannot fail for the reason it claims to.
- **D7 — the revalidation nonce is bumped by `resetDaemonScopedStores`, not reset to 0.** Two reasons, both mechanical: setting `0` when the nonce is already `0` writes no new value, so the effect dep never changes and no refetch happens — the common case, since most sessions never bump. And `apiBase()` ignores its `port` argument (`packages/ui/src/lib/api/http.ts:11-13`), so switching daemons can leave `[port, adapterId, projectPath]` byte-identical while the base URL underneath changes; the bump is then the only thing that forces the refetch. This is how the new store "joins the daemon-scoped reset" per the brief.
- **D9 — the delete confirmation is a `ConfirmDialog` nested inside the advisor's Radix `Dialog`, deliberately, and not routed through the app-root outlet.** The codebase's one existing consumer sits at app root behind the `use-git-confirm` bridge (`AppShell.tsx:194`), so this is new ground. Nesting is chosen because the confirmation is owned by, and meaningless outside, the section that raises it; the bridge exists for git actions fired from many surfaces, and copying it would add a store and an outlet for one call site. Radix dismisses only the topmost layer, so the advisor should survive the inner dialog — T25 asserts that after both confirm and cancel rather than assuming it (R4).
- **D10 — `SkillsSection` holds the selected `Skill` object, not a selected id it re-derives from the list — but the hold is scoped to one identity.** Re-deriving breaks on any refetch that empties the list first (the `use-sidebar-skills.ts:35-38` clear-before-fetch pattern this hook copies): a failed delete raised from the inspect view bumps the nonce, the list goes empty mid-flight, and `skills.find(...)` returns `undefined` under a view that is still mounted. Holding the object makes the inspect view independent of *fetch state*. It must **not** make it independent of *identity*: switching project or adapter with the inspect view open is a supported path in the surface this plan extends (`SetupAdvisorHost.tsx:41-56` clears and refetches on exactly that), and skill ids are project-independent (`claude:<scope>:<name>`, `skills.rs:204-208`), so a held selection from project A plus a `remove(skill.id)` closed over project B's `projectPath` resolves and deletes a same-named skill in **B**. So `selected` and `pendingDelete` both reset when the hook's `identityKey` changes (T28, T34), and T25 covers it with the inspect view open and with the confirm open. The residual cost is unchanged: within one identity, a skill deleted elsewhere stays readable until Back — acceptable for a read-only view over content the user just had open.
- **D8 — the delete affordance is gated by scope and backing file only, not by adapter id.** The delete route is Claude-only, but the brief puts the list/delete adapter-gating difference explicitly out of scope, and gating the button on `adapterId === 'claude'` would silently remove it under `mock-cli`.

## Architecture

```
packages/ui/src/
  lib/api/http.ts                                    (M) ApiRequestError.status
  lib/api/skills.ts                                  (M) + deleteSkill
  components/ui/chip-classes.ts                      (N) shared chip class string
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
      use-skills-section.ts                          (N) list fetch + delete + discriminated status
      skill-filters.ts                               (N) pure: search, grouping, deletability
      skill-content.ts                               (N) pure: frontmatter/body split
  layout/MainToolbar.tsx                             (M) fix openSheet call site, import chip class
```

Task numbers are stable identifiers, not an ordering: T29 was cut (D1) and T35–T37 were added by the review round, each placed inside the group it belongs to. Every reference in this document resolves; no task was renumbered.

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

**T35. Test that `ApiRequestError` carries the HTTP status.**
File: `packages/ui/src/lib/api/__tests__/http-envelope.test.ts` (extend).
Add a `describe('ApiRequestError.status')` covering: a `404` whose JSON body is `{error: 'Adapter not found or does not support skills'}` rejects with `status === 404` and that message; a `500` with a non-JSON body rejects with `status === 500` and the `HTTP 500` fallback message (the second `extractError` return path); the existing `details` behavior is unchanged. Do not assert anything about the `{success:false}` envelope path — it throws a bare `Error` by design and keeps doing so.
Verify: `… vitest run src/lib/api/__tests__/http-envelope.test.ts` — the new cases fail (`status` is not a property).

### Group B — implementation: delete wrapper, revalidation seam, two boundary fixes

Also lands `ApiRequestError.status` (T36) and the shared chip class (T37). Both are consumed by Group F and one of them edits `MainToolbar.tsx`, which Group D also edits — hence `parallel_safe: no` on both groups and the ordering edge B → D.

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
Add `bumpSkillsRevalidation()` to `resetDaemonScopedStores`, with a one-line comment giving the accurate reason it is bumped rather than zeroed (D7): *"Bumped, not zeroed — zeroing an already-0 nonce changes no dep, and `apiBase()` ignores `port`, so a daemon switch can leave every other dep identical."* Do not write the earlier draft's claim about consumers "not re-running in dep order"; `Object.is` dep comparison re-runs on any changed value, including `1 → 0`.
Verify: T5 passes.

**T36. Give `ApiRequestError` its HTTP status.**
File: `packages/ui/src/lib/api/http.ts`.
Add `readonly status: number` to the class, take it as the last constructor parameter (`status = 0`), and pass `res.status` from both `extractError` return paths (`:82` and `:86`). `status: 0` means "not from an HTTP response" and covers the two existing test-only constructions in `features/automations/editor/__tests__/`, which stay valid unchanged. Extend the class doc comment with one sentence on why the status is kept: callers classify a rejection by status, not by re-matching the daemon's prose (D6).
Verify: T35 passes; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/http-envelope.test.ts src/features/automations/editor/__tests__/save-issues.test.ts` green.

**T37. Extract the shared chip class string.**
Files: `packages/ui/src/components/ui/chip-classes.ts` (new), `packages/ui/src/layout/MainToolbar.tsx`.
`SkillRow` (T30) needs MainToolbar's chip recipe verbatim, which would make it the **fourth** divergent `CHIP_BASE` in the package (`MainToolbar.tsx:36`, `TagFilterBar.tsx:43`, `ChipButton.tsx:14`) — the case the project's "extract shared helpers at 3+ duplications" rule names. Move MainToolbar's string into `chip-classes.ts` as `export const CHIP_BASE`, delete the local const, and import it at both of MainToolbar's use sites (`:183`, `:202`). Do **not** touch `TagFilterBar` or `ChipButton`: their `CHIP_BASE` constants are different recipes (different height, radius, typography), and collapsing them is a visual change this todo has no mandate for. The new file is a class-string module — no React, no JSX.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/MainToolbar.test.tsx` green; `grep -c 'CHIP_BASE =' packages/ui/src/layout/MainToolbar.tsx` is `0`.

### Group C — red tests: section nav + entry points

Runs **after** Group F: T12 does `vi.mock('../skills/SkillsSection')`, and an unresolvable mock path errors the whole file, so a red run against a missing module would prove nothing about section routing.

**T11. Test the nav store's section dimension.**
File: `packages/ui/src/features/setup-advisor/__tests__/use-setup-advisor.test.ts` (new).
Cover: default state is `{open: false, section: 'recommendations'}`; `openSheet()` with **no argument** opens on `recommendations`; `openSheet('skills')` opens on `skills`; `openSheet(someNonSectionValue as never)` still lands on `recommendations` (guards the `onClick={openSheet}` event-argument trap); `setSection('skills')` while open changes only the section; `closeSheet()` closes and leaves the section as-is.
Verify: `… vitest run src/features/setup-advisor/__tests__/use-setup-advisor.test.ts` — fails.

**T12. Test the host's section routing.**
File: `packages/ui/src/features/setup-advisor/__tests__/SetupAdvisorHost.section.test.tsx` (new).
Mock `@/lib/api/setup-advisor`, `@/features/sessions/use-active-identity`, `../SetupAdvisorSheet`, and `../skills/SkillsSection` (stub) — same style as the existing `SetupAdvisorHost.test.tsx`. Cover: opening via `openSheet()` renders the recommendations stub and not the skills stub; clicking `setup-advisor-section-skills` swaps bodies and keeps the dialog open; `openSheet('skills')` lands on the skills body directly; `aria-pressed` tracks the active segment; the report fetch still fires exactly once on the open rising edge **regardless of section** (D3); `automation-recommender-sheet` is still the `DialogContent` testid.
Add a **layout** case, because testid presence and `aria-pressed` cannot catch a switcher that stacks below the title instead of sitting beside it: assert `setup-advisor-header-row` exists, that its `className` contains both `flex` and `items-center` (it must not be the `flex-col` `DialogHeader`), and that it is the common parent of the dialog title and the switcher — `const row = screen.getByTestId('setup-advisor-header-row')` then `expect(row).toContainElement(screen.getByTestId('setup-advisor-section-skills'))` and the same for the title node.
Verify: fails (host does not render a switcher).

**T13. Test the toolbar entry point.**
File: `packages/ui/src/layout/__tests__/MainToolbar.test.tsx` (extend).
Add: clicking `automation-recommender-open` leaves `useSetupAdvisor.getState().section === 'recommendations'` — i.e. the click event is not forwarded as the section argument.
Verify: fails until T19.

**T14. Test the sidebar link.**
File: `packages/ui/src/features/context-panel/__tests__/SkillsList.test.tsx` (extend).
Add: `sidebar-skills-manage` renders in both the populated and empty states; clicking it sets the nav store to `{open: true, section: 'skills'}`; the list still renders no delete affordance (`queryAllByTestId(/^sidebar-skill-delete/)` is empty).
Verify: fails.

### Group D — implementation: advisor shell (runs last; imports `SkillsSection` from Group F, shares `MainToolbar.tsx` with Group B)

**T15. Add the section dimension to the nav store.**
File: `packages/ui/src/features/setup-advisor/use-setup-advisor.ts`.
```ts
export type AdvisorSection = 'recommendations' | 'skills';
```
State becomes `{ open, section, openSheet(section?), setSection(section), closeSheet() }`. `openSheet` normalizes its argument: anything that is not the literal `'skills'` resolves to `'recommendations'` (defends the `onClick` trap even after T19). Keep the file's existing header comment and extend it with the section rationale.
Verify: T11 passes.

**T16. Build the header segmented control.**
File: `packages/ui/src/features/setup-advisor/SectionSwitcher.tsx` (new).
Props `{ section: AdvisorSection; onSelect: (s: AdvisorSection) => void; className?: string }` — `className` is required for T17 to push the control right (`cn('flex items-center gap-0.5 …', className)` on the root); without it T17's `<SectionSwitcher className="ml-auto" />` is a typecheck error. Copy the enclosed-track recipe from `features/tasks/TasksBoard.tsx:93-115`: outer `flex items-center gap-0.5 rounded-[6px] bg-muted p-0.5`; each button `px-2 py-1 rounded text-label transition-colors` with `aria-pressed`, active `bg-background text-foreground shadow-sm`, inactive `text-muted-foreground hover:text-foreground`. Testids `setup-advisor-section-recommendations` and `setup-advisor-section-skills`. No icons — the two labels are the whole control. Read the `mainframe-design-system` skill first.
Verify: covered by T12; file under 60 lines.

**T17. Extract the dialog header.**
File: `packages/ui/src/features/setup-advisor/SetupAdvisorHeader.tsx` (new).
Moves the existing `DialogHeader`/`DialogTitle` block out of `SetupAdvisorHost.tsx:74-81` — `ScanSearch` icon, "Setup Advisor", the truncated project name, and the `pr-9` comment — and puts the switcher **beside** the title. `DialogHeader` is `flex flex-col gap-1.5` (`components/ui/dialog.tsx:71-72`), so a `SectionSwitcher` appended as a sibling of `DialogTitle` would stack *below* it and `ml-auto` would do nothing. Name the row instead:

```tsx
<DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-9">
  {/* pr-9 clears the dialog's built-in close button (26px at right-3). */}
  <div data-testid="setup-advisor-header-row" className="flex items-center gap-2">
    <DialogTitle className="flex min-w-0 items-center gap-2 text-heading font-bold">…</DialogTitle>
    <SectionSwitcher className="ml-auto shrink-0" section={section} onSelect={onSelectSection} />
  </div>
</DialogHeader>
```

The `DialogHeader` className stays exactly `shrink-0 border-b border-border px-4 py-3 pr-9`; `min-w-0` on the title is what keeps the project name truncating now that it shares a row. Props: `{ projectName, section, onSelectSection }`.
Verify: T12's layout case and its "existing chrome unchanged" assertions pass.

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

These tests mock `@/lib/api/skills` wholesale with a factory (`{ getSkills, deleteSkill }`), so they never hit the network. They do, however, import the **real** `use-skills-revalidation` store (T7) and `ApiRequestError`'s `status` (T36) to assert the refetch and the 404 classification, so this group runs **after** Group B, not beside it. They must still be observed failing before Group F.

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
Mock `@/lib/api/skills`, `@/features/sessions/use-active-identity`, `@/features/sessions/runtime/daemon-port-context`. Use the **real** `use-skills-revalidation` store. Cover the state machine: no `projectPath` → no fetch and `status: 'empty'`; a missing `adapterId` falls back to `'claude'`; a present `adapterId` is used verbatim; an in-flight fetch is `status: 'loading'`; a resolved empty array is `status: 'empty'`, a non-empty one `status: 'ready'` carrying the skills; a rejection with `status === 404` yields `status: 'unsupported'` (D6); a rejection with any other status, or a non-`ApiRequestError`, yields `status: 'error'` with the message; `bumpSkillsRevalidation()` triggers a refetch; a project switch clears the previous list before the new response lands (no cross-project flash); a late response from a superseded fetch is ignored.
Also cover `identityKey`: it is stable across a refetch of the same identity (a nonce bump does not change it) and differs after an `adapterId` change and after a `projectPath` change — T34 keys the selection reset on it (D10).
Then cover `remove(skillId)`: it calls `deleteSkill(port, adapterId, skillId, projectPath)`; on success it resolves and the nonce strictly increases (assert the real store); on rejection it **rejects with the daemon's message** and the nonce still strictly increases (refetch, not optimistic removal).
Do **not** assert that any exported constant equals a hardcoded copy of itself — the earlier draft's `UNSUPPORTED_ERROR` check could not fail for the reason it claimed to guard.
Verify: fails.

**T25. Test the section component.**
File: `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.test.tsx` (new).
Mock `../use-skills-section` (returning a `{state, reload, remove}` fixture) and `@/lib/toast`. The component no longer imports `@/lib/api/skills`, so nothing else needs mocking. Cover, one `it` each:
- **list** — one row per skill, testid `skills-section-row-<skill.id>`; scope group headers `skills-section-group-project` / `-global` / `-plugin` in that order.
- **search** — typing in `skills-section-search` narrows by name and by description; a no-match query shows `skills-section-no-results`, distinct from the empty state.
- **empty** — `status: 'empty'` renders `skills-section-empty` with "No skills for this project yet" and no error styling.
- **unsupported** — `status: 'unsupported'` renders `skills-section-unsupported` ("This adapter has no skills") and no list, no error.
- **error** — `status: 'error'` renders `skills-section-error` with a `skills-section-retry` button that calls `reload`.
- **inspect** — clicking a row opens `skills-section-inspect` showing displayName, description, scope, and the raw body; a plugin-scoped skill additionally shows its `pluginName`; `skills-section-inspect-back` returns to the list.
- **delete affordance gating** — `skills-section-delete-<id>` is present for a project-scope SKILL.md skill, present for a global one, and **absent** (not disabled) for plugin-scoped and command-derived entries.
- **delete confirm** — clicking delete opens `skills-delete-confirm`; its **title** contains the skill's display name and its **body** is one sentence containing the skill's on-disk directory. `ConfirmDialog.body` is a single `string` rendered as one `<p>` (`components/ui/confirm-dialog.tsx:7,39`), so the name lives in the title and the directory in the body — one slot each, matching T34's exact strings. Cancel closes the confirm and calls `remove` zero times.
- **delete success** — confirming calls `remove(skill.id)`, fires `mfToast.success`, and closes the inspect view when the deleted skill was the open one.
- **delete failure from the inspect view** — open skill A, delete, `remove` rejects with `Operation failed`: `mfToast.error` fires with that message, the confirm closes, and **the inspect view is still rendered showing A's fields** even when the hook fixture's next render returns `status: 'loading'` with no skills. This is the D10 regression guard — a component that re-derived the selection from the list would render undefined fields or throw here. (`Operation failed` is the daemon's real 500 body for a delete whose id no longer resolves in its scan, `routes/skills.rs:175-181` — the failure D10's stale-selection window actually produces. It is **not** what `mock-cli` returns; that path is a 404, see R3. The hook is mocked here either way, so the string is a fixture, not a contract.)
- **identity switch with a selection held** (D10) — render with the inspect view open, then re-render with the hook fixture returning a different `identityKey` (once for an `adapterId` change, once for a `projectPath` change): the section is back on the list, `skills-section-inspect` is gone. Repeat with `skills-delete-confirm` open: the confirm is gone and, after the switch, `remove` has still been called zero times — a confirm raised against project A must not be confirmable against B, whose `remove` closes over B's `projectPath` while skill ids are project-independent.
- **advisor survives the nested confirm** (D9) — after confirming, and again after cancelling, `automation-recommender-sheet` is still mounted and the section is still rendered. Render the section inside a stub `Dialog` to reproduce the nesting.
- **CLI suggestion** — `skills-section-cli-suggestion` renders by default with a `skills-section-cli-copy` and a `skills-section-cli-dismiss`; dismissing removes the row and it stays gone across a re-render. No lockfile, no `available` flag (D1).
- **testid stability** — two skills whose array order is swapped keep their id-keyed testids.
If the file passes 300 lines, split the delete and confirm cases into `SkillsSection.delete.test.tsx` rather than letting it grow.
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
export type SkillsSectionState =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; skills: Skill[] };

export function useSkillsSection(): {
  state: SkillsSectionState;
  identityKey: string;
  reload: () => void;
  remove: (skillId: string) => Promise<void>;
};
```
One discriminated `status` instead of three independent booleans: `{loading, error, unsupported}` permits combinations that cannot happen (an error *and* unsupported) and forces the component into a six-way boolean chain. The hook also owns the delete, so identity never leaves it — `remove` is why `adapterId`, `projectPath`, `projectId` and `port` are **not** returned and why the component does not import `@/lib/api/skills` at all.

`identityKey` is the one identity fact that *does* leave the hook: an opaque `` `${adapterId} ${projectPath ?? ''}` `` that changes whenever the fetch key does. It exists so `SkillsSection` can drop a selection that belongs to the previous project or adapter (D10, T34) without subscribing to `useActiveIdentity` a second time and without gaining a raw `projectPath` it could pass to an API. Nothing formats or parses it.

Reads `useDaemonPort()` + `useActiveIdentity()`; adapter falls back to `'claude'`. Effect keyed on `[port, adapterId, projectPath, nonce, reloadSeq]`, with the `cancelled` flag and the clear-before-fetch pattern already used by `use-sidebar-skills.ts:35-38`. Classify a rejection as `'unsupported'` when `err instanceof ApiRequestError && err.status === 404` (D6, T36) — `routes/skills.rs` returns 404 for exactly one reason; anything else is `'error'` with `err.message`. `reload()` bumps a local seq. `remove(id)` calls `deleteSkill(port, adapterId, id, projectPath)`, bumps the revalidation nonce in a `finally`, and re-throws on failure so the caller can toast the daemon's message. Catch logs via `console.warn('[skills-section] …')`, matching the sibling hooks' desktop convention.
Verify: T24 passes.

**T29 — cut.** This was the `skills-lock.json` probe (`use-skills-cli.ts`). Removed with D1: the lockfile contract is uncited, so the section ships no CLI detection and T33's suggestion row is unconditional. Nothing references T29; the number is retired, not reused.

**T30. Row component.**
File: `packages/ui/src/features/setup-advisor/skills/SkillRow.tsx` (new).
Props `{ skill, onOpen, onDelete? }`. Layout per the design direction: name · `invocationName` in `font-mono text-caption text-mf-text-3` · scope chip · `pluginName` when `scope === 'plugin'`. The scope chip imports `CHIP_BASE` from `@/components/ui/chip-classes` (T37) — do **not** restate the class string locally; that would be the fourth copy in the package. Testids `skills-section-row-<skill.id>` and `skills-section-delete-<skill.id>`; the delete button renders only when `onDelete` is provided. Read the `mainframe-design-system` skill before writing classes.
Verify: T25's list/gating cases pass.

**T31. Grouped list.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsSectionList.tsx` (new).
Maps `groupByScope(filtered)` to `SectionHeader` (`components/ui/section-header.tsx`, sentence-case captions — never a hand-rolled uppercase eyebrow) + rows. Testid `skills-section-group-<scope>` on each group. Owns no state.
Verify: T25's grouping case passes.

**T32. Inspect view.**
File: `packages/ui/src/features/setup-advisor/skills/SkillInspect.tsx` (new).
Props `{ skill, onBack, onDelete? }`. Header: back button (`skills-section-inspect-back`), displayName, scope chip, `pluginName` when plugin-scoped, `filePath`. Body: `parseSkillContent(skill.content)` — frontmatter in a lightly separated block above the body, both in `<pre className="whitespace-pre-wrap …">` (D5). Root testid `skills-section-inspect`. No edit affordance anywhere.
Verify: T25's inspect case passes.

**T33. CLI suggestion row.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsCliSuggestion.tsx` (new).
One `text-caption text-muted-foreground` row at the top of the section: "Add skills from the registry with the skills CLI." + the command `npx skills add <owner>/<repo> --skill <name> -a claude-code` + a copy button (`skills-section-cli-copy`, reusing `copyCommand` from `../copy-command`) + a dismiss button (`skills-section-cli-dismiss`). Renders unconditionally until dismissed — there is no availability flag to gate it on (D1). Never blocks, never errors.
Verify: T25's CLI cases pass.

**T34. Section orchestrator.**
File: `packages/ui/src/features/setup-advisor/skills/SkillsSection.tsx` (new).
Composes T28 and T30–T33. Local state: `query`, `selected: Skill | null`, `pendingDelete: Skill | null`, `cliDismissed`.

**Selection holds the `Skill` object, never an id re-derived from the list (D10).** `state.skills` is empty during every in-flight refetch (clear-before-fetch), including the one a *failed* delete triggers, so a `skills.find(s => s.id === selectedId)` under a mounted inspect view resolves to `undefined` and renders undefined fields or throws. The inspect view reads `selected` directly and is therefore independent of `state`.

**But it is not independent of identity.** Both `selected` and `pendingDelete` reset when the hook's `identityKey` changes:
```ts
useEffect(() => {
  setSelected(null);
  setPendingDelete(null);
}, [identityKey]);
```
Without this, switching project or adapter with the dialog open leaves project A's skill rendered under project B's header, and confirming the pending delete calls `remove(skill.id)` against B — skill ids carry no project (`claude:<scope>:<name>`), so a same-named skill in B resolves and its directory is removed. `identityKey` comes from T28; do not read `useActiveIdentity()` here for it.

Renders, in order: the CLI suggestion (when `!cliDismissed`), the search `Input` (`components/ui/input.tsx`, testid `skills-section-search`), then — when `selected` is null — one branch of `state.status`: `'loading'` / `'unsupported'` / `'error'` + retry / `'empty'` / `'ready'` (with `skills-section-no-results` when the query filters everything out); when `selected` is set, the inspect view instead. Body height comes from the dialog's flex column — `flex-1 min-h-0 overflow-y-auto`, never a magic `max-h`.

Delete handler (keep under 50 lines; extract if it grows) — the nonce bump lives in the hook's `remove`, not here:
```
confirm → try { await remove(skill.id) }
  success → mfToast.success(`Deleted ${skill.displayName}`); if (selected?.id === skill.id) setSelected(null)
  failure → mfToast.error('Could not delete skill', { description: err.message })   // selection untouched
  finally → setPendingDelete(null)
```
Confirmation uses `components/ui/confirm-dialog.tsx` with `destructive` and `testid="skills-delete-confirm"`. `ConfirmDialog` exposes exactly two text slots — a `title` and a `body` that is a single `string` rendered as one `<p>` (`confirm-dialog.tsx:7,39`) — so the skill's name goes in the title and its directory in the body, and neither string repeats the other:
- `title`: `` `Delete ${skill.displayName}?` ``
- `body`: `` `Deletes ${skillDirectory(skill)} from disk. This cannot be undone.` ``

T25 asserts this split (name in the title, directory in the body). Do not change the shared primitive.
This nests a `Dialog` inside the advisor's `Dialog` — deliberate, see D9; T25 asserts the advisor survives both outcomes.
Toasts come from `mfToast` in `@/lib/toast`, **not** sonner directly.
Verify: `… vitest run src/features/setup-advisor/skills/__tests__/SkillsSection.test.tsx` green; `wc -l` on every new file under 300.

---

## Task groups

`parallel_safe` is a file-collision flag only; `depends_on` names the groups whose output this group reads, imports, or verifies. Two groups that share no files can still have a hard order.

| Group | Kind | Tasks | `parallel_safe` | `depends_on` | Why the edges exist |
|---|---|---|---|---|---|
| `api-seam-tests` | test | T1–T5, T35 | yes | — | Red phase; touches only its own test files. |
| `api-revalidation-impl` | ui | T6–T10, T36, T37 | **no** | `api-seam-tests` | Shares `layout/MainToolbar.tsx` with `advisor-shell-impl` (T37 moves `CHIP_BASE` out; T19 fixes the click handler). Turns its own red tests green. |
| `skills-section-tests` | test | T22–T25 | yes | `api-revalidation-impl` | T24 asserts a real `bumpSkillsRevalidation()` refetch and a `404` classification — both need T7 and T36 to exist, or the file cannot even import. |
| `skills-section-impl` | ui | T26–T28, T30–T34 | yes | `skills-section-tests`, `api-revalidation-impl` | Consumes `deleteSkill` (T6), the nonce (T7), `ApiRequestError.status` (T36) and `chip-classes.ts` (T37). |
| `advisor-shell-tests` | test | T11–T14 | yes | `skills-section-impl` | T12 does `vi.mock('../skills/SkillsSection')`; an unresolvable mock path errors the whole file, so a red run against a missing module proves nothing about section routing. |
| `advisor-shell-impl` | ui | T15–T21 | **no** | `advisor-shell-tests`, `skills-section-impl`, `api-revalidation-impl` | Renders `SkillsSection`, shares `MainToolbar.tsx` with `api-revalidation-impl`. Runs last and carries the changeset (T21). |

**Coverage is exhaustive and must stay that way.** The six groups partition every live task exactly once: T1–T28 and T30–T37. **T29 is cut (D1) and belongs to no group** — an extraction that lists it sends an implementer to build the abandoned `skills-lock.json` probe. T35 (`ApiRequestError.status` test), T36 (`ApiRequestError.status`) and T37 (`chip-classes.ts`) are not optional extras: T28 classifies `unsupported` on `err.status === 404` and T30 imports `CHIP_BASE`, so `skills-section-impl` cannot compile without T36 and T37 having landed in `api-revalidation-impl`. Any re-extraction is checked against this paragraph before it is handed to implement.

---

## Cross-cutting verification (end of implementation)

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean (typecheck includes test files).
2. `pnpm --filter @qlan-ro/mainframe-ui test` — green.
3. `git diff --stat main...HEAD -- packages/ui/src/features/setup-advisor/SetupAdvisorSheet.tsx packages/ui/src/features/setup-advisor/CategoryTabs.tsx packages/ui/src/features/setup-advisor/RecommendationRow.tsx packages/ui/src/features/setup-advisor/EvidenceDisclosure.tsx packages/ui/src/features/setup-advisor/use-setup-advisor-store.ts` — **empty**. The recommendations body, its category strip, its rows, and its data store are untouched.
4. The two `automation-recommender-*` testids that live in **modified** files are still there (check 3 covers the other four source files by diffing them whole, so a package-wide `grep | wc -l` is the wrong instrument — the count is 39 across 10 files today and T12/T13 raise it on purpose):
   - `grep -c 'automation-recommender-sheet' packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx` → `1`
   - `grep -c 'automation-recommender-open' packages/ui/src/layout/MainToolbar.tsx` → `1`
5. `find packages/ui/src/features/setup-advisor \( -name '*.tsx' -o -name '*.ts' \) -not -path '*/__tests__/*' | xargs wc -l | awk '$1 > 300 && $2 != "total"'` — no output. Scoped to non-test sources and with the `wc` `total` line excluded: unscoped, the check fires on the `total` (1786) and on two pre-existing test files (`__tests__/SetupAdvisorSheet.test.tsx` 394, `__tests__/use-setup-advisor-store.test.ts` 314) that this todo does not touch. New test files still keep to the limit by splitting (T25).
6. `pnpm changeset` file present.

## Acceptance-criteria trace

| AC | Tasks |
|---|---|
| Top-level section nav; toolbar opens on Recommendations; existing testid unchanged | T11, T12, T13, T15–T19 |
| All current advisor behavior + testids preserved | T12, T18, cross-cutting checks 3–4 |
| List / group by scope / search, incl. a pre-send draft with a project | T22, T24, T25, T26, T28, T31 |
| Inspect shows name, description, scope/source, body; no create or edit | T23, T25, T27, T32 |
| Delete behind a naming confirmation; all three surfaces refresh | T1–T10, T24, T25, T34 |
| Plugin-scoped and command-derived entries have no delete affordance | T22, T25, T26, T30 |
| Failed delete gives visible feedback and refetches (no optimistic removal) | T24, T25, T34 — but see R5: a filesystem failure returns HTTP 200, so QA verifies against the refetched list, never the toast |
| A held selection never outlives the identity that produced it | T24 (`identityKey`), T25 (identity-switch cases), T28, T34 |
| Sidebar tab stays read-only and links into the section | T14, T20 |
| No-skills adapter / unknown adapter resolve to a defined state | T24, T25, T28, T35, T36 |
| Stable id-keyed testids; component tests cover every flow | T22–T25, T30–T34 |
| No new or changed daemon endpoints | Nothing under `packages/core-rs` is touched by any task |
| Files < 300 lines, functions < 50 | Cross-cutting check 5; the decomposition in T16/T17 and T30–T34 |
| No duplicated chip recipe (3+ duplications rule) | T37 |

## Risks

- **R1 — the `npx skills` addendum is not satisfiable as written, and this plan no longer pretends otherwise.** See D1: detection is cut, only the static suggestion row ships. A real probe needs a Tauri exec command, a daemon capability route, or a cited lockfile contract — all three out of scope under the current acceptance criteria. **Surface this to the user before implementation**; if they supply the `skills-lock.json` contract (name, location, shape), detection comes back as its own task with that citation in the ground-truth table.
- **R2 — resolved, not carried.** The unsupported-adapter check is an HTTP-status check, not a string match: T36 adds `status` to `ApiRequestError` (three lines inside `packages/ui`) and T28 classifies on `404`. A daemon message reword no longer degrades the section.
- **R3 — `mock-cli` can list but not delete, and it fails as a 404, not a 500** (`routes/skills.rs:64-68` vs `:26-31,165-167`). The delete handler gates on `claude_supported`, which requires `a.id() == "claude"`, so a `mock-cli` delete short-circuits to HTTP 404 `Adapter not found or does not support skills` before any filesystem work. Under a mock-adapter session the delete affordance still appears (D8) and the UI toasts that message: `remove` does not classify its rejection — only the *list* effect maps 404 to `'unsupported'` (T28) — so the daemon's prose reaches the toast verbatim. Per D8 and the brief this is accepted, not fixed. It is **not** the path T25's inspect-survives-failed-delete case stands for; that case fixtures the 500 an unresolvable id produces (see T25).
- **R5 — a delete that fails on the filesystem reports success.** `delete_skill` discards the removal result (`crates/mainframe-adapter-claude/src/skills.rs:413`: `let _ = fs::remove_dir_all(&skill_dir).await; Ok(())`), so EACCES, a read-only volume, or a partially-completed recursive removal all return HTTP 200 `{"success":true}`. The UI then fires `mfToast.success`, closes the inspect view, and the refetch puts the skill straight back. The AC still holds — the nonce bump is unconditional, so the displayed set stays consistent with the daemon — and no UI-side change can detect this, since the response carries no evidence. **What is wrong is the toast, and only the daemon can fix it**: `delete_skill` must propagate the `remove_dir_all` error (keeping `NotFound` as success, which is what the `force` comment on `:412` is actually about). That is a `packages/core-rs` change and out of scope here (AC: no daemon changes). **QA must not read a green toast as a completed delete** — confirm against the refetched list, not the toast.
- **R4 — the delete confirmation is the codebase's first nested `Dialog`** (D9). Radix dismisses only the topmost layer, so the advisor should stay open, but "should" is not evidence: T25 asserts it after both confirm and cancel. If those assertions fail, the fix is to route the confirmation through an app-root outlet the way `GitConfirmDialog` does, which adds a bridge store and a mount in `AppShell` — budget for that before assuming a one-line fix.
