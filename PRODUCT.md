# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The desktop app is a Tauri shell (WKWebView on macOS) around the shared React UI in `packages/ui`. macOS is the primary and only tested desktop platform; Windows and Linux builds exist but are untested. The mobile companion lives in a separate repository (`packages/mobile` submodule).

## Users

The primary user is a developer, the maintainer first, who runs four to six Claude and Codex sessions at once across several projects from a Mac. They switch between sessions constantly, check on long-running work, answer permission prompts and plan gates, review diffs, and queue the next instruction while an agent is still busy. They are keyboard-heavy and judge the app by how calm it stays when a lot is happening.

## Product Purpose

Mainframe brings AI coding agents into one interface instead of a pile of terminal windows. It adds what a terminal cannot: an overview of every session and what it is doing, visual file editing and diffs, live sandbox previews with an inspector, task management, cross-project session history, and a phone companion. Success is the user keeping several agents productive at once without losing track of any of them.

## Positioning

All four are central and confirmed:

- **Multi-provider:** Claude, Codex and potentially other agent CLIs in one interface, with the same workflow for each.
- **Parallel sessions in worktrees:** many sessions at once, each optionally isolated in its own git worktree, with an overview of who is doing what.
- **Daemon, remote and mobile:** a headless, API-first daemon spawns and supervises the CLIs; the desktop app embeds one, can pair with daemons on servers, and a phone app can drive any of them.
- **Workspace around the agent:** editor, diffs, sandbox preview with inspector, tasks and kanban, and automations sit next to the session rather than in other tools.

## Operating Context

- Sessions run Claude Code and Codex CLIs underneath; permission modes, plan mode, models and effort levels come from those CLIs and differ per provider.
- A session belongs to a project and runs in the local checkout, a worktree, or as a temporary session (deleted when closed); worktree and temporary are mutually exclusive.
- Users split the window across several sessions, use a side chat, and keep a session panel (context, plan, activity, background tasks, changes) beside the transcript.
- Work continues while the user is away: background tasks, queued messages, automations and scheduled runs, with the phone as a second client.
- The repository keeps a design canvas ("Mainframe App", claude.ai artifact `GxH1152i4cHJ87B8m1pKgC`) with baseline boards captured from the real app and a Proposals page; its source is `design/` in the repository, and the hosted copy is published from `main`.

## Capabilities and Constraints

- Stack to keep: Tauri 2 desktop shell, React with Tailwind CSS v4, Radix-based primitives in `packages/ui/src/components/ui`, assistant-ui for the thread and composer, a Rust daemon in `packages/core-rs`.
- Every existing feature stays reachable through a redesign; capabilities can move, merge or hide behind menus, but not disappear without an explicit product decision.
- Decided 2026-11-23: the permanent Plan toggle in the composer is retired. Plan mode remains, started by the provider's "Start in Plan Mode" setting or by the agent itself, and must stay visible as status.
- Decided 2026-11-23: context usage is always visible in the composer.
- Terminology: the app uses "session", "project", "worktree", "temporary", "permissions" (Interactive, Auto-Edits, Auto, Unattended).
- Undecided: whether mobile shares the redesigned visual system; the redesign starts with the main window (sidebar, transcript, composer, session panel), and settings, automations, tasks and mobile follow.

## Brand Commitments

- Name: Mainframe. Open source (MIT), built by one person; the README voice is plain, candid and informal.
- Provider brand colours mark providers (Claude `#d97757`, OpenAI/Codex `#19c37d`) where a logo would be too loud.
- The visual direction is the window redesign approved on 24 Nov 2026: `DESIGN.md`, with the decisions in `design/redesign/DECISIONS.md`. Areas it has not reached yet keep the incumbent look.

## Evidence on Hand

- README screenshots and demo video (desktop and `docs/screenshot-mobile.png`).
- Design canvas baselines captured from the real app (`design/canvas/`).
- No user research, usage analytics, testimonials or customer list exist; future work must not invent them.

## Product Principles

1. Calm at equal content: several busy sessions must read as quiet, scannable status, not noise.
2. Every session's state is glanceable: running, waiting on you, where it runs, how full its context is.
3. Status over settings: what the agent is doing outranks configuration the user rarely changes.
4. Keyboard first, mouse complete: every frequent action has a shortcut, and every shortcut action has a visible control.
5. Provider-neutral: Claude and Codex feel like the same product, with differences shown only where they change what the user can do.

## Accessibility & Inclusion

No formal standard is mandated. Existing practice to keep: text at 4.5:1, visible keyboard focus at 3:1, targets of at least 24 px, reduced-motion support for animated status.
