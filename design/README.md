# Design

Mainframe's design source lives here. The hosted [Mainframe App canvas](https://claude.ai/artifact/GxH1152i4cHJ87B8m1pKgC) is a published copy of `main`.

## Layout

| Path | What it is |
| --- | --- |
| `areas.json` | The area map. Each UI area owns code paths, one canvas page, the boards on that page and, when it has one, a surface brief. |
| `canvas/project/` | The canvas source as it is published: `canvas.json` (pages, frames, notes) and one `.dc.html` per board. `ds/` is the installed Mainframe design system. |
| `canvas/capture/` | The product-board capture tool: one command redraws an area's boards from the running app. See its README. |
| `canvas/foundations/` | The generator for `Foundations-Tokens`, from the tokens in `../DESIGN.md`. |
| `canvas/lib/` | What the board builders share: the page shape, and the one check every board passes before it is written. |
| `canvas/proposals/` | The generator for the `Proposal-Redesign-*` boards, rendered from the redesign prototype. |
| `redesign/` | The window redesign: `DECISIONS.md` (the spec, mirrored on the `Proposal-Redesign-Spec` board) and the clickable `prototype/index.html`. |
| `tools/check.mjs` | The CI check. |
| `../packages/ui/.impeccable/surfaces/` | Impeccable surface briefs (the six redesign areas): purpose, direction and constraints. Written with `impeccable surface-brief write <target> <body>`. |

## Areas

One canvas page per area. A board belongs to the area whose board prefix matches its name, and a file belongs to the area whose code path matches it. The longest match wins in both cases, so `features/chat/composer/` belongs to Composer and the rest of `features/chat/` to Transcript.

| Area | Page | Boards | Brief |
| --- | --- | --- | --- |
| Foundations | `foundations` | `Foundations-*` | `DESIGN.md` (repo root) |
| Shell & title bar | `shell` | `Shell-TitleBar`, `Shell-Window`, `Shell-States`, `Shell-Flow` | `src-layout-titlebar-tsx.md` |
| Sidebar | `sidebar` | `Shell-Sidebar*` | `src-features-sessions.md` |
| Composer & gates | `composer` | `Chat-Composer*` | `src-features-chat-composer.md` |
| Transcript | `transcript` | `Chat-Thread`, `Chat-Window`, `Chat-States` | `src-features-chat-thread.md` |
| Session panel | `session-panel` | `Chat-SessionPanel*`, `Workspace-SessionPanel` | `src-features-session-panel.md` |
| Workspace | `workspace` | `Workspace-*`, `Chat-SideChat` | `src-layout-surfaces-workspacesurface-tsx.md` |
| Settings & dialogs | `settings` | `Settings-*` | none |
| Automations | `automations` | `Automations-*` | none |
| Tasks | `tasks` | `Tasks-*` | none |

The `overview` page holds the map board (`Main`). The `proposals` page holds design that is not built yet (`Proposal-*`). Foundations is the visual system: shared primitives, theme and shared feature pieces (`components/ui`, `styles`, `features/shared`). Its brief is `DESIGN.md`, so a change there counts as that area's design file.

## A PR that changes UI

1. Change the code.
2. Update the area's boards. Product boards are captured from the running app with `canvas/capture/`, never drawn by hand. If the area's purpose or direction changed, update its surface brief too.
3. If the PR builds something from Proposals, move that work to the area page and remove the proposal boards it replaces. Keep whatever is not built yet. Mark the decisions it implements in `redesign/DECISIONS.md`.
4. Name the changed boards in the PR description.

CI runs `node design/tools/check.mjs --base origin/main`:

- **Canvas:** every board in `canvas.json` has a file, nothing is orphaned, `order` lists every board once, every board sits on its area's page, and every named brief exists. No board, brief (`packages/ui/.impeccable`), spec or prototype, nor `DESIGN.md` or this file, holds a local path (a home or temp directory, encoded ones too; `canvas/lib/local-paths.json` lists the shapes): this repository is public, so write `~/projects/…`. Private project names cannot be checked for; leave them out.
- **Coverage:** every area whose UI code changed (`.tsx` and `.css` files, tests and stories excluded; moves and deletions count) also adds or edits one of its own boards or its brief. A proposal board or a deleted board does not count.

A PR with no visible change (a refactor, a performance fix) carries the `design: none` label, which skips the coverage check.

## Publishing

The hosted canvas is published by hand from `main` after a merge. Read the hosted `project/canvas.json` first. If it differs from `main` (boards moved or edited in the editor), bring that change back in a PR before publishing over it.

## Regenerating the proposal boards

```bash
pnpm install                                                  # once: Playwright comes from packages/e2e
pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium
bash design/canvas/proposals/run.sh
```

`run.sh` renders every state listed in `states.py` from the prototype, writes the boards, sets the spec board's height, lays out the Proposals page and runs the check. With an unchanged prototype and `states.py` it reproduces the boards of its last run byte for byte. The prototype numbers its tool cards (`tcN`, `mkN`) with one counter that keeps counting from state to state; `number-ids.cjs` numbers them per state and prefixes the state's name, so adding, removing or reordering a state changes only its own board. `shot.cjs` previews a board locally; it needs the canvas runtime at `canvas/proposals/render/support.js` (the canvas type's `artifact-type/dc-runtime.js`, which is not committed).

## Regenerating the other boards

```bash
bash design/canvas/capture/run.sh <area>          # product boards, from the running app (canvas/capture/README.md)
python3 design/canvas/foundations/build.py        # Foundations-Tokens, from DESIGN.md
```
