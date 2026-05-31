# QA Test Scenarios — Settings / Remote Access / Terminal / Chrome

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) SE1–SE18. Locators:
`.locator('[data-testid="..."]')`._

**Shared starting conditions:** app launched, daemon connected.

> **Gaps to fix alongside tests:** `settings-modal` root has no testid (only `settings-modal-close`);
> named-tunnel save error and pairing-code errors have no testid / surface silently.

---

## Scenario SE1 — Open settings

**Test Steps:**
1. Click the gear in the left rail (`left-rail-settings`) or press Cmd+, → settings modal opens; sidebar tabs `settings-modal-sidebar-tab-{id}` (General, Providers, Notifications, Keybindings, Remote Access, About); `settings-modal-close` visible.

**Expected Outcomes:** Settings re-fetched on open (via REST, works even if WS disconnected); load failure doesn't crash.

---

## Scenario SE2 — Close settings

**Test Steps:**
1. Click `settings-modal-close`, OR click the backdrop, OR press Esc → modal unmounts.

---

## Scenario SE3 — Set & save the worktree directory

**Test Steps:**
1. General tab → edit `general-worktree-dir-input` → `general-worktree-dir-save` appears (dirty only).
2. Click save (or Enter) → "Saving…", then button disappears, store updated.

**Expected Outcomes:** Reverting to the original value hides save. No validation; no error UI on failure (gap).

---

## Scenario SE4 — Configure a named tunnel (first time)

**Test Objective:** Token + URL save and bring the tunnel to ready.

**Starting Conditions:** Remote Access tab; no named config (`hasToken=false`).

**Test Steps:**
1. Enter `named-tunnel-token-input` and `named-tunnel-url-input` → `named-tunnel-save` enables (both non-empty).
2. Click save → state cycles starting → verifying → ready; on ready the form collapses, config display + `named-tunnel-toggle` (Stop) + `named-tunnel-clear-config` appear; Quick Tunnel hides; Pairing appears.

**Expected Outcomes:** save disabled with one field empty; failure shows a (no-testid) red error; `tunnel:status error` re-enables save.

---

## Scenario SE5 — Stop / start a saved named tunnel

**Test Steps:**
1. Click `named-tunnel-toggle` (running) → "Stopping…", state idle, button "Start".
2. Click again (stopped) → "Starting…", uses saved config, reaches ready.

**Expected Outcomes:** Disabled mid-action (no double-click).

---

## Scenario SE6 — Clear named tunnel config

**Test Steps:**
1. Click `named-tunnel-clear-config` → config cleared; the two-input form returns; Quick Tunnel reappears; Pairing hides; inputs empty, save disabled.

**Expected Outcomes:** Disabled while a stop is in flight.

---

## Scenario SE7 — Enable a quick tunnel

**Starting Conditions:** no named config (Quick Tunnel section visible).

**Test Steps:**
1. Click `quick-tunnel-toggle` → "Starting…" → "Verifying DNS…" → on verified: green dot + URL + copy; button "Stop"; Pairing appears.
2. Click again → "Stopping…" → status row gone; button "Start".

**Expected Outcomes:** `dns_verified=false` → unreachable (yellow dot + `tunnel-recheck-verify`); Pairing disabled.

---

## Scenario SE8 — Re-check DNS (P2)

**Test Steps:**
1. With tunnel unreachable, click `tunnel-recheck-verify` → state verifying; verified=true → ready (Pairing appears); verified=false → unreachable again.

**Expected Outcomes:** No guard on repeated clicks.

---

## Scenario SE9 — Generate a pairing code

**Starting Conditions:** tunnel ready (verified); Pairing section visible.

**Test Steps:**
1. Click `pairing-generate-code` → "Generating…", then a code is shown with a 5-min countdown; button becomes `pairing-regenerate-code`; `pairing-code-copy` available.
2. Let the countdown hit 0 → code disappears, `pairing-generate-code` returns.

**Expected Outcomes:** Failure logs silently (no testid). Closing the modal clears the timer. Tunnel leaving ready unmounts Pairing.

---

## Scenario SE10 — Regenerate pairing code (P2)

**Test Steps:**
1. With a code shown, click `pairing-regenerate-code` → new code + fresh 5-min timer.

**Expected Outcomes:** Disabled while generating.

---

## Scenario SE11 — Open a new terminal

**Starting Conditions:** project active; terminal panel (`terminal-panel`) visible; homedir loaded.

**Test Steps:**
1. Empty state shows "Click the + icon…". Click `terminal-button-new` → a terminal tab appears ("zsh"); instance visible.
2. Click again → second terminal ("zsh (2)"). Switch tabs / close (×) kills the session.

**Expected Outcomes:** No-op if homedir not loaded. `terminal.create` failure logs, adds no tab.

---

## Scenario SE12 — Project group name & parent (P2)

**Test Steps:**
1. A project group shows `project-group-name`; if it has a parent, `project-group-parent` ("↳ parent").
2. Click the header → collapses/expands (persisted to localStorage).

**Expected Outcomes:** `project-group-parent` absent without a parent.

---

## Scenario SE13 — App update: download

**Starting Conditions:** update available.

**Test Steps:**
1. `status-bar-update-download` shows "Update vX.Y.Z"; click → "Downloading N%"; on complete → `status-bar-update-install` appears ("Restart to update").

**Expected Outcomes:** Download error not surfaced in UI (gap). `checking`/`not-available` → indicator hidden.

---

## Scenario SE14 — App update: install (restart)

**Test Steps:**
1. Click `status-bar-update-install` → app restarts (Electron-level).

---

## Scenario SE15 — Connection overlay (daemon disconnected)

**Test Objective:** Disconnect shows a blocking overlay that auto-clears on reconnect.

**Test Steps:**
1. Healthy → `connection-overlay` absent. Daemon drops → overlay appears full-screen ("Connecting to server…", spinner, no controls).
2. Reconnect → overlay unmounts automatically.

**Expected Outcomes:** z-9998 — covers everything incl. the settings modal. StatusBar `connection-status` also flips to Disconnected.

---

## Scenario SE16 — Error boundary retry

**Test Steps:**
1. A render error in a boundary-wrapped subtree → "Something went wrong" + `error-boundary-retry`.
2. Click retry → children re-render; recovers if resolved, else the fallback reappears.

**Expected Outcomes:** A custom `fallback` omits the retry button.

---

## Scenario SE17 — Status bar branch button

**Test Steps:**
1. In a git project, the bottom status bar shows `status-bar-branch`; click → opens BranchPopover (this is the B1 trigger).

**Expected Outcomes:** Worktree icon when in a worktree; conflict warning icon when conflicts exist; branch polled every 60s; hidden when `worktreeMissing`.

---

## Scenario SE18 — Default-model dropdown (P2)

**Test Steps:**
1. Open the settings ModelDropdown → click `model-dropdown-trigger` → options listed; pick one → trigger label updates.

**Expected Outcomes:** Sets the default model for **new** sessions — does not change the active chat's model.
