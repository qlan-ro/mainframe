# Composer trigger pickers — `/`-skills + `@`-file-mentions (app-tauri)

**Date:** 2026-06-06 · **Status:** design (approved in brainstorm) · **Package:** `@qlan-ro/mainframe-app-tauri`

Closes the last desktop→app-tauri parity gap in the chat surface: the in-composer
context pickers. Desktop's composer let you type `/` for a skills picker and `@`
for a file-mention picker (`ContextPickerMenu.tsx`, placeholder "Type @ to search
files, / for skills…"). app-tauri's ported composer has neither (and the
`/skill` message chip shows a raw slug instead of the resolved name).

## Scope

**In scope**
- In-composer **`/` skills picker** — type `/`, pick a skill, it inserts `/<invocationName> ` for the user to add args and send.
- In-composer **`@` file-mention picker** — type `@`, fuzzy-search project files, pick one, it inserts `@<relpath> ` into the message text.
- **Skill chip name-resolution** in rendered user messages (`resolveSkillName`).

**Out of scope (deferred, tracked elsewhere)**
- A SkillsPanel surface and its out-of-band `pendingInvocation` injection (no such surface exists in app-tauri).
- Structured mention **registration** (`POST /api/chats/:id/mentions`) — see decision D2.
- The session-context **display** chip row (`UMContextRow`) that visualizes registered mentions.
- Agent (`@agent`) mentions, filesystem-path autocomplete (`@/`, `@~`), command (non-skill) entries — desktop had these in `ContextPickerMenu`; not required for this gap.

## Decisions

- **D1 — Native picker (`Unstable_TriggerPopover`).** Use assistant-ui's native trigger-popover subsystem (`ComposerPrimitive.Unstable_TriggerPopoverRoot` + per-char `Unstable_TriggerPopover`/`.Action`/`.Directive`/`.Items`/`.Item`), restyled to warm-chrome. This **reverses** the earlier note in `packages/app-tauri/CLAUDE.md` (composer section) that chose shadcn `Command` for `@`-mentions *because* the native trigger was `@alpha`. Per explicit user direction we adopt the native subsystem despite its `Unstable_` prefix. Risk accepted; mitigated by the pinned `@assistant-ui/* @0.14.14 / core @0.2.10` set. **Action:** update the CLAUDE.md composer pointer + the ASSISTANT-UI-INVENTORY verdict to record the reversal.
- **D2 — `@` insert text only.** On selecting a file, insert `@<relpath> ` into the composer text (so it travels in the sent message) and **do not** `POST /mentions`. The CLI/daemon parses `@paths` from the message text; structured `SessionMention` registration is deferred until the context-chips UI exists. (Desktop's fuzzy path also primarily did `setText('@<path> ')`.)
- **D3 — Project source = `chat.projectId`.** File search calls `GET /api/projects/:projectId/search/files?q=&limit=&chatId=` using `chatConfig.projectId` + the chat's id — the app-tauri equivalent of desktop's `searchFiles(activeProjectId, query, 30, activeChatId)`. Skills need the project **path**, resolved once via `getProjects()` (find by `projectId` → `.path`).
- **D4 — Per-chat `SkillsProvider`.** Skills are preloaded once per chat into plain React state (no Zustand — mirrors `useAdapters`), shared by the picker and the message chip. Accepts one extra `getProjects` round-trip per chat (cached in the provider).

## Architecture

### Data layer (`lib/api/`)
- `projects.ts` — `getProjects(port): Promise<Project[]>`.
- `skills.ts` — `getSkills(port, adapterId, projectPath): Promise<Skill[]>` → `GET /api/adapters/:adapterId/skills?projectPath=`.
- `files.ts` — `searchFiles(port, projectId, query, chatId?): Promise<FileResult[]>` where `FileResult = { name; path; type; exact }`.
- All use the existing app-tauri fetch/`ApiResponse` helpers + Zod-tolerant parsing already used by sibling clients.

### `features/skills/` provider
- `SkillsProvider` + `useChatSkills(): { skills: Skill[]; loading: boolean }`. Reads `useChatExtras()` for `port`, `chatConfig.adapterId`, `chatConfig.projectId`; resolves `projectId → path` (via `getProjects`), then `getSkills`; holds in `useState`; logs failures via `console.warn('[skills] …')`. Mounted inside `ChatThread` (within the runtime tree where `useChatExtras` resolves). Returns `[]` while loading / on error.

### Composer trigger wiring (`features/chat/composer/`)
- Wrap the composer subtree in `ComposerPrimitive.Unstable_TriggerPopoverRoot` (in `Composer.tsx`, outside `ComposerPrimitive.Root` per the native example).
- **`/` skills:** `<Unstable_TriggerPopover char="/" adapter={skillsAdapter}>` + `.Action onExecute removeOnExecute`. `skillsAdapter` (`buildSkillsTriggerAdapter(skills)`): one "Skills" category; `categoryItems`/`search` map `Skill → Unstable_TriggerItem { id, type:'skill', label: displayName||name, description }` and filter in-memory. On execute, insert `/<invocationName ?? name> `.
- **`@` files:** `<Unstable_TriggerPopover char="@" adapter={fileAdapter}>` + `.Directive`. **Async-over-sync:** the native adapter methods are synchronous, but file search is async — so a debounced effect (keyed on the active `@` query, read from the trigger scope context) fetches `searchFiles` into a results-cache `Map<query, FileResult[]>`; `fileAdapter.search`/`categoryItems` read the cache synchronously (popover shows the last settled results until the new fetch resolves). On select, insert `@<relpath> ` (D2).
- **Insertion serialization (implementation risk):** the inserted token MUST serialize to literal `/<skill>` / `@<relpath>` in the sent message (the CLI reads raw text). Verify whether `.Action`/`.Directive` + the default directive formatter yields literal text, or whether an explicit `composer().setText`/formatter is needed; nail in the plan.
- Restore the placeholder "Type @ to search files, / for skills…". Restyle the popover container + items + category headers + empty/loading state to warm-chrome tokens (reuse dropdown/command styling; no `/opacity` on hex vars). Scoped `data-testid`s: `composer-trigger-popover`, `composer-skill-item-<id>`, `composer-file-item-<path>`, etc.

### Message chip resolution (`features/chat/messages/UserMessage.tsx`)
- `SlashPill` name → `resolveSkillName(metaCmd.name, skills)` (imported from `@qlan-ro/mainframe-core`), `skills` from `useChatSkills()`. Falls back to the raw name when skills are still loading / empty.

## Testing
- **API clients** — `getProjects`/`getSkills`/`searchFiles`: mock fetch; assert exact URL (incl. query params) + parsed shape.
- **`useChatSkills`** — projectId→path→skills resolution; loading + error → `[]`; no double-fetch.
- **`buildSkillsTriggerAdapter`** — categories/categoryItems/search over a fixture `Skill[]` (hardcoded expected items/labels; `invocationName` precedence).
- **`@` file adapter** — query→cache behavior: returns cached results synchronously, debounced fetch updates the cache, stale-cache-until-settle.
- **Chip resolve** — `resolveSkillName` integration in `UserMessage` (mock `useChatSkills`): resolves a known id, raw-name fallback when empty.
- Live `Unstable_TriggerPopover` DOM is **best-effort** in jsdom (portal + keyboard); the behavior lives in the adapters, which are unit-tested directly. Don't force a flaky open-popover assertion.
- All test authoring delegated to the `test-writer` agent (standing preference).

## Risks
- **`Unstable_` API drift** — the trigger primitives may change shape across assistant-ui releases; mitigated by the pinned version set and by keeping our coupling in the two small adapters + thin wiring.
- **Async-over-sync `@` adapter** — debounce + results cache; brief stale/empty window until a fetch settles. Acceptable for a file picker.
- **Per-chat projects round-trip** — one `getProjects` per chat; cached in the provider.

## Out-of-the-box file layout (new)
```
lib/api/projects.ts            getProjects
lib/api/skills.ts              getSkills
lib/api/files.ts               searchFiles
features/skills/SkillsProvider.tsx + use-chat-skills.ts
features/chat/composer/triggers/skills-trigger-adapter.ts
features/chat/composer/triggers/file-trigger-adapter.ts
features/chat/composer/triggers/ComposerTriggers.tsx   (the TriggerPopover wiring + restyle)
```
(All files < 300 lines; decompose if a piece grows.)
