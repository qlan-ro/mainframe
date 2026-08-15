# Claude "Auto" permission mode

Todo #325 · route: full · branch `todo/325-claude-auto-permissions-mode`

## Problem

Mainframe offers three permission modes — Interactive, Auto-Edits and Unattended. The Claude
CLI offers six, and one of them, `auto`, sits in the gap users keep landing in: Auto-Edits still
stops for every command, Unattended stops for nothing. In `auto` the CLI decides per tool use
which actions need approval and asks only for the rest. A 2026-08-14 probe of CLI 2.1.224
confirmed the mode is live, not dormant: under `auto` the CLI wrote a file, ran a network
`curl` and deleted a file without prompting, where `acceptEdits` refused the network call.

Mainframe has no way to select it. A user who wants the CLI's Auto behavior has to leave
Mainframe and run the CLI directly, or pick Unattended and give up prompting entirely.

## Behavior

Auto becomes a fourth permission mode, offered only where the running adapter supports it.
Claude supports it; Codex does not.

**Choosing Auto.** The composer's permission picker lists Auto between Auto-Edits and
Unattended, preserving the least-to-most-permissive reading. Its description says what the
mechanism is, not how smart it is: Claude decides which actions need approval. The option
appears only when the session's adapter advertises auto-mode support, and the picker is
otherwise unchanged — a Codex session still sees exactly three options.

**Before the first send.** Auto chosen on a draft is stored on the draft and reaches the CLI as
the spawn-time mode on the very first turn. No warm-up turn in another mode.

**Mid-session.** Switching to Auto on a live session takes effect for the next tool use through
the same runtime mode-change path the other three modes use. The CLI is not respawned and the
session is not lost. Switching away from Auto behaves symmetrically.

**Plan mode.** Turning plan mode on and then off restores Auto when Auto was the mode the user
last chose, exactly as it restores the other three today. Plan remains a separate toggle, not a
fourth-and-a-half mode.

**The approval gate is invariant.** Any tool use the CLI still asks about arrives as an ordinary
permission request and renders the same gate card, the same queue and the same reply path as in
any other mode. Tool uses the CLI auto-allows never reach Mainframe at all. Nothing about the
gate changes because of this mode.

**Provider default.** A provider's default session mode can be set to Auto when that provider
supports it, and a new chat created with no explicit mode inherits it through the existing
default-resolution path. The provider settings list is filtered by the same capability as the
composer picker, so the two lists never disagree.

**Automation steps.** The Ask-Agent step's permission picker is filtered by the same capability,
resolved from the provider that step runs on. A step pointed at Claude offers Auto; a step
pointed at Codex does not.

**Visual treatment.** Auto reads as a caution: a warning tint, matching the CLI's own
presentation of the mode and reusing the tint the app already applies to warnings elsewhere.
Unattended keeps its destructive tint. The two must not look alike, in either the picker option
or the picker trigger when that mode is active.

**Unsupported combinations.** A chat whose stored mode is `auto` but whose adapter has no
auto support starts in Interactive and logs the coercion. It never fails the spawn.

**Validation.** An unknown or unsupported mode string sent to the chat-config update route is
still rejected with the existing validation error. `auto` is now a recognized value everywhere
the other three are: request body, stored row, and the value read back after a daemon restart.

## Not Included

- The CLI's other unexposed modes — `dontAsk`, and `plan` as an execution-mode value rather
  than the existing boolean. `deferred`
- The CLI's rename of interactive mode to `manual` in `--permission-mode` help. `default` is
  still accepted by CLI 2.1.224, so the existing spawn path is unaffected. `deferred`
- Any Codex-side equivalent of Auto, or teaching Codex to act on the mode beyond coercing it.
  `declined`
- Mobile UI for the new mode. The daemon contract change is additive — a new enum value on an
  existing field — which is all the submodule needs; a mobile picker is a separate PR in that
  repo. `platform`
- Version detection or per-flag capability probing of the installed CLI. Older CLI builds that
  predate external `auto` are handled by documenting a minimum version, not by probing.
  `declined`
- Any Mainframe-side classification or auto-approval logic. Every allow/ask decision stays with
  the CLI. `declined`
- The known gap where replying to a restored permission whose CLI process died fails with
  "stream closed". Unrelated to this mode and unchanged by it. `deferred`

## Edge cases

1. **Capability not yet known.** The adapters store seeds a placeholder that reports no
   capabilities until the real snapshot arrives. During that window Auto is absent from the
   list, which is correct — but a chat already on Auto must still show "Auto" on the picker
   trigger, not a raw mode string. An option filtered out of the list must never produce a
   wrong label.
2. **Auto on a Codex chat.** Stored `auto` on an adapter without the capability spawns in
   Interactive with the coercion logged. No error, no failed spawn, no silent drop.
3. **Unparseable stored mode.** A mode string the daemon cannot parse reads back as unset
   (falling through to the provider default), not as an error — the behavior that exists today
   for any junk value. Adding `auto` does not change it, and `auto` itself must now parse.
4. **Plan mode over Auto.** Plan on, then plan off, restores `auto` — not `default`.
5. **Switching mid-turn.** Selecting Auto while a turn is running applies from the next tool
   use, as the existing modes do; it does not retroactively affect an in-flight approval
   already showing in the gate.
6. **Provider default set to Auto, then the provider loses the capability** (downgraded CLI,
   adapter uninstalled): existing chats fall back per case 2, and the setting is simply not
   offered on the next visit to the settings pane.

## Acceptance criteria

1. The shared TypeScript execution-mode union and its Rust mirror both expose `auto`, and a
   serialization test on each side asserts the wire value is the literal string `auto`,
   including the flattened permission-mode enum that also carries `plan`.
2. A Claude session spawned with Auto passes the CLI mode flag with the value `auto`, asserted
   by an argv test alongside the existing `default` / `acceptEdits` / `bypassPermissions` cases.
3. A mid-session switch to Auto sends the runtime mode-change request carrying `auto`, asserted
   the same way the existing modes are.
4. Turning plan mode on and then off while the base mode is Auto restores `auto`, not `default`.
5. The chat-config update route accepts `auto`, persists it, and returns it on a subsequent
   read; an unrecognized mode string still fails validation with the existing 400 error shape.
6. A stored `auto` survives a daemon restart: the chat row read back after restart still
   reports `auto`.
7. The composer permission picker shows Auto for an adapter advertising the capability and does
   not show it for one that does not; a test covers both.
8. The Auto option and the Auto trigger render with the caution treatment, and a test asserts
   they do not carry the destructive treatment reserved for Unattended.
9. When the chat's mode is `auto` and the adapter capability is not yet known, the picker
   trigger still reads "Auto".
10. A chat whose stored mode is `auto` running on an adapter without the capability spawns
    successfully in Interactive, and the coercion is logged (the Codex mode mapping handles the
    variant as an explicit branch, not a fallthrough).
11. A permission request received while the mode is Auto renders and replies exactly as it does
    in the other modes, covered by an existing or added gate test.
12. The provider default-mode setting accepts Auto for a supporting adapter and does not offer
    it for a non-supporting one; a new chat created with no explicit mode inherits it.
13. The automation Ask-Agent step's permission picker offers Auto only when the step's resolved
    provider advertises the capability; a test covers both directions.
14. Every new interactive element carries a kebab-case `data-testid` following the existing
    naming — `composer-permission-mode-select-option-auto`, `settings-<adapterId>-mode-option-auto`.
15. The minimum Claude CLI version required for `auto` is documented in the Claude adapter docs.
16. `cargo check` and the UI typecheck pass, the new and existing adapter/route/UI tests pass,
    and the PR includes a changeset.

## Decisions

- **Native CLI `auto`, not a Mainframe-invented mode.** `reversible` — the mode is external and
  valid in the installed CLI and its allow path is live (probe, 2026-08-14); a synthetic mode
  under the same label would diverge from what the CLI does.
- **No CLI version detection; document a floor instead.** `reversible` — the adapter has no
  per-flag capability probe today, and building one for a single mode is disproportionate.
- **Claude-only, gated by an adapter capability flag on the existing capabilities contract.**
  `hard-to-reverse` — adds a member to the wire-visible capabilities object consumed by the UI
  and by mobile. Follows the `planMode` precedent; never an adapter-id string comparison.
- **`auto` is a fourth value of the one canonical execution mode, not a Claude-local type.**
  `hard-to-reverse` — the enum is mirrored in Rust, persisted in SQLite, and carried on the
  daemon wire; widening it later is easy, narrowing it after rows exist is not.
- **A Codex session carrying `auto` runs as Interactive and logs the coercion.** `reversible` —
  most conservative reading; failing the spawn would punish the user for a config they cannot
  see. Codex's mapping already lands there via its `else` branch, but it becomes an explicit arm
  so the next mode addition cannot inherit it by accident.
- **UI copy describes the mechanism, not the intelligence** — "Claude decides which actions need
  approval". `reversible` — stays honest whichever way the CLI's classifier behaves, and
  promises no reduction in prompts.
- **Caution treatment, not destructive.** `reversible` — the CLI itself colors Auto at warning
  level, and the app already ships a warning tint used on the same composer surface where
  Unattended uses the destructive tint; matching that pair keeps the risk ordering readable.
  The user's 2026-08-14 ruling upheld this after the probe showed Auto is permissive in headless
  runs; do not re-litigate it in this lane.
- **The provider default-mode setting offers Auto too, filtered by the same capability.**
  `reversible` — keeps the two mode lists consistent; a default the composer cannot show would
  be a trap.
- **Auto sits between Auto-Edits and Unattended in the picker.** `reversible` — preserves the
  least-to-most-permissive reading of the list.
- **The automations Ask-Agent permission picker is filtered by the step's resolved provider**
  (lane ruling; the brief does not mention this surface). `reversible` — that picker iterates
  the shared mode list, so without a filter Auto would leak into Codex steps; the step already
  carries an adapter id, and the brief's own principle is that mode lists become
  capability-filtered. The cheap alternative, if the reviewer prefers less scope: leave the
  automations picker on the three original modes and defer Auto in automations.
- **Design direction was delegated to the lane** (user, 2026-08-14). `reversible` — the visual
  calls above were made from the brief's Decisions section and the closest shipped patterns
  (the composer picker's existing destructive tint for Unattended, and the app's existing
  warning tint), not from a prototype.
