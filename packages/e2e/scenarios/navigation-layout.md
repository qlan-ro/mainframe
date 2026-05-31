# QA Test Scenarios — Navigation & Layout (app shell)

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) NL1–NL5. Locators:
`.locator('[data-testid="..."]')`. App-wide navigation and panel/window chrome — not tied to any
one chat thread._

**Shared starting conditions:** app launched, daemon connected, at least one project with sessions.

---

## Scenario NL1 — Global search palette (open / search / select)

**Test Objective:** The command palette finds and jumps to sessions and files.

**Test Steps:**
1. Press Cmd+O (or click the title-bar search) → `search-palette-dialog` opens; `search-palette-input` focused; up to 5 recent sessions listed (`search-palette-session-{id}`).
2. Type a query → sessions filter live; with ≥2 chars and an active project, files appear (`search-palette-file-{path}`) after 300ms debounce.
3. Arrow-navigate; press Enter (or click) → session: activates + opens tab + resumes; file: opens editor tab. Palette closes.

**Expected Outcomes:**
- Cmd+O again, backdrop click, or Esc closes. ≥2-chars-no-match → "No results found". File search needs an active project. Dialog is resizable (min 400×200).

---

## Scenario NL2 — Fullview modal (open / close / backdrop / esc)

**Test Objective:** A fullview plugin modal opens from the rail and closes by all paths.

**Test Steps:**
1. Click a fullview plugin icon in the left rail → `fullview-modal-backdrop` + `fullview-modal` appear; the plugin renders inside.
2. Close via `fullview-button-close`, OR click `fullview-modal-backdrop`, OR press Esc → modal unmounts.
3. Click inside `fullview-modal` → stays open (stopPropagation).

**Expected Outcomes:**
- `activateFullview` is a toggle — re-triggering the same plugin closes it. Hosts the plugin from SK2.

---

## Scenario NL3 — Zone minimize

**Test Objective:** Minimizing a zone collapses its panel.

**Test Steps:**
1. With a zone expanded, click `zone-button-minimize` → zone `activeTab` becomes null; the panel collapses (ZoneHeader unmounts).
2. Click a zone tab → re-opens.

---

## Scenario NL4 — Zone tab dropdown (P2)

**Test Objective:** Dropdown-style zone tabs switch the active panel tab.

**Test Steps:**
1. Click `zone-button-tab-dropdown` → options `zone-tab-dropdown-option-{id}` appear; active tab highlighted.
2. Click an option → tab changes; dropdown closes.

**Expected Outcomes:** Outside-click closes. Buttons-style zones use inline `zone-tab-{id}` instead of a dropdown.

---

## Scenario NL5 — Context section toggle (P2)

**Test Objective:** A right-rail context section expands/collapses.

**Test Steps:**
1. A context section with count>0 renders `context-section-title` inside a `<summary>`.
2. Click the summary row → native `<details>` toggles open/closed.

**Expected Outcomes:** Absent when count is 0. Click the `<summary>`, not the label, to toggle reliably (no `aria-expanded`; the DOM `open` property is authoritative).
