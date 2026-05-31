# QA Test Scenarios — Sandbox / Preview

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) S1–S14. Locators:
`.locator('[data-testid="..."]')`. Extends the partial `28-sandbox-launch.spec.ts`._

**Shared starting conditions:** app launched in Electron, daemon connected, a project open with at
least one launch configuration. The PreviewTab is visible in the bottom panel.

---

## Scenario S1 — Start / stop / restart lifecycle

**Test Objective:** A launch config starts, stops, and restarts, with the action bar reflecting state.

**Test Steps:**
1. With the selected process `stopped`, `sandbox-button-start` is shown; click it → status → starting → running; `sandbox-button-restart` + `sandbox-button-stop` replace it.
2. For a `preview: true` config, the webview overlay shows "Waiting for localhost:PORT…" then the live app once loaded.
3. Click `sandbox-button-stop` → status → stopped; start button returns; webview overlay resets.
4. Re-start, then click `sandbox-button-restart` → stop → clear logs → start cycle; webview reloads.

**Expected Outcomes:**
- During `starting`, neither start nor stop/restart is shown (clicks are no-ops).
- URL load retries up to 15× (1s apart); spinner persists until success or stop.

---

## Scenario S2 — Stop all processes

**Test Objective:** The stop-all popover stops every running process.

**Starting Conditions:** ≥2 processes running; StopPopover open.

**Test Steps:**
1. Popover lists `sandbox-button-stop-process-{name}` per running process.
2. Click `sandbox-button-stop-all` → all stop in parallel; popover closes.

**Expected Outcomes:**
- An individual `sandbox-button-stop-process-{name}` stops just that one and leaves the popover open.
- Click outside `[data-stop-popover]` closes it.

---

## Scenario S3 — Reload webview

**Test Objective:** Reload refreshes the embedded app without restarting the dev server.

**Starting Conditions:** preview running, `webviewReady === true`, tab has `preview: true`.

**Test Steps:**
1. Click `sandbox-button-reload` → the webview page refreshes.

**Expected Outcomes:**
- No-op if the webview ref is not yet attached.

---

## Scenario S4 — Inspect / element pick

**Test Objective:** Picking an element captures a cropped screenshot plus its CSS selector.

**Starting Conditions:** preview ready.

**Test Steps:**
1. Click `sandbox-button-inspect` → button shows active style; blue hover overlay appears in the webview.
2. Click an element in the webview → overlay clears; a padded, zoom-corrected crop is captured as `{type:'element', imageDataUrl, selector}`; a `capture-thumb` appears; inspecting resets.

**Expected Outcomes:**
- Second click on `sandbox-button-inspect` (or Esc in webview) cancels with no capture.
- If no active chat exists, one is auto-created.
- Zoom ≠ 1 path scales crop coordinates correctly.

---

## Scenario S5 — Full screenshot

**Test Objective:** A full-page screenshot is captured and surfaced in the composer.

**Test Steps:**
1. Click `sandbox-button-screenshot` → full webview captured as `{type:'screenshot'}`; new `capture-thumb` (+ `capture-thumb-name`, `capture-thumb-remove`) appears in the composer.

**Expected Outcomes:**
- Auto-creates a chat if none active. Rapid clicks add independent captures.

---

## Scenario S6 — Region capture: draw, annotate, submit

**Test Objective:** Multiple regions can be drawn, annotated, and submitted to the agent.

**Starting Conditions:** preview ready.

**Test Steps:**
1. Click `sandbox-button-region-capture` → overlay mounts with crosshair + "Drag to capture"; button active.
2. Drag a rectangle (>4px each side) → draft rect, then a `CaptureAnnotationPopover`; overlay shows "1 captured".
3. Type annotation in `sandbox-textarea-annotation-1`; draw a second region (index 2).
4. Click `sandbox-button-submit-captures` → captures + annotations submitted; overlay unmounts; `capture-thumb`s appear; `sandbox-capture-context` shows `capture-meta-row` per capture with a selector/annotation.

**Expected Outcomes:**
- `sandbox-button-submit-captures` disabled until ≥1 region captured.
- Drag <4px ignored (no capture, no popover).
- `sandbox-button-remove-capture-{n}` removes a pending capture and re-indexes.

---

## Scenario S7 — Cancel region capture

**Test Objective:** Exiting region mode discards all pending captures.

**Test Steps:**
1. Enter region capture; draw a region.
2. Cancel via any of: `sandbox-button-cancel-capture`, Esc, or re-clicking `sandbox-button-region-capture`.

**Expected Outcomes:**
- Overlay unmounts; pending captures and annotations discarded silently (no confirm).

---

## Scenario S8 — Mobile view toggle

**Test Objective:** The webview toggles between full width and a 390×844 mobile frame.

**Test Steps:**
1. Click `sandbox-button-mobile-view` → webview constrained to 390×844, centered, bordered; button active.
2. Click again → returns to full width.

**Expected Outcomes:**
- State is per PreviewTab instance; resets to false when switching away and back. No reload/restart.

---

## Scenario S9 — Console toggle & clear logs

**Test Objective:** The console expands/collapses and logs clear per process.

**Test Steps:**
1. Click `sandbox-button-toggle-console` → `preview-console-output` shows; click again → hides.
2. With logs present, click `sandbox-button-clear-logs` → output shows "No output yet."

**Expected Outcomes:**
- `sandbox-button-clear-logs` disabled when no process selected.
- Per-tab expand state preserved; logs capped at 500 entries; clear affects only the selected process.

---

## Scenario S10 — Clear session (Electron only)

**Test Objective:** Clearing the session wipes the webview partition and reloads.

**Starting Conditions:** Electron, project active, preview running.

**Test Steps:**
1. Click `sandbox-button-clear-session` → `persist:sandbox-{projectId}` cleared → webview reloads (logged-out/reset state).

**Expected Outcomes:**
- Button not rendered in non-Electron mode.
- If the clear call rejects, no reload occurs.

---

## Scenario S11 — Generate launch config with agent

**Test Objective:** The "Generate with Agent" action sends `/launch-config` to a chat.

**Starting Conditions:** LaunchPopover open, project active.

**Test Steps:**
1. Click `sandbox-button-generate-with-agent` → with an active chat, `/launch-config` is sent; popover closes.
2. With no chat, a chat is created first, then `/launch-config` is sent once it's active.

**Expected Outcomes:**
- No-op if no active project.

---

## Scenario S12 — Capture thumbnails in composer & removal

**Test Objective:** Captures surface as composer thumbnails and can be removed individually.

**Test Steps:**
1. With ≥1 capture, `capture-thumb`s appear in `composer-attachments` with `capture-thumb-name`.
2. Captures with a selector/annotation also list a `capture-meta-row` under `sandbox-capture-context`.
3. Hover a thumb → `capture-thumb-remove` appears; click it → capture removed.

**Expected Outcomes:**
- `sandbox-capture-context` renders only rows with selector/annotation.
- Send is enabled with captures even if text is empty; clicking send routes through send-pending-captures.
- Removing all captures hides `sandbox-capture-context`; on chat switch captures are saved to the draft and restored on return.
