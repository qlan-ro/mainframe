# QA Test Scenarios — Thread & Messages

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) TH1–TH14. Locators:
`.locator('[data-testid="..."]')`. Everything here renders **inside a chat message thread**._

**Shared starting conditions:** app launched, daemon connected, a chat with messages is active and
visible in the center thread.

---

## Scenario TH1 — Find in thread (open / search / navigate / close)

**Test Objective:** Cmd+F searches thread text, navigates matches, and closes cleanly.

**Test Steps:**
1. Press Cmd+F → `find-bar` appears; `thread-find-input` focused; `thread-find-next`/`-prev` disabled (0 matches).
2. Type a query → after 80ms debounce, matches highlight; counter shows "1/N".
3. Click `thread-find-next` (or Enter / ↓) → advances, wraps at end; `thread-find-prev` (or Shift+Enter / ↑) goes back.
4. Click `thread-find-close` (or Esc) → bar unmounts, highlights cleared.

**Expected Outcomes:**
- next/prev stay disabled at 0 matches. Only user + assistant text is indexed (not tool results).
- Requires CSS Custom Highlight API (present in headless Chromium).

---

## Scenario TH2 — Quote selection into composer

**Test Objective:** Selecting thread text and clicking Quote inserts a blockquote into the composer.

**Test Steps:**
1. Select text within the thread → `thread-quote` button appears near the selection.
2. Click `thread-quote` → selected text, `> `-prefixed per line, is appended to the composer; selection clears; composer focuses.

**Expected Outcomes:**
- Whitespace-only selection → no button. Selection spanning the composer → no button.
- Scroll/resize hides the button. Separator is `\n\n` (or `\n` if composer text already ends in newline).

---

## Scenario TH3 — Expand / collapse a truncated tool result

**Test Objective:** Server-truncated tool output fetches and shows full content on demand.

**Test Steps:**
1. A truncated result shows `thread-tool-result-expand` ("Show full output · X KB").
2. Click it → "Loading…", then full content shown; button becomes `thread-tool-result-collapse`.
3. Click collapse → truncated view returns.

**Expected Outcomes:** Fetch failure → "full output no longer available" (no retry). Loading button is disabled (no double-fetch).

---

## Scenario TH4 — Copy a code block

**Test Objective:** The code-block copy button writes the code to the clipboard.

**Test Steps:**
1. Hover an assistant code block → `message-part-copy` visible; click it → icon → check for 2s.

**Expected Outcomes:** Each code block has independent copied-state. Silent fail in insecure contexts.

---

## Scenario TH5 — Copy URL from a link (P2)

**Test Objective:** A link tooltip exposes a copy-URL action.

**Test Steps:**
1. Hover a markdown link → tooltip with `message-part-copy-url`; click → href copied, label "Copied" 1.5s.

**Expected Outcomes:** Also available via right-click "Copy link". Navigation is prevented on copy click.

---

## Scenario TH6 — Toggle a thinking block

**Test Objective:** Reasoning/thinking content expands and collapses.

**Test Steps:**
1. Click `message-part-thinking-toggle` → chevron rotates; thinking text expands; click again → collapses.

**Expected Outcomes:** Per-instance state; CSS-animated (~200ms).

---

## Scenario TH7 — Read more / show less

**Test Objective:** Long user messages clamp with a toggle.

**Test Steps:**
1. A user message >600 chars renders clamped (6 lines) with `message-read-more` ("Read more").
2. Click → full text shown, label "Show less"; click again → re-clamps.

**Expected Outcomes:** Button absent for ≤600-char messages. Threshold counts node text length, not pixels.

---

## Scenario TH8 — Generic tool card expand/collapse

**Test Objective:** A non-special tool card toggles its Arguments/Result body.

**Test Steps:**
1. A completed tool call shows `tool-card` with `tool-card-toggle`; click → body expands (Maximize2→Minimize2); click → collapses.

**Expected Outcomes:** When `disabled` (no result), the toggle icon is absent and clicks are no-ops. Truncated results render via ToolResultExpand (TH3).

---

## Scenario TH9 — MCP tool card expand/collapse

**Test Objective:** An `mcp__*` tool pill expands after completion.

**Test Steps:**
1. While running → `tool-mcp-expand` disabled, no chevron.
2. On completion → chevron appears; click → Arguments/Result panel expands; tooltip shows full tool name.

**Expected Outcomes:** On error → orange border, "failed:", not expandable (button stays disabled). Server prefix (`claude_ai_`) stripped in the label.

---

## Scenario TH10 — Skill-loaded card expand (P0, inside TaskGroup)

**Test Objective:** A `skill_loaded` child pill expands to show the skill markdown.

**Test Steps:**
1. Inside an expanded TaskGroup, `tool-skill-expand` shows "Using skill: {name}"; click → markdown panel (scrollable) expands; `aria-expanded` flips.

**Expected Outcomes:** Top-level `Skill` tool calls render as a non-expandable SlashCommandCard (no `tool-skill-expand`). Tooltip = skill path (omitted if empty).

---

## Scenario TH11 — Schedule tool card expand (P1)

**Test Objective:** Schedule tools that have a body expand; others don't.

**Test Steps:**
1. `CronList` (>0 jobs) or `Monitor` (with content) → `tool-schedule-expand` has a chevron; click → job/content list expands.

**Expected Outcomes:** `ScheduleWakeup`/`CronCreate`/`CronDelete` and `CronList` (0 jobs) are not expandable (no chevron, disabled).

---

## Scenario TH12 — Task subagent group expand

**Test Objective:** A `_TaskGroup` card expands to reveal nested subagent activity.

**Test Steps:**
1. Click `tool-task-group-toggle` → prompt (italic) + all child cards render recursively; summary string at the header right.

**Expected Outcomes:** First child text equal to the prompt is deduped. `<usage>` and `agentId:` lines stripped from the result. Error shows a red dot but still expands.

---

## Scenario TH13 — Task / agent tracking card

**Test Objective:** A `Task`/`Agent` call shows agent + model and usage stats on completion.

**Test Steps:**
1. On dispatch → `task-card` with `task-card-agent` (subagent_type); `task-card-model` if a model arg exists; pulse dot.
2. On completion → "{N} tool uses · {tokens} tokens · {duration}".

**Expected Outcomes:** Non-expandable. `task-card-model` absent when no model arg. Malformed `<usage>` → no stats.

---

## Scenario TH14 — Selector breadcrumb (display, P2)

**Test Objective:** A CSS-selector path renders as a breadcrumb in a message/composer bubble.

**Test Steps:**
1. A bubble with a selector path renders `selector-breadcrumb` with `selector-crumb` segments; last segment = target styling.

**Expected Outcomes:** Empty path → nothing rendered. >3 segments collapse into a leading `…`. Render-only (clip-path chevrons; avoid computed-style assertions in jsdom).
