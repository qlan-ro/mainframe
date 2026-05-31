# QA Test Scenarios — Skills Panel / Plugins / Tutorial

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) SK1–SK3. Locators:
`.locator('[data-testid="..."]')`. Standalone surfaces (tool-call cards live in Thread, TH8–TH13)._

**Shared starting conditions:** app launched, daemon connected, a project active.

---

## Scenario SK1 — Skills panel: browse & invoke

**Test Objective:** Skills are listed by scope; clicking a row queues its slash-command in the composer; the row menu edits/deletes.

**Test Steps:**
1. Open the Skills panel → skills grouped Project/Global/Plugin; each row is `skills-item-name-{id}` with a scope badge and `/name`.
2. Click a skill row → composer is pre-filled with `/{invocationName} ` (pending invocation).
3. Hover a row → `skills-item-menu-{id}` appears; click it → `skills-item-edit-{id}` / `skills-item-delete-{id}`.
4. Click Edit → a skill-editor tab opens. Click Delete → confirm dialog; on confirm, skill removed.

**Expected Outcomes:**
- States: "Loading skills…", "Select a project to view skills", "No skills found".
- Plugin-scoped skills have **no** Delete option. The menu's `stopPropagation` prevents the row-click invoke.

---

## Scenario SK2 — Plugin fullview

**Test Objective:** A fullview-capable plugin opens in the fullview modal and renders its view.

**Test Steps:**
1. Click the plugin's left-rail icon → `fullview-modal` opens; the plugin's `PluginView` renders inside.
2. Close via `fullview-button-close` / backdrop / Esc.

**Expected Outcomes:**
- Modal open/close mechanics are covered by NL2 — this scenario asserts the *plugin content* renders.
- A plugin render error is caught by the in-modal ErrorBoundary (shows PluginError, not a crash).
- `plugin-view` is a **test-mock-only** id — do not target it in real-app e2e.

---

## Scenario SK3 — Tutorial next / skip

**Test Objective:** The onboarding tutorial advances and can be skipped.

**Starting Conditions:** first launch (`completed: false`), no chat messages yet.

**Test Steps:**
1. Tutorial overlay (`tutorial-overlay`) is active. Click `tutorial-skip-btn` → overlay unmounts, `completed` persisted.
2. (Alternate) Reach step 3 → `tutorial-next-btn` visible; click → advances to step 4; the final step's button reads "Done".

**Expected Outcomes:**
- Steps 1–2 have no `tutorial-next-btn` (they auto-advance via store effects); the overlay is **invisible until step 3** because `data-tutorial="step-1/2"` elements don't exist — tests starting clean should expect first visibility at step 3 (composer) / step 4 (adapter dropdown).
- Overlay hides while a dir-picker or settings modal is open. A returning user with existing messages auto-completes.
