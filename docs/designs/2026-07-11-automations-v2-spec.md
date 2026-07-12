# Automations (Workflows v2) — Product Spec

**Date:** 2026-07-11
**Status:** Approved direction, ready for UX design
**Purpose:** Hand-off spec for redesigning the Workflows feature from scratch. Self-contained — written for a design tool without repo access.

## 1. Context

Mainframe is a desktop app for orchestrating AI coding agents (Claude, Codex, Gemini) in chat sessions. Its v1 Workflows feature is a general-purpose durable workflow engine: YAML files, a JSONata expression language, step-id scoping rules, eight step kinds (connector, agent, question, set, choose, foreach, parallel, call), and a connector/credential system. Users found it too complex to approach. A UI-only redesign failed because it re-skinned the engine grammar at 1:1 fidelity — every nested-bracket, token-scoping, and free-text-condition problem existed because the grammar survived.

v2 replaces the model, not just the surface. The bar: as approachable as Apple Shortcuts and Home Assistant automations, without losing the scenarios users have written down (daily health log, daily standup, PR auto-review, autonomous feature spike, ship-work).

## 2. Design principles

1. **Cut the grammar, don't restyle it.** No YAML surface, no expression language, no step ids, no scoping rules.
2. **Actions for effects, agent for judgment.** Deterministic connector calls for known effects; an agent step for anything needing decisions. The author picks per step.
3. **Tokens, not expressions.** Data flows through pickable chips. Whatever reshaping a call needs, its form absorbs.
4. **The GUI is the source of truth.** Stored in the app's database. Read-only export exists; no file editing, no bidirectional sync.
5. **Curate, don't expose.** Plain-language schedules instead of cron. Curated events instead of the raw event firehose. Forms instead of JSON bodies.

## 3. The model

An **Automation** = **When** (one or more triggers) + **Do** (a linear list of steps).

Steps come from four verbs. Two block types (If, Repeat) add structure when needed. That is the whole grammar: four verbs, two brackets, zero syntax.

## 4. When — triggers

- **On a schedule.** Plain-language picker: every day at 21:00, weekdays at 6:00, every N hours. Cron never appears. One toggle: "If my Mac was off, run when it starts" (on) vs. "skip missed runs" (off).
- **When something happens.** A curated list with human names, each contributing typed tokens:
  - App events: *a session finishes*, *a run fails*.
  - GitHub events: *a pull request is opened / merged* → ⟨PR URL⟩, ⟨PR title⟩, ⟨PR author⟩.
  - Chaining: *automation X finishes / fails* → ⟨its result⟩.
- **Webhook** (under an "Advanced" group). Auto-generated URL, signature verification built in, sample-payload capture to drive token suggestions.
- **Manually.** Every automation is always runnable by hand from its list row and detail view.

## 5. Do — the four verbs

### Ask agent

The workhorse. A prompt (token chips allowed) sent to a new agent session. The run waits; the session's final reply becomes ⟨Agent result⟩; the run view links to the chat. Slash commands in the prompt work exactly as in an interactive session.

Essentials on the card: the prompt, agent/model. Under **More options**: run in a fresh worktree (base branch + branch name), tool auto-approve scope (e.g. edits + `pnpm` + `git`), time/budget cap, attachments (images, files), permission mode, and **Expect results** — an optional list of named outputs (key + type: text / number / list / choice). Declared results are enforced by the engine (parse the final message's JSON, validate, one corrective retry, then fail loudly) and become typed tokens — ⟨planPath⟩, ⟨scope⟩ — alongside ⟨Agent result⟩, so later steps can gate ("If ⟨scope⟩ is one of xs, s") or loop over agent findings deterministically.

Loops, retries, and judgment live *inside* this step ("run tests until green, then push"). The automation layer never orchestrates agent thinking.

### Ask me

A native form. Title + fields: text, number, choice, multi-choice, textarea; optional "show when ⟨field⟩ = value" conditional fields. The run pauses until answered (desktop + mobile notification, answerable hours later); answers become tokens (⟨mood⟩, ⟨temperature⟩). A paused form is a pause — no agent session sits idle underneath.

### Run an action

A deterministic call — the engine executes it directly, no agent, no tokens spent, identical call every run. One searchable, Shortcuts-style catalog with three sources:

1. **Curated connectors** — hand-polished forms that absorb data shaping. Launch set:
   - **Run a command** (built-in): multiline script with chips; run-in (project root / worktree / custom); *treat output as text or lines (list)*; outputs ⟨Output⟩ and ⟨Exit code⟩. Non-zero exit fails the step. Chips are never spliced into shell source: each becomes an environment variable and the script gets a quoted expansion where the chip sat, so hostile token content (webhook payloads, PR titles) is inert data. The Set-up panel shows a "what will run" preview.
   - **Files** (built-in): append / write / read. Read outputs text or lines.
   - **HTTP request** (built-in, advanced): method, URL, body form, credential picker ("Connect…" once per service — no secrets namespace).
   - **GitHub**: create PR, list my open PRs. **Notion**: add database row (pick database → its columns render as fields). **Azure DevOps**: create work item.
2. **Your MCP tools, called directly.** Any MCP server the user has configured appears in the catalog. The *author* picks the tool and fills its parameters at authoring time (form auto-generated from the tool's schema, chips allowed); the engine makes a plain RPC at runtime. Deterministic — the agent is not in this loop. Reuses the server's existing auth.
3. Curated read/list actions matter as much as effects — they produce the list tokens that feed Repeat blocks.

If a script step grows `curl` + `jq` plumbing, that signals the catalog needs a curated connector — the escape hatch must not become the place automations turn back into programs.

### Notify me

A desktop/mobile notification: message with chips, links to the run and to any chat the run created. Automations that end silently feel dead; this is the default final step suggestion.

## 6. Blocks — the only two

### If … otherwise

Condition = structured row: **⟨token⟩ · comparator · value**. Comparators follow the token's type — text: is / is not / contains / starts with / is one of; number: = / < / >; list: is empty / is not empty / contains; choice answers: a dropdown of their own options (plus "is one of" with multi-select). Multiple rows combine with an all/any toggle. Two branches only; a rare three-way case nests an If inside "otherwise."

### Repeat for each

Iterates a list-typed token (a list action's output, a multi-choice answer, command output as lines). Inside the bracket, the picker gains **⟨Current item⟩**, with fields when items are structured (⟨Current PR → URL⟩). No index variable, no naming.

### Rules that keep blocks honest

1. **No expression language, ever.** The moment a condition needs computation ("temp above last week's average"), that's an agent step or a smarter action — never a formula field.
2. **Scoping is invisible.** The picker shows everything above the current step, plus ⟨Current item⟩ inside a Repeat. Out-of-scope tokens simply don't appear.
3. **Two bracket types, visually distinct.** Contents are forms, not grammar. Expected nesting depth: one, occasionally two.
4. **Out:** parallel (sequential is imperceptible here), while/repeat-until (unbounded loops are the agent's job), N-way choose.

## 7. Tokens — dataflow

Every producing step contributes chips automatically: trigger context, form answers, action outputs, ⟨Agent result⟩. Plus built-ins: ⟨Today⟩, ⟨Now⟩. Chips insert into any text field via a picker (and a `⟨` / keyboard affordance). Tokens display friendly names and a source color/icon; users never see ids or paths. Substitution is literal — no filters, no coalescing, no functions.

## 8. Runs, pauses, failures

- Each automation has a **Runs** list; a run shows the step timeline with per-step status, output preview, and links (agent steps → their chat).
- A run paused on **Ask me** renders the form inline in the run view and notifies desktop + mobile.
- Failure default: a failed step fails the run; the user gets a notification naming the step. Per-step override: "keep going if this fails." No retry/backoff configuration — transient retries happen silently or not at all.
- Missed schedules follow the trigger's toggle (§4). Runs survive app restarts; durability is an engine property, never a concept in the UI.
- Agent sessions created by automations are tagged and grouped in the sessions list so dailies don't flood it.

## 9. Reuse and composition

- **No sub-workflows, no inputs/outputs schema.** Automations are not functions.
- Reusable *procedures* are **skills / slash commands** — e.g. `/ship-work` — invoked from any Ask-agent step or any chat. Typed inputs are the skill's arguments.
- Automations chain through the *"when automation X finishes / fails"* trigger — pipeline style, no nesting, no parent/child run trees.

## 10. Creating an automation

The blank state offers two paths:

1. **Describe it.** "Every evening ask me about the kid's health and log it to Notion" → the assistant drafts the When/Do blocks; the user tweaks. The artifact is always the editable block list, never a buried prompt.
2. **Build it.** Pick a trigger, add steps from the Add menu (verbs pinned on top, action catalog searchable below).

Validation is plain-language and inline ("This step uses an answer from a form that comes later — move it below"), shown on the offending step, not in a panel.

## 11. Engine notes (for scoping, not for design)

The v1 runtime largely survives underneath: scheduler, checkpointing/resume, the question-interaction pause, agent-session step, credential store. v2 is a much smaller schema plus a new authoring and run surface. Deleted: YAML scanning/editing, JSONata, choose/foreach/parallel/call as authoring concepts, the builder⇄YAML sync.

## 12. Reference automations

The design should demo these end to end:

**Daily health log**
> When: every day at 21:00
> ① Ask me: *Health check-in* (mood choice, appetite choice, sleep number, symptoms multi — "other" shows a text field)
> ② Run action → Notion: add row to ⟨Health Log⟩ (Date ⟨Today⟩, Mood ⟨mood⟩, Sleep ⟨sleep⟩, Symptoms ⟨symptoms⟩)
> ③ Run action → Files: append to `~/notes/kid-health-log.md` (templated with chips)

**Daily standup**
> When: every day at 8:00 (skip missed)
> ① Ask agent: `/pending-work`
> ② Notify me: "Your day plan is ready" → links to the chat

**PR auto-review**
> When: a pull request is opened
> ① Ask agent: `/codex-review ⟨PR URL⟩`

**Morning PR sweep** (deterministic loop dispatching agent work)
> When: weekdays at 9:00
> ① Run action → GitHub: list my open PRs → ⟨Open PRs⟩
> ② Repeat for each ⟨Open PRs⟩ → Ask agent: `/codex-review ⟨Current PR → URL⟩`

**Ship work** (mixed determinism + branch)
> When: manually
> ① Ask me: *Link an ADO item?* (link existing → ID field / create new → title, description / skip)
> ② If ⟨action⟩ is `create new` → Run action → ADO: create work item → ⟨Work item ID⟩
> ③ Run action → GitHub: create PR (title ⟨title⟩, body includes AB#⟨Work item ID⟩ when present)
> ④ Ask agent: "Remove the worktree for ⟨branch⟩ and leave everything consistent"

**Daily feature spike** (agent-heavy)
> When: weekdays at 6:00
> ① Ask agent (fresh worktree · auto-approve edits/pnpm/git · budget cap): "Read docs/ideas and recent commits. Pick ONE xs/s feature — if nothing qualifies, stop and say why. Plan, TDD-implement until green, push, then `/ship-work`."

## 13. Screens and states to design

1. **Automations library** — list with trigger summary, last-run status, on/off toggle, Run now; empty state with the two creation paths (§10).
2. **Editor** — When card(s) + linear Do list; Add menu (verbs pinned, searchable action catalog below); If/Repeat brackets with inline add inside; More-options disclosure on step cards; inline plain-language validation.
3. **Token picker** — grouped by source step, typed chips, ⟨Current item⟩ inside Repeat.
4. **Action catalog** — curated connectors, MCP tools, built-ins; an action's auto-generated form; credential "Connect…" flow.
5. **Ask me form config** — field list with types, required, conditional visibility.
6. **Run view** — step timeline; paused-on-form state (inline form); failed state (which step, keep-going marker); links to agent chats.
7. **Notifications** — run finished / run failed / form waiting.
