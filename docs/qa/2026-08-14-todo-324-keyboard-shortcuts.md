# todo #324 — QA: keyboard shortcuts

Live smoke test of `todo/324-keyboard-shortcuts` at `be695bb2` against the
running app. **Result: 3/10 scenarios PASS as documented; 7 FAIL, all but one
traced to a single root-cause defect in platform detection.**

## Environment

- Target: `browser` (renderer + daemon only — every scenario in this set is
  renderer/daemon-only; no native-shell surface was needed).
- `DAEMON_PORT=32136`, `VITE_PORT=5737`, `MAINFRAME_DATA_DIR=~/.mainframe_dev`.
- Driver: `playwright-cli`, headed Chromium, against `http://localhost:5737`.
- Fixtures: a throwaway project (`todo-324-keyboard-shortcuts`, id
  `moSQFQfNCk6FdTq5r5BoG`) and three empty `claude`-adapter chats, created via
  `POST /api/chats` (no message sent — no live CLI process, no cost). Both
  were deleted from `~/.mainframe_dev/mainframe.db` after the run; the
  isolated daemon and Vite server were torn down via `.agents/test-env.sh
  down` (ports 32136/5737/9222 confirmed clear). Production (`:31415`,
  `~/.mainframe`) was untouched throughout.

## Root-cause defect: `isMacPlatform()` misdetects real Mac Chromium browsers

`packages/ui/src/features/shortcuts/platform.ts`:

```ts
const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
return /Mac|iPhone|iPad|iPod/.test(platform);
```

Chrome/Edge/Chromium report `navigator.userAgentData.platform` as the literal
string `"macOS"` (lowercase `m`) — confirmed live in this run:
`{ uaDataPlatform: "macOS", navigatorPlatform: "MacIntel" }`. The regex
`/Mac|.../ ` is case-sensitive and only matches capital `"Mac"`, so on any
Mac running Chromium, `isMacPlatform()` returns `false`, and the dispatcher
resolves every `mod`-based chord to its **non-mac** branch (`Ctrl` instead of
`⌘`, `Alt` instead of `⌃` for the tab-index chords). Reproduced directly:

- `Meta+n` (documented ⌘N) does **not** open a new session; `Control+n` does.
- `Control+Digit1` does **not** switch to tab 1 (it fires `workspace.toggle-chat`
  instead, since `mod` also remaps to `Ctrl`); `Alt+Digit1` does.
- The cheat sheet renders `Ctrl+N`, `Ctrl+1`, `Ctrl+,` etc. on this Mac browser
  instead of `⌘N`, `⌘1`, `⌘,` — `renderChord`/`renderEntryChord` take the same
  broken `isMac` flag, so the mislabeling is visible in-app, not just internal.

This is dormant in the packaged macOS Tauri build today (WKWebView has no
`userAgentData`, so the code falls back to `navigator.platform` = `"MacIntel"`,
which the capitalized regex does match) — but it is live and reproducible in
any Chromium-based access to this UI (the `browser` QA target used here, and
by extension any Chromium/Electron/`mainframe-web`-style embedding on macOS).
Given the acceptance criteria explicitly require "physical modifiers... ⌘ on
macOS" and "Chords render as ⌘/⌥/⇧ glyphs on macOS," this is a real violation,
not a QA-environment-only artifact — fix: match `userAgentData.platform`
case-insensitively (or check for the exact value `"macOS"`) before falling
back to the capitalized `navigator.platform` string.

Underlying logic was otherwise verified correct for every chord this bug
touches (tab switching, split pairing, surface toggle, focus composer all
fired and produced the right effect once the *actual* resolved chord —
Ctrl/Alt instead of ⌘ — was pressed). The fix is isolated to `platform.ts`;
nothing else needs to change.

## Second defect: composer Escape leaves a chat's status stuck on "Working…"

After focusing the composer (⌘L-equivalent) and pressing Escape to return
focus to the transcript on an **idle, never-messaged** chat, the chat header
kept showing a growing `Working… Ns` timer (29s → 4m50s across the session)
with a red stop control, even though `GET /api/chats/:id` on the daemon
confirmed `isRunning: false`, `totalTokensInput: 0`, `updatedAt` unchanged
since creation the whole time — the chat never ran anything. The same idle
chat's split partner (untouched by the Escape test) showed no such indicator.
This correlates with the branch's own last commit (`be695bb2`, "let
composer-Escape fall through to overlay light-dismiss") but causation was not
isolated with a controlled A/B before time ran out — flagging as a real,
reproducible client-side status defect regardless of exact trigger. Screenshots:
`docs/qa/assets/2026-08-14-todo-324/working-status-29s.png` and
`working-status-4m50s.png` (same idle chat, ~2 minutes apart, indicator still
counting up in both).

## Scenarios

| # | Scenario | Class | Mode | Status | Evidence |
|---|---|---|---|---|---|
| S1 | Cheat sheet opens via documented ⌘/ | happy | ui | FAIL | `Meta+/` no-op; `Control+/` opens it (root-cause defect) |
| S2 | Cheat sheet closes on Escape | happy | ui | PASS | dialog removed from DOM after `Escape` |
| S3 | Cheat sheet lists 16 entries grouped (Sessions/Chat/Workspace/App), dev-only (`app.automations`) excluded, rows keyed by shortcut id | happy | ui | FAIL | content/grouping/dev-exclusion all correct, but every glyph renders `Ctrl+`/`Alt+` text instead of ⌘/⌃/⌥ on this Mac (root-cause defect) |
| S4 | Switch to session tab N via documented ⌃1..⌃9 | happy | ui | FAIL | `Control+Digit1..9` doesn't switch tabs (fires `workspace.toggle-chat` on 1/2, no match on 3-9); `Alt+Digit1..9` does (root-cause defect) |
| S5 | Cycle tabs via ⌃Tab / ⌃⇧Tab | happy | ui | PASS | `Control+Tab` / `Control+Shift+Tab` correctly advance the active tab (chord has no platform variant — unaffected) |
| S6 | Open session in split via documented ⌘⇧\\, same pairing as the tab context menu | happy | ui | FAIL | `Meta+Shift+\` no-op; `Control+Shift+\` correctly pairs the two right sessions (`localStorage['mf:session-tabs'].zones`) — root-cause defect blocks the documented chord |
| S7 | Focus composer via documented ⌘L | happy | ui | FAIL | `Meta+l` no-op; `Control+l` correctly moves focus into `chat-composer-input` — root-cause defect |
| S8 | Escape from composer returns focus to the transcript | edge | ui | PASS | `document.activeElement` → `chat-thread-viewport` after `Escape`; see second defect above for a surface glitch found alongside |
| S9 | Existing ⌘1/⌘2 Chat/Workspace surface toggle regression | regression | ui | FAIL | `Meta+1` no-op; `Control+1` correctly toggles chat surface visibility — root-cause defect |
| S10 | Existing ⌘\\ close-split, ⌘B sidebar toggle, ⌘F find-in-chat regressions | regression | ui | FAIL | all three no-op under `Meta+...`; `Control+\`, `Control+b`, `Control+f` each work correctly (zones cleared, `data-slot="sidebar"` `data-state` flips, `find-bar` testid appears) — root-cause defect |

**7 of 10 scenarios did not pass as documented** — all seven (S1, S3, S4, S6,
S7, S9, S10) trace to the single `isMacPlatform()` root cause above. The
second defect (the phantom "Working…" status) was found alongside a
*passing* scenario (S8) during its surface check, not as a scenario failure
in its own right — it is reported only in the Defects table below.

## Defects

| Surface | Type | Severity | Evidence |
|---|---|---|---|
| `packages/ui/src/features/shortcuts/platform.ts` `isMacPlatform()` | capability | FAIL | case-sensitive regex vs. Chrome's lowercase `"macOS"` `userAgentData.platform`; breaks every ⌘/mod-based chord + cheat-sheet glyphs on real Mac Chromium |
| Chat header status pill (idle chat, after composer Escape) | capability | FAIL | `Working… Ns` timer grows indefinitely on a chat the daemon reports `isRunning: false` the whole time |

Both defects were reproduced against the live app during this run; neither
was fixed here (QA-only pass, no code changes made).
