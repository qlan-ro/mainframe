# @qlan-ro/mainframe-ui

## 2.0.0

### Major Changes

- [#398](https://github.com/qlan-ro/mainframe/pull/398) [`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Mainframe 2.0 — Tauri desktop shell.

  Ships the Tauri 2 desktop app (`@qlan-ro/mainframe-app-tauri`) alongside the
  existing Electron shell. The React renderer moves into a shared
  `@qlan-ro/mainframe-ui` package consumed by both shells, the daemon ships as a
  bundled Node sidecar, and the UI is rebuilt on assistant-ui + shadcn/ui. Also
  includes the workflows engine, remote-daemon support, and a browser-mode
  Playwright e2e suite.

### Minor Changes

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the automations editor around values you can name and reuse. Every text field in an automation now accepts `$name` references through the same picker, a Set value step names a result once so later steps can use it, and renaming that value rewrites every step that referred to it. Write `${name}` where a bare `$name` would run into surrounding text, as in `todo/${id}`.

  Each step that produces a value carries its own name, so reordering steps no longer silently repoints a reference at a different step. Two values sharing a name is reported as a problem on both, rather than one quietly winning.

  Webhook triggers can be registered from the editor, which now shows the signing secret alongside the URL — without it a registered hook rejected every delivery. The secret is shown on request and never leaves the editor; reveal it again any time, it does not change.

  Problems are reported on the step that caused them, including the ones the daemon finds at save time, which used to appear only as a toast. A reference to a name nothing defines is a warning rather than an error, so a prompt containing `$HOME` no longer blocks saving.

- [#465](https://github.com/qlan-ro/mainframe/pull/465) [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).

- [#425](https://github.com/qlan-ro/mainframe/pull/425) [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface background work (subagents, background bash tasks, workflows) in the working indicator: the tracker registers every CLI task kind, `enrichChat` broadens the sidebar 'working' state and attaches a `backgroundActivity` payload, drain turns re-enter 'working', and a new BackgroundActivityBar chip above the composer lists live tasks.

- [#634](https://github.com/qlan-ro/mainframe/pull/634) [`a8ec7b1`](https://github.com/qlan-ro/mainframe/commit/a8ec7b1878df3f9562591ab070a90bff98e8a8d2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the Claude CLI's native `auto` permission mode as a fourth, capability-gated execution mode. The composer picker, provider settings, automations Ask-Agent chip, and plan gate all offer Auto for adapters that advertise it, letting Claude decide which actions need approval without leaving Mainframe's permission gate.

- [#543](https://github.com/qlan-ro/mainframe/pull/543) [`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the models a locally running CLIProxyAPI serves as selectable Claude-adapter models. When the proxy answers on `127.0.0.1:8317`, its catalog is merged into the Claude adapter's under `cliproxy/`-namespaced ids and appears in the composer's model picker under a "CLIProxyAPI" section, below the native Claude models. Entries read like the native ones — "OpenAI - GPT 5.6 Sol", not `gpt-5.6-sol`, with a caption naming the cut of the model and the account that answers for it — and the section is ordered by provider, then capability, instead of however the proxy happened to list them. Picking one spawns the same `claude` CLI against the proxy — `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` point the child at the endpoint, `ANTHROPIC_DEFAULT_HAIKU_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` give it a background model the proxy actually serves, and any inherited `ANTHROPIC_API_KEY` is removed so the session can't fall back to the real account.

  The proxy's API key is read from its own config file at spawn time and never stored in Mainframe's database or the OS keyring; set `MAINFRAME_CLIPROXY_CONFIG` if the config lives outside the standard Homebrew paths. Rate-limit events from a proxy session no longer update the Anthropic quota indicator, which measures a subscription the session isn't billing. Switching a chat between a proxy model and a native one respawns the CLI instead of hot-swapping the model, since the endpoint changes with it.

  Nothing changes when no proxy is running: the group is absent from the picker, and the Providers settings pane reports it as not detected. Title generation and account quota deliberately stay on the real Anthropic account.

- [#430](https://github.com/qlan-ro/mainframe/pull/430) [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make chat title generation adapter-aware and import Codex sessions from disk. Title generation now runs behind an optional `Adapter.generateTitle` (Claude implements it; Codex keeps its deterministic first-message title instead of cross-spawning the `claude` binary). Codex external-session import scans the rollout JSONL files under `~/.codex/sessions` — matching a session to a project by its recorded `cwd` — so sessions started outside Mainframe show up too.

- [#408](https://github.com/qlan-ro/mainframe/pull/408) [`f3e63b6`](https://github.com/qlan-ro/mainframe/commit/f3e63b6e3151b2dcd76b0ed737a1e3734677369f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface the daemon version. `mainframe --version` (also `-v` / `version`) prints
  the installed binary's version, `mainframe status` shows the **running** daemon's
  version, and `GET /health` now returns a `version` field. The version is inlined
  into the bundle at build time (esbuild `define`), with a `package.json` fallback
  for dev and unbundled runs.

- [#424](https://github.com/qlan-ro/mainframe/pull/424) [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect deleted CLI transcripts and unify degraded-chat recovery: a persisted `transcriptMissing` flag (new `transcript_missing` column) reconciled on history load and on the periodic scan, a typed `{ messages, transcriptMissing }` history payload, recovery routes (recreate-worktree, continue-here, continue-in-project-root), and one degraded-chat card in the thread replacing the composer worktree banner, with a unified sidebar marker.

- [#657](https://github.com/qlan-ro/mainframe/pull/657) [`cec67c4`](https://github.com/qlan-ro/mainframe/commit/cec67c4234d02f09996e707b9932a450d46570d8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Workspace surface's Files panel is now a persistent docked sidebar on the right edge instead of a floating overlay — it resizes the content pane rather than covering it, and stays open across file picks. Its open state persists per project/worktree, and it closes only via its own toggle (no more light-dismiss on Escape or an outside click). The trigger icon changed from a folder glyph to `PanelRight`, mirroring the left sidebar's static `PanelLeftIcon`.

- [#616](https://github.com/qlan-ro/mainframe/pull/616) [`17500db`](https://github.com/qlan-ro/mainframe/commit/17500dbad1159190da449bdfa775dead7c89da59) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a System appearance setting that follows live operating-system theme changes.

- [#466](https://github.com/qlan-ro/mainframe/pull/466) [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebind any keyboard shortcut in Settings → Keybindings. Recording a chord another action holds offers to take it, and the loser is left unassigned rather than silently sharing the key.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the nine independent keydown listeners with one declarative shortcut registry and a single dispatcher, add the session-tab (⌃1…⌃9, ⌃Tab/⌃⇧Tab), open-in-split (⌘⇧\\), focus-composer (⌘L) and cheat-sheet (⌘/) bindings the app lacked, and ship a read-only cheat sheet (also reachable from the command palette) that renders every declared shortcut.

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename the daemon CLI to `mainframe` and add a `mainframe update` command.

  The standalone binary is now `mainframe` (the old `mainframe-daemon` name still
  ships as an alias, so existing systemd units keep working). `mainframe update`
  upgrades a standalone install in place: it downloads the matching release tarball
  for the host platform and unpacks it over `~/.mainframe/bin`. Supports
  `--pre` (include pre-releases), `--version <tag>`, and `--dir <path>`; the daemon
  keeps serving until you restart it.

- [#536](https://github.com/qlan-ro/mainframe/pull/536) [`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reference another session from the composer with `@`.

  Typing `@` in the composer now offers other sessions in the project alongside files and agents. Picking one inserts `@label`; sending the message prepends a reference line carrying the session's transcript path, and the sent message renders the mention as a chip instead of the raw path. Session titles are now derived from what the message showed the reader, so neither a reference line nor a preview-capture block can leak into a sidebar title.

- [#542](https://github.com/qlan-ro/mainframe/pull/542) [`39daa55`](https://github.com/qlan-ro/mainframe/commit/39daa550646397b31943ab6f747ea8f1fa42948d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Run surface can open any http/https URL in a tab, tunnelling loopback URLs on a remote daemon.

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.

- [#567](https://github.com/qlan-ro/mainframe/pull/567) [`316adb2`](https://github.com/qlan-ro/mainframe/commit/316adb2bf2d2f81dac20eed21e09139485d00d0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the inspector's Changes tab and the Context/Skills/Agents bottom panel with a session panel inside the chat surface: collapsible Summary, Plan, Background Activity, Launch and Context sections on a translucent glass card. The panel floats in the whitespace beside the centred transcript and never takes width from it. It collapses to a quick-action icon rail (panel, background activity, context usage, run) when the gutter is too short for it or on demand, and a rail click brings it back — inline where there is room, floating over the transcript where there isn't. The collapse and the open sections persist across sessions. Background activity moves out of the composer footer, launch controls move off the toolbar into the rail and Launch section, the chat header's context meter is gone, and the review modal gains a Session/Uncommitted/Branch scope switcher.

- [#624](https://github.com/qlan-ro/mainframe/pull/624) [`7f1ebda`](https://github.com/qlan-ro/mainframe/commit/7f1ebdae1222011ae39226da13d99a140bba9c67) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Give session tabs a right-click menu, so the split gestures are reachable without knowing them.

  Splitting the chat surface had no discoverable entry point from the strip: ⌘-click opens a split, dragging a tab retargets one, and ⌘\ dissolves one, but a tab announced none of it. Right-clicking a tab now offers Open in Split — disabled precisely when the gesture has nowhere to go — or, on a tab already in the pair, Close Split, which dissolves it and leaves you on the session you pointed at. A parked pair dissolves without moving focus. Keep Open (on the preview tab) and Close round the menu out. The menu performs the existing gestures rather than adding new ones: the enabled state and the action now read from one shared `canOpenInSplit` predicate, so the offer can't drift from what the gesture does.

- [#573](https://github.com/qlan-ro/mainframe/pull/573) [`181bff0`](https://github.com/qlan-ro/mainframe/commit/181bff09a3e96560a128df3bc43c0a1dbef2851f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session tabs, toolbar identity rework, and the workspace Files sidebar. Chrome-style session tabs live in the title bar (the active session is the focused tab); the toolbar's left identity section is gone and the branch manager is a compact chip in the right control cluster; the Files tree moves inside the workspace surface as a floating panel opened from the strip's Files button (the app-level Inspector pane is removed); the chat surface header grip now repositions the surface like the workspace grip does.

- [#464](https://github.com/qlan-ro/mainframe/pull/464) [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.

- [#521](https://github.com/qlan-ro/mainframe/pull/521) [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface the Setup Advisor in the toolbar. Opening it fingerprints the active project and lists the MCP servers, skills, hooks, subagents, and plugins that its stack earns, one tab per category, each command a click away from the clipboard. Every recommendation shows the signal that triggered it, and a third-party rule names its source repo and install count in a distinct chip — an aggregator install stays a decision, not a surprise.

- [#463](https://github.com/qlan-ro/mainframe/pull/463) [`c8db301`](https://github.com/qlan-ro/mainframe/commit/c8db301b70304c5936444327565591ff4412eabf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the sessions sidebar: compact single-line rows, a hover detail card, a one-click project switcher list, and an opt-in "Sort by Project" grouping mode.

  Session rows collapse from two lines to one — the status indicator, title, and time now share a single row, with worktree/PR/tag info reduced to small trailing glyphs. Hovering a row raises a floating detail card with the full project, worktree/branch, PR, tag, and branch-safety information the row no longer shows inline. The Projects filter bar becomes a vertical switcher list ("All projects" plus one row per project with a colored initial avatar and attention badge) instead of a wrapping pill cloud, and selecting a project is now a plain single-select switch rather than a toggle. The sessions Sort By menu gains a "Project" option that groups the list into one section per project; the time-based default is unchanged. Relative timestamps for same-day sessions now read as a short duration ("5m", "2h") instead of a clock time. The worktree glyph switches from `GitFork` to `FolderGit2` everywhere it represents a worktree (composer, toolbar, git panel, session rows), leaving the unrelated branch glyph untouched.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Browse skills.sh from the Setup Advisor. The Skills section is now one list — the skills you have, then the registry's most-installed — with search covering the whole registry rather than the visible rows. An installed row reads "Installed" and swaps to Uninstall on hover, so no row offers to install something you already have; installing asks which scope on the Install button itself, at the moment you install. Two daemon routes back it, and the list degrades to search-only when the registry catalog can't be read, keeping your installed rows. Both reads report themselves: the list waits as skeletons rather than briefly offering to install skills you already have, and a refresh or a search marks the search field while it runs.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Install and uninstall skills from the Setup Advisor's new Skills section, run through the `skills` CLI on the daemon host.

- [#523](https://github.com/qlan-ro/mainframe/pull/523) [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Turn two things agents write into chat into things you can act on. A slash instruction in an assistant message becomes a chip that adds the instruction to the composer or opens a new session prefilled with it — neither sends, so you still decide. A localhost URL becomes a chip that opens the link when the daemon is your own machine, and offers to tunnel the port when it isn't, so a dev server running on a remote daemon is one click away instead of an SSH session. Tunnels are listed in the remote-access pane with a stop control, and they close when the chat's scope does.

- [#525](https://github.com/qlan-ro/mainframe/pull/525) [`84e28ef`](https://github.com/qlan-ro/mainframe/commit/84e28ef751338b9f237a2c84647d2dff00388c16) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Copy file paths and quote text straight from a chat message.

  Right-clicking a file path in a tool result offers Copy Absolute Path and Copy Relative Path. Both are derived from the same worktree and project roots that left-clicking the path opens with, so the path you copy and the file you open can never disagree. Markdown links keep their own copy/open menu, and paths inside a subagent transcript are left to the system menu.

  Selecting text in a message raises a floating toolbar with Quote and New session. Quote adds the selection to the composer as its own quote with its own comment box, so several passages — including passages from different messages — can be quoted and sent as one message. New session opens a draft on the same project, prefilled with the selection. Neither action sends anything on its own. The editor's Add Agent Context now adds a quote the same way, and a quote carrying no comment can be sent for the first time.

- [#551](https://github.com/qlan-ro/mainframe/pull/551) [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude Code workflow runs now show their phases, agents and totals in a details panel, reachable from the transcript and the background-activity popover.

- [#559](https://github.com/qlan-ro/mainframe/pull/559) [`69aad41`](https://github.com/qlan-ro/mainframe/commit/69aad410a149b9e608eb5b996a06b2fbabccc314) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tasks board: two-way GitHub Issues sync — link a repo, import or publish tasks, and reconcile title, body, state, and labels with an after-the-fact overwrite report.

- [#548](https://github.com/qlan-ro/mainframe/pull/548) [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude's attention requests now raise a Mainframe notification, including a native desktop banner, with a new Chat setting to turn them off.

- [#534](https://github.com/qlan-ro/mainframe/pull/534) [`58b017f`](https://github.com/qlan-ro/mainframe/commit/58b017f57d7edc57ba277201c114201288d78975) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Warn before a model, effort, or tuning-feature change is applied to a session that already has history. The confirm names what is changing in its title, then explains that changing the model or reasoning effort invalidates the cached context, so the next message re-sends the conversation as new input and contributes to your usage or cost. It quotes the approximate size when the CLI has reported it. Nothing reaches the daemon until you confirm; cancelling leaves the control where it was. A chat with no messages, and a re-pick of the value already in effect, behave exactly as before, and a "Don't warn again" checkbox turns the confirm off for all three controls for good.

  The model picker is now inert while the assistant is working, matching the effort and features controls, so no control can reach a running CLI mid-answer.

- [#452](https://github.com/qlan-ro/mainframe/pull/452) [`f4c77d4`](https://github.com/qlan-ro/mainframe/commit/f4c77d47241645b41c70c32dcb0f1b9b0727d886) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Overhaul UI typography and text-color legibility. Re-tint the tertiary/semantic ink tokens (mf-text-3, mf-success, mf-warning) across all six themes so they clear WCAG 4.5:1, reclassify mf-text-4 as ornament-only, and add a globals.css contrast guardrail test. Re-anchor the UI scale factors (compact 0.92 / normal 1.0 / large 1.15) so normal mode renders crisp un-zoomed 13px text and compact is legible. Repair shared primitives (button icon default, menu/dropdown/command eyebrows, tooltip size) and add CountBadge + SectionHeader. Sweep every surface to promote must-read text off 10–11px, move semantic hues off text onto icons/tints, replace the invisible white-on-accent count badges with capsule-less counts, and give session-row selection a macOS-style neutral fill. Fixes hundreds of contrast and small-text findings from the 2026-07-11 legibility audit.

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

- [#520](https://github.com/qlan-ro/mainframe/pull/520) [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer to move a session into a worktree the agent just created. When an agent adds a worktree mid-session, the composer surfaces it as an offer: accept and the session rebinds and restarts there, dismiss and it stays dismissed for that chat. Sessions already isolated in a worktree can move to another one from the existing worktree popover.

### Patch Changes

- [#629](https://github.com/qlan-ro/mainframe/pull/629) [`ce1d38d`](https://github.com/qlan-ro/mainframe/commit/ce1d38dc1408d8d70a88eed870ed24db171e71d4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop showing a padlock on providers that are installed. The boot snapshot reports every adapter as uninstalled when the CLI probe outruns the daemon's 2s cap, and the follow-up catalog event refreshed the models without clearing that flag — so a brand-new session could offer Claude's full model list while both provider tabs sat disabled. The event now carries the probe's verdict, and the client applies it.

- [#441](https://github.com/qlan-ro/mainframe/pull/441) [`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep adapter model catalogs aligned with installed CLIs: Codex discovery now uses the configured executable, unset Codex models inherit the account default, Claude removes the explicit alias that duplicates its semantic default, and stale saved provider defaults no longer leak raw model ids into new chats.

- [#418](https://github.com/qlan-ro/mainframe/pull/418) [`1e376ba`](https://github.com/qlan-ro/mainframe/commit/1e376babf480d38b43d723cfbe32c18b78c226b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Always show the branch chip in the titlebar, for main-repo sessions too.

  The toolbar branch chip used to render only for worktree sessions, because it derived its label from the persisted `chat.branchName`, which is set only when a session runs in a worktree. It now reads the live current branch from git on mount, so a session on the shared main repo shows and can switch its branch as well. Matching the Workspace Surfaces artboard, a worktree session gets an accent-tinted chip with a fork glyph and a "WT" badge, while a main-repo session stays neutral; the tooltip names which.

- [#476](https://github.com/qlan-ro/mainframe/pull/476) [`cc4a2ad`](https://github.com/qlan-ro/mainframe/commit/cc4a2ad3ab43f6aff608b2a5860881b584397b5d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session archive flow. Archiving a session with no git worktree no longer raises a confirm dialog — there was nothing to decide, since the dialog exists only to ask what should happen to the worktree.

  Sessions with a worktree are now asked before anything moves, not after. assistant-ui switches the active thread away the moment `archive()` is called, so prompting from inside the adapter changed the selected session while the dialog was still open, and cancelling stranded the user on an empty draft instead of returning them to the session they had just chosen to keep. The row now settles the question first and only then archives, so a cancel leaves both the session and the selection untouched.

  Project rows offer a remove button on hover, alongside the existing right-click menu item. The session row's archive action uses an archive icon instead of an X.

- [#568](https://github.com/qlan-ro/mainframe/pull/568) [`2288da2`](https://github.com/qlan-ro/mainframe/commit/2288da227cdcf7ee34830ca6d4b447809c778a5c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Adopt two treatments from assistant-ui's element registry. A long run now shows how long it has been going: the chat thread's working indicator gains a pulse dot and a live elapsed readout beside the rotating phrase. The session panel's Background Activity rows take the same pulse dot in place of their spinner, so working reads identically wherever it appears.

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Teach automations three things the editor will need: a `set_variable` step that names a value once and reuses it downstream, `once` schedules that fire at a single moment instead of on a repeating pattern, and webhook triggers that carry their registration. Variables resolve by scope, so a name set inside a repeat belongs to that repeat and does not leak to later steps. The engine, the scheduler, and the shared types all understand them; the editor UI for authoring them lands separately.

- [#557](https://github.com/qlan-ro/mainframe/pull/557) [`7f1daf4`](https://github.com/qlan-ro/mainframe/commit/7f1daf4b30e0855457ea5a1d1226e7339d9067a4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send a User-Agent on every automations connector request. GitHub rejects requests without one, so the `github.create_pr` and `github.list_prs` actions failed with 403 "Request forbidden by administrative rules" against the live API.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - ⌘T opens a blank browser tab in the workspace, ready for an address.

- [#650](https://github.com/qlan-ro/mainframe/pull/650) [`3563760`](https://github.com/qlan-ro/mainframe/commit/35637600af77f33c530621ca7335384208bf0137) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Softened the user message bubble's fill (`--bubble-tinted`) to a paler, less
  saturated tint in both themes — closer to a soft near-white blue than the
  previous saturated periwinkle. Contrast against body ink still clears WCAG
  4.5:1 by a wide margin in both themes.

- [#567](https://github.com/qlan-ro/mainframe/pull/567) [`316adb2`](https://github.com/qlan-ro/mainframe/commit/316adb2bf2d2f81dac20eed21e09139485d00d0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview-capture card in user messages: the CSS-selector breadcrumb overflowed the card and ran off the panel edge, and its tooltip could never open.

- [#591](https://github.com/qlan-ro/mainframe/pull/591) [`e2ed4bf`](https://github.com/qlan-ro/mainframe/commit/e2ed4bf33603fb378106cf9d4652551ffe6f0920) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Center the vertical hairline dividers in the composer, main toolbar and viewer toolbars. They rendered pinned to the top of their row, sitting visibly above the icons they separate.

- [#460](https://github.com/qlan-ro/mainframe/pull/460) [`bbd080f`](https://github.com/qlan-ro/mainframe/commit/bbd080fb33cff1bbe1bcba417e5b09ab85486549) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix three chat/composer bugs: a flaky EditorTab LSP test that raced neighbor suites in full-run CI, the copy-link context-menu item giving no feedback on select, and the composer pre-send display ignoring the user's configured provider default model and permission mode.

- [#440](https://github.com/qlan-ro/mainframe/pull/440) [`7164eb1`](https://github.com/qlan-ro/mainframe/commit/7164eb161e7a0d295bf61aef8f894e9b8c4bc237) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix chat-transcript links doing nothing in the Tauri shell. The `opener:allow-open-url` capability was a bare permission string, which enables the command but grants no URL scope, so tauri-plugin-opener rejected every click. Scope it to http/https/mailto/tel plus the app schemes the markdown renderer linkifies (slack, vscode, cursor, zed, figma, linear, notion, …), and add a release-safety test that fails if the scope regresses to the bare string.

- [#527](https://github.com/qlan-ro/mainframe/pull/527) [`eed8395`](https://github.com/qlan-ro/mainframe/commit/eed8395fd4333047d3fb7d1278f47bd697d4554c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A permission prompt the agent withdraws now disappears on its own instead of waiting for an answer it can no longer use, and the next queued prompt takes its place.

- [#632](https://github.com/qlan-ro/mainframe/pull/632) [`8d6573e`](https://github.com/qlan-ro/mainframe/commit/8d6573ea5c406d9f634edcf99cef8d16c86aa5cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix background-task output never loading. The daemon derived the Claude
  CLI's spool directory from a uid it never read, so it looked for task output
  in `/tmp/claude-0` — a directory that does not exist for a normal user — and
  the output request failed as an invalid path. The same wrong directory meant
  tasks were not recovered after a daemon restart, shells writing into a
  removed worktree were never signalled, and live bash tasks were falsely
  reported as stopped. The daemon now reads its real uid.

- [#468](https://github.com/qlan-ro/mainframe/pull/468) [`1191d5a`](https://github.com/qlan-ro/mainframe/commit/1191d5a38d014e25fc86bc0d5731ca62aabe3f6c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `mainframe update` self-update gaps: unrecognized CLI subcommands now print an error instead of silently falling through to booting the daemon (previously crashed with a confusing `EADDRINUSE`), add `mainframe help`/`-h`/`--help`, and `mainframe update` now refuses to install a release that isn't newer than the running version unless `--force` is passed.

- [#431](https://github.com/qlan-ro/mainframe/pull/431) [`a38f85f`](https://github.com/qlan-ro/mainframe/commit/a38f85fde5382c0e2c34543abaab08941fc470cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reap orphaned child processes on daemon startup and crash so neither a quick-tunnel child nor a launch-config dev server (and its process tree) keeps running after the daemon that spawned it dies. Tunnel and launch pids share one pidfile registry; the startup sweep only kills a live pid whose recorded command and cwd still match, and kills launch children by their process group so wrapper grandchildren (pnpm → vite → esbuild) die too. A launch child's identity is its live `ps` command line captured at spawn — the kernel rewrites argv for a `#!` script (`pnpm` shows as `node .../pnpm run dev`), so recording the bare executable would never match and leak the tree. Delivery escalates SIGTERM → grace → SIGKILL for orphans that ignore the term.

- [#471](https://github.com/qlan-ro/mainframe/pull/471) [`79280c6`](https://github.com/qlan-ro/mainframe/commit/79280c665fc7165ed545980ba279ef398b1cc319) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix new chats getting created with no model when an adapter has no saved default-model setting (e.g. automation-created Codex chats), which made Codex's app-server reject the session with `Invalid request: missing field \`model\``. Chat creation now falls back to the adapter's own catalog default model, the same fallback already used for tuning resolution.

- [#541](https://github.com/qlan-ro/mainframe/pull/541) [`82f5198`](https://github.com/qlan-ro/mainframe/commit/82f5198fed58155ab76cdb8c3bbce0e373c2851f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sessions now get an AI-generated title instead of the truncated first message. Titles are generated with `codex exec --ephemeral --ignore-user-config`, which leaves no session file, history entry, or thread row behind. Each adapter now titles with its own binary, so a machine with only Codex installed no longer shells out to `claude`; `provider.<adapterId>.titleBinary` still overrides it.

- [#502](https://github.com/qlan-ro/mainframe/pull/502) [`f202afd`](https://github.com/qlan-ro/mainframe/commit/f202afd5f72c5da542eb81cc8b40792f9d82c4eb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions whose transcript failed to load in the Rust daemon. When a session's `thread/read` history contained an item type this port didn't know — `contextCompaction` (emitted after a context compaction) or `subAgentActivity` (multi-agent) — the whole payload failed to deserialize and the transcript rendered empty. Unrecognized items are now skipped on reload, matching the Node daemon, so the rest of the history still loads.

- [#586](https://github.com/qlan-ro/mainframe/pull/586) [`6275932`](https://github.com/qlan-ro/mainframe/commit/6275932c03fdac43301363122dfbcb945951abf4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sessions now receive image attachments. The daemon writes every image attachment to the chat's files
  directory and hands Codex the resulting path; when an image can't be delivered, the turn still sends and the
  transcript says how many images were dropped and why.

- [#643](https://github.com/qlan-ro/mainframe/pull/643) [`8691fa5`](https://github.com/qlan-ro/mainframe/commit/8691fa5534814a27fefacce6921847e43ee6b37f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pull requests opened from a Codex session are now detected, live and on reload. PR detection moved off the Claude adapter onto the shared message stream every adapter emits, and the cold-load rescan now reads a Codex chat's rollout JSONL instead of `thread/read`, whose 0.147.0 response never carried command output.

- [#486](https://github.com/qlan-ro/mainframe/pull/486) [`4b6c048`](https://github.com/qlan-ro/mainframe/commit/4b6c048a9fdfac3eafee8d8beb76eb4bc59d0417) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex quota now warms up with one automatic pull at daemon boot (both Node and Rust daemons), so the ambient indicator is populated on app start instead of waiting for a manual refresh. Codex still has no polling timer — beyond boot it stays manual refresh + session pushes.

- [#507](https://github.com/qlan-ro/mainframe/pull/507) [`f83a776`](https://github.com/qlan-ro/mainframe/commit/f83a776c67e3235286e6f1caf2ad746bcd5a9b87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close four Codex routing gaps that dropped or mis-rendered content in the chat view.

  Diff-unavailable edits now fall back to a plain message instead of an empty `EditFileCard`. A `Task` item with no recorded subagent children still renders as a `TaskCard` rather than vanishing. `imageGeneration` items with an inline result now survive a chat reload instead of being dropped by history conversion. `webSearch` items are now routed to the existing `WebSearch` tool card (registered in `register-cards.ts`) in both the live stream and history reload, emitted as an already-complete tool-use/tool-result pair since Codex never sends a separate result event for it.

- [#637](https://github.com/qlan-ro/mainframe/pull/637) [`b1c083c`](https://github.com/qlan-ro/mainframe/commit/b1c083c0675166d87e0d89df94d37df6e7fdc3b6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A Codex session's sub-agents now show up in the Activity panel and the rail's running count while they work, the way Claude's sub-agents already do.

- [#580](https://github.com/qlan-ro/mainframe/pull/580) [`527f906`](https://github.com/qlan-ro/mainframe/commit/527f9068f291f64a6453f0f4b141b8994cb368d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix: a Codex chat with no model chosen could not send a message at all — the turn-start request omitted the required model field, and Codex rejected it with a raw protocol error. Codex turns now always name a model, falling back to the one the Codex app-server itself resolved and then to the configured default, and say so plainly if no model can be found.

- [#603](https://github.com/qlan-ro/mainframe/pull/603) [`5add23b`](https://github.com/qlan-ro/mainframe/commit/5add23bc5e0b341a60de4c71d102a451e79829cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop a background history re-seed blanking a transcript that is already on screen. A reconnect or reattach re-reads history and replaces the thread wholesale, and the daemon answers "empty" for a chat it has no CLI session to read from yet — so one badly-timed re-seed emptied a populated thread until the next message arrived.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The command palette moves to ⌘K, the gesture it shares with every other spotlight. ⌘O goes back to meaning "open a file".

- [#505](https://github.com/qlan-ro/mainframe/pull/505) [`750844f`](https://github.com/qlan-ro/mainframe/commit/750844f3e39905c122f05fe298ecca92dc8ebf3c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a live "Compacting…" pill in the transcript that resolves into "Context compacted", for Claude and Codex.

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the composer's provider-defaults staleness: the effort/features toolbar read a private once-fetched copy of provider settings, so a default-effort or default-model change made in Settings didn't reflect in the composer until an app reload. `useProviderDefaults` now reads the shared settings store the Settings pane writes optimistically, seeding it with one fetch when nothing has loaded it yet.

- [#553](https://github.com/qlan-ro/mainframe/pull/553) [`9e1c67b`](https://github.com/qlan-ro/mainframe/commit/9e1c67be14d2954f75d91bf69023693909af7df6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The daemon now compresses HTTP responses when the client asks for it. Requests
  advertising gzip or brotli get a compressed body and a matching
  `Content-Encoding`; requests advertising nothing get exactly the bytes they got
  before. Chat history is the biggest win — a long session's transcript is highly
  repetitive JSON, re-fetched on every WebSocket subscribe acknowledgement, and it
  crosses the cloudflared tunnel uncompressed today. Responses under 1 KB, such as
  the health check, are sent raw, and the WebSocket upgrade is deliberately left
  outside the compressor.

- [#439](https://github.com/qlan-ro/mainframe/pull/439) [`31746db`](https://github.com/qlan-ro/mainframe/commit/31746db8e4bcc7cd2a9188077e2ec8bcb0b87a78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Console launch tabs use the SquareTerminal glyph (CLI console) instead of ScrollText

- [#532](https://github.com/qlan-ro/mainframe/pull/532) [`ca7cda3`](https://github.com/qlan-ro/mainframe/commit/ca7cda36edd6a4523d959c43e3d66718dc61f6ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Right-clicking an opened image offers Copy Image, which puts the bitmap on the system clipboard.

- [#539](https://github.com/qlan-ro/mainframe/pull/539) [`3479a7f`](https://github.com/qlan-ro/mainframe/commit/3479a7f9c772f1baa1da6d9ff4ecdf889b7d68b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep the first user message visible after sending it in a new session. The draft controller that held the message was discarded when the session switched to its canonical id, and the blank replacement seeded itself from a history read the daemon had not written the message to yet.

- [#513](https://github.com/qlan-ro/mainframe/pull/513) [`4ce69b3`](https://github.com/qlan-ro/mainframe/commit/4ce69b3a35c4078605716cd2153a2da303bff9be) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Change the default dark theme's accent from periwinkle purple to macOS system blue (#0A84FF), matching the light theme. The dark selection tint, focus ring, command-directive tint, and code-editor selection highlight follow the new accent.

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- [#429](https://github.com/qlan-ro/mainframe/pull/429) [`107cff9`](https://github.com/qlan-ro/mainframe/commit/107cff978b41e8ffe0ec0eeebefd0577368e047e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the double vertical scrollbar on chat tool cards: Bash, Read, Edit, Write, Plan, Search, Skill, and Schedule cards no longer nest their own `overflow-y-auto` region inside the thread viewport, so only the thread scrolls vertically while wide code and terminal lines still scroll horizontally.

- [#435](https://github.com/qlan-ro/mainframe/pull/435) [`2b65fc4`](https://github.com/qlan-ro/mainframe/commit/2b65fc440997fb91bcc901e45734e185ac2a4151) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reflect a new session's worktree and branch choice before the first message is sent.

  A new-session draft has no daemon chat yet, so the titlebar branch chip, worktree popover, and file tree used to fall back to the project root while you composed — hiding the branch you picked. The active identity now resolves from the seeded draft config, so those surfaces show the chosen branch and worktree pre-send, and the choice carries into chat creation on first send: an existing worktree attaches with the new chat, and a new worktree is created before the CLI spawns.

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the Tauri Playwright suite against the Rust daemon and its native mock replay adapter, remove the legacy Electron test arm, and make filtered draft creation resilient to adapter-catalog loading and reused draft slots.

- [#420](https://github.com/qlan-ro/mainframe/pull/420) [`8c3c4b1`](https://github.com/qlan-ro/mainframe/commit/8c3c4b1cd1abdc012eaebfa41ad56180d3a9d56f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the editor jumping to the top when an open file is refreshed after an external change: applyValueUpdate now dispatches a minimal diff instead of replacing the whole document, so CodeMirror's scroll anchoring and selection mapping survive the reload.

- [#492](https://github.com/qlan-ro/mainframe/pull/492) [`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Capture full diagnostics when a render error is caught. The error boundary now
  logs the error stack and React component stack durably through the host (so
  packaged builds record crashes without devtools), and "Copy details" copies the
  full stack bundle instead of just the one-line message.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix archiving the active session dumping you on the empty new-session screen.

  assistant-ui's remote thread list calls `switchToNewThread()` off the archived
  thread _before_ marking it archived, so `mainThreadId` becomes a fresh
  `__LOCALID_*` draft and the existing archived-active fallback (which keyed on the
  active thread still being archived) never fired. The session router now remembers
  the last real (non-draft) thread and, when an archive bumps you onto an empty
  draft, redirects to a fallback session — the last-used one if still live, else
  the most-recently-updated non-archived session, respecting the active project
  filter. A deliberate "New" leaves the previous session regular, so it is not
  redirected.

- [#423](https://github.com/qlan-ro/mainframe/pull/423) [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the context meter over-reporting (stuck near 100%): persist the CLI-reported context totals on the chat row and prefer them over the catalog-window estimate; resolve probed model windows via each entry's own resolvedModel; stop subagent, synthetic zero-usage, and cumulative result usage from corrupting the stored context size.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix background sessions losing messages while another chat is open.

  A chat's live WS subscription is gated to the active thread, so a backgrounded
  chat receives no message events while dormant — the daemon still persists them,
  but the transcript stayed frozen at the pre-dormancy snapshot. On `subscribe:ack`
  the catch-up re-seed only fired for a socket reconnect or an unreconciled
  optimistic send, so simply switching back to a chat never healed the gap and the
  messages that arrived while it was backgrounded stayed invisible until a full
  reconnect.

  The controller now tracks when a live sub is torn down and treats the next
  attach as a post-dormancy reattach, re-seeding history from REST on the reattach
  ack (like a reconnect). Row-level unread notifications were unaffected — they run
  on a separate always-on session-list subscription — so this only restores the
  missed transcript content on switch-back.

- [#648](https://github.com/qlan-ro/mainframe/pull/648) [`e353dcf`](https://github.com/qlan-ro/mainframe/commit/e353dcf4529ef28c74a6011ede03346d92703faa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a project added from the empty first-run state never appearing until a full reload. `useProjects()` moved from a per-caller `useState` to a shared `store/projects.ts` store, so a reload issued from one mounted consumer (e.g. the "Add project" CTA) now updates every other one — the sidebar and chat surface included.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix two session/editor UX bugs:

  - Selecting a project filter with no sessions now opens a new-session draft
    instead of stranding the previously-selected session from another project.
  - The Markdown preview is now selectable, so its prose can be copied — the
    `mf-editor-selectable` opt-in class was referenced by the editor surfaces but
    never defined in the selection whitelist.

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the standalone daemon tarball (the `linux`/`darwin` release artifacts installed
  via `scripts/install.sh`) so it ships a complete `node_modules` sibling to
  `daemon.cjs`. Previously `build-standalone.sh` only copied better-sqlite3's raw
  `.node` binary, so the bundled daemon's `require('better-sqlite3')` (and the LSP
  servers + ripgrep) could not resolve and the daemon failed to start with
  `Cannot find module 'better-sqlite3'`. The standalone build now uses the same
  dependency collector as the Tauri sidecar bundler.

- [#555](https://github.com/qlan-ro/mainframe/pull/555) [`3124305`](https://github.com/qlan-ro/mainframe/commit/31243059da3449a0f4ad8e7fbfacc44f2b773bc3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Inline gate cards (plan, permission, ask-a-question) now span the same width as the composer instead of stopping ~64px short of it.

- [#611](https://github.com/qlan-ro/mainframe/pull/611) [`c37b2e0`](https://github.com/qlan-ro/mainframe/commit/c37b2e0fc4007b85dc0780bae132af7b56249515) Thanks [@doruchiulan](https://github.com/doruchiulan)! - GitHub sync: store a real personal access token instead of the Automations placeholder. The link dialog now takes a pasted PAT, the sync pill menu gains "Update GitHub token…", and an auth failure in the import dialog shows a readable message with a one-click path to fix the token. The daemon also stops offering pull requests as importable issues.

- [#558](https://github.com/qlan-ro/mainframe/pull/558) [`2be9b43`](https://github.com/qlan-ro/mainframe/commit/2be9b43f1773a330e8cd3ef8e28798299a7c95b8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the GitHub actions through the `gh` CLI instead of a hand-rolled HTTP client. `github.create_pr` and `github.list_prs` no longer ask for a token — `gh` already holds one — and `github.list_prs` now resolves `@me`, which the REST search endpoint never did. When `gh` is missing or signed out, the action catalog reports both actions unavailable and the editor mutes them with the remedy instead of offering a step that always fails.

- [#446](https://github.com/qlan-ro/mainframe/pull/446) [`aa2dce6`](https://github.com/qlan-ro/mainframe/commit/aa2dce69b38621395466777eabb5e9d0088fd17a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Style scrollbars globally instead of per-element. The warm thin scrollbar was an opt-in class covering 9 of 66 scroll containers; every other surface (markdown preview, diff viewers, workflows, tab panels, …) painted the native track — near-white under light themes and permanently visible with a mouse attached. Two @layer base rules now give every scroller the thin, hover-revealed, transparent-track treatment across all themes and schemes; [scrollbar-width:none] opt-outs still win, and the mf-thin-scrollbar class is removed.

- [#582](https://github.com/qlan-ro/mainframe/pull/582) [`faa4676`](https://github.com/qlan-ro/mainframe/commit/faa46762880b5da4f3bd77258972cc50c6553cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer loads its skills and agents independently, so a failing skills fetch no longer empties the `@` agents picker and a failing agents fetch no longer empties the `/` skills picker.

- [#587](https://github.com/qlan-ro/mainframe/pull/587) [`ed219f7`](https://github.com/qlan-ro/mainframe/commit/ed219f779e4d7cf9fced0792cbf82e117cbb8ec3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The daemon pairing code input no longer leaves setState timers running after it unmounts.

- [#512](https://github.com/qlan-ro/mainframe/pull/512) [`4a84d8c`](https://github.com/qlan-ro/mainframe/commit/4a84d8c993398258407d127b20dc2afd31db4b24) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dismiss the image lightbox by clicking the image or the dimmed area around it.

  The lightbox closed only on clicks that landed on the overlay — the empty bands above and below the image — because the image and the dimmed space beside it sit inside the dialog's content box. Clicking anywhere that is not a control now closes it; the prev/next buttons, the counter, Escape, and the close button behave as before.

- [#639](https://github.com/qlan-ro/mainframe/pull/639) [`67bbe2e`](https://github.com/qlan-ro/mainframe/commit/67bbe2e31db47c4eb81375f41c1d52c1a93afa4a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A pull request created during a live turn now appears in the open session without reopening it.

- [#594](https://github.com/qlan-ro/mainframe/pull/594) [`05fab23`](https://github.com/qlan-ro/mainframe/commit/05fab235cc642f7e1b2827cfb554ac16c53aa6fc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Band long turn durations in the message timing footer. A two-hour turn read "8158.94s"; it now reads "2h 15m", matching the running indicator's own readout. Turns under a minute keep their fractional second.

- [#581](https://github.com/qlan-ro/mainframe/pull/581) [`034ac5f`](https://github.com/qlan-ro/mainframe/commit/034ac5f147bd0327edc63db4d8d04c98244a3fd8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer's `@` and `/` suggestion list floats above the thread instead of growing the composer.

- [#550](https://github.com/qlan-ro/mainframe/pull/550) [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A project whose directory is gone is now marked unavailable in the switcher, its sessions refuse to send with the real reason instead of failing silently, and the recovery card sits above the composer in the thread's sticky footer instead of at the top of the transcript, where it stayed visible but scrolled out of reach.

- [#630](https://github.com/qlan-ro/mainframe/pull/630) [`ac1e24d`](https://github.com/qlan-ro/mainframe/commit/ac1e24da04fa7d215107c5083a1166320059e60a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replayed sessions now report their background work, including workflow runs. The
  mock adapter derives background-task start/end from the message stream — a
  `Workflow` tool use starts a workflow row and seeds its run, `Task`/`Agent` start
  subagent rows, a backgrounded `Bash` starts a shell row, and a matching
  `tool_result` ends whichever it was. Work a recording never resolves keeps
  running. A fixture can also ship a full `ClaudeWorkflowRun` snapshot via the
  `onWorkflowRun` recorded method, so the run panel's phases, agent grid, token
  counts and "up next" render under replay.

  Until now the Activity panel, the rail's pulse dot, `summarizeByKind` and the
  whole workflow-run surface were unreachable in mock mode — they always read
  "Nothing running" — which left them untestable as well as undemoable. Adds a
  `workflow` fixture: a four-phase release-readiness run, six agents, two phases
  still going.

- [#618](https://github.com/qlan-ro/mainframe/pull/618) [`7af8049`](https://github.com/qlan-ro/mainframe/commit/7af8049adc78cd16f748bc8a9e7a36e358697529) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the last native browser tooltips with the themed `Hint`

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix picking a project in the "All projects" view doing nothing. The picker read the draft thread's id before anything had created one — assistant-ui only mints that id inside `switchToNewThread`, and clears it again every time a draft is committed on first send — so the handler hit its null guard and returned silently. It now creates the draft first and seeds it afterwards.

  A new session started from the picker also honors the configured default adapter, matching the path taken when a project is already selected; it previously always started on Claude.

- [#538](https://github.com/qlan-ro/mainframe/pull/538) [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the older Claude models the CLI's own picker hides. The probed catalog is now merged with a curated list of models the API still serves — Opus 4.8/4.7/4.6/4.5/4.1 and Sonnet 4.6/4.5 — deduped against the probe by id and resolved alias. They appear under an "Older models" label in the composer's provider/model picker, and the static fallback catalog drops every retired id.

  Every model's context window, effort ladder and fast-mode flag is now taken from the CLI's own model registry instead of inferred from its family, correcting the 1M window on Opus 4.8/4.7, the xhigh effort level on Sonnet 5, and the effort ladders on Opus 4.6/4.5/4.1 and Sonnet 4.5.

- [#455](https://github.com/qlan-ro/mainframe/pull/455) [`09debb6`](https://github.com/qlan-ro/mainframe/commit/09debb6ee884b41836c8e06b40859c3a08b126c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions failing to start when a configured MCP server needs authentication.

  The codex binary writes tracing logs to stderr as normal operation, and the adapter escalated
  every stderr line to a fatal run error. An unauthenticated remote MCP server makes codex log an
  `rmcp` ERROR on every startup, so each Codex session died instantly with "Agent run failed"
  while the underlying run was healthy.

  stderr is now treated as a log stream. Real failures still surface: an unexpected non-zero exit
  reports its code along with the tail of recent stderr, so genuine startup crashes keep their
  diagnostics.

- [#457](https://github.com/qlan-ro/mainframe/pull/457) [`a679cb9`](https://github.com/qlan-ro/mainframe/commit/a679cb95b850796dec3498b5996a896ac5f73c39) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix toasts flickering when hovered.

  Sonner's default collapsed stack clamps every toast to the front toast's height and re-lays the
  stack out on hover. Our toast cards vary in height, so hovering moved a stacked toast ~314px out
  from under the pointer, which un-hovered it, which moved it back — a visible flicker loop. The
  toast stack is now always expanded, so hover changes no geometry.

- [#494](https://github.com/qlan-ro/mainframe/pull/494) [`e5480df`](https://github.com/qlan-ro/mainframe/commit/e5480dfa900b945ab32ddf4a0bc8cadf0b4b49a5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the crash on archiving a session ("Maximum update depth exceeded", React [#185](https://github.com/qlan-ro/mainframe/issues/185)).

  `useAdapters()` rebuilt its array on every render, and `useNewThreadAutoConfig` uses that array as an effect dependency — so the effect tore down and re-ran on every render. Both its body and its cleanup write to the store `ChatSurface` subscribes to, so each write re-rendered and re-armed it. Archiving the active session lands on an unresolved draft, which is the one state where that effect runs, so the loop crashed the window into the error boundary.

  `useAdapters()` is now memoized on the catalog, and `ChatSurface`'s no-active-thread fallback selects a shared idle value instead of a fresh object literal.

- [#529](https://github.com/qlan-ro/mainframe/pull/529) [`739b8d8`](https://github.com/qlan-ro/mainframe/commit/739b8d8e9baf1a808969fcb9e32c279703900c0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Claude adapter persisting session-scoped permission grants. It used to rewrite every permission update's destination to `.claude/settings.local.json` before echoing it back to the CLI, regardless of what the CLI itself declared — most damagingly for a permission-mode change, which landed as the project's new default mode. The adapter now forwards each update's declared destination as-is, with one added rule: a mode change is never forwarded to a persisting destination, so it can only ever apply to the running session.

  The same inverted rewrite is removed from the orphaned Node daemon (`packages/core`); its `setMode` guard was not ported there, since that daemon is unshipped and kept only for its `package.json` version.

  Entries this bug already wrote into `.claude/settings.local.json` — most notably a stray `defaultMode` — are not migrated or removed by this fix. If you see one you didn't set deliberately, delete it by hand.

- [#644](https://github.com/qlan-ro/mainframe/pull/644) [`d014308`](https://github.com/qlan-ro/mainframe/commit/d01430816d09011120ee446bb438ffe0a435e02d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A permission request, a question, or a plan awaiting your answer now sits above
  the composer instead of at the end of the transcript, so it stays in view while
  you scroll back through the run it is blocking. The pinned slot caps itself at
  45% of the thread pane and scrolls inside itself, so a long plan never pushes
  the composer off screen — and, symmetrically, a long queued draft in the
  composer can no longer starve the slot down to nothing. Answering the gate
  returns the space to the transcript.

- [#412](https://github.com/qlan-ro/mainframe/pull/412) [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview capture toolbar in the Tauri app. Inspect-element and region-capture never worked: the preview child webview loads a remote origin, so Tauri's ACL silently denied every callback it invoked (picker results, navigation tracking, external-link opening). Those four callbacks now live in an inlined `preview-bridge` plugin granted to `preview-*` webviews via a remote capability. Screenshot annotation showed a blank preview in packaged builds: the production CSP blocked `data:` images, hiding the freeze-frame backdrop and capture thumbnails — `img-src` now allows `data:`. The annotation dialog also rendered _behind_ the live preview: a recreated webview is shown by default, but the visibility hook's dedup cache still held the old webview's state and suppressed the `setVisible(false)` that hides it — so the native webview composited over the annotation UI until a reload. The cache now resets whenever the webview is recreated.

  The capture toolbar's inspect/region/screenshot state is also cleaned up: inspect and region are now mutually exclusive toggles (selecting one cancels the other, clicking the active one turns it off, and a completed pick clears it), and the Restart glyph no longer duplicates the URL-bar reload icon. "Open in browser" now opens the current preview URL in the OS browser instead of silently re-navigating the embedded webview, and "Clear cache" clears the webview's Cache-API/storage entries and reloads instead of doing a plain navigate. The toggle-off teardown and "Clear cache" are implemented on both hosts (Tauri and Electron); on Electron, Clear cache also reloads bypassing the HTTP cache. Separately, an empty Run surface now keeps its split/close controls instead of hiding them behind the picker.

- [#436](https://github.com/qlan-ro/mainframe/pull/436) [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.

- [#421](https://github.com/qlan-ro/mainframe/pull/421) [`b1e1798`](https://github.com/qlan-ro/mainframe/commit/b1e179861f28e988a5a666252534c5110de88392) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the empty preview surface after starting a New Session: the first send now selects the newly created session automatically, so a running preview on the same project/branch re-attaches without a manual sidebar click.

- [#645](https://github.com/qlan-ro/mainframe/pull/645) [`5015858`](https://github.com/qlan-ro/mainframe/commit/5015858fbdcbc031a5e278d4d5bb365c73964d84) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Previewing a Mainframe dev server no longer hangs on "Connecting to the daemon". The nested app was mistaking the preview webview for the host app.

- [#660](https://github.com/qlan-ro/mainframe/pull/660) [`4ae8393`](https://github.com/qlan-ro/mainframe/commit/4ae8393e69c93c2f2eabbaf75f7d19531089e0af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the zero-projects first-run screen never appearing: `reloadProjects` now shares one in-flight request across concurrently-mounted `useProjects()` consumers instead of firing a redundant fetch per mount, and `loading` now reflects only the initial load rather than flipping true on every reload — the latter previously caused an infinite mount/unmount loop between the first-run hero and the welcome screen on a fresh, project-less workspace.

- [#485](https://github.com/qlan-ro/mainframe/pull/485) [`32ad349`](https://github.com/qlan-ro/mainframe/commit/32ad349cb61088b807f3da5ad46d4b603832c009) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Ambient quota row now headlines the trusted session window instead of whichever window has the highest used percent, so a fresh session no longer gets buried behind a tighter weekly window.

- [#546](https://github.com/qlan-ro/mainframe/pull/546) [`82c23ba`](https://github.com/qlan-ro/mainframe/commit/82c23ba06b9502b22935252114e2eaf1aec5749d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Project in the sessions sidebar now opens the app's own confirmation dialog instead of a browser dialog the desktop webview never renders, so the action works at all. A removal the daemon rejects raises an error toast carrying its message and leaves the project in the list, instead of reporting a false success.

- [#445](https://github.com/qlan-ro/mainframe/pull/445) [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pre-port hardening for the daemon Rust migration: GitService now runs raw `git` subprocesses with in-repo porcelain parsers (simple-git removed), SQLite schema evolution moved to numbered `PRAGMA user_version` migrations, black-box HTTP oracle tests added for settings/launch/attachments/tags/todos, and the wire contract frozen as generated snapshots under `docs/rust-port/`.

- [#642](https://github.com/qlan-ro/mainframe/pull/642) [`7c4da91`](https://github.com/qlan-ro/mainframe/commit/7c4da91cd38efed5ae4f0299a1dc7ad52353f185) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the sidebar's hand-rolled scroll-edge fade with the shadcn `scroll-fade` utility, keeping only the sticky-header inset measurement and feeding it through the utility's mask override. The session panel's card bodies, the session tab strip, and the attachment rail now fade with content past their edges instead of clipping. The workspace tab strip also picked up the fade — it wasn't named in the brief, but leaving it clipped beside a fading session tab strip would keep the exact inconsistency this change removes.

  Engines older than the `animation-timeline: scroll()` floor (confirmed live on macOS 26.4.1; the exact lower bound is unconfirmed) now get the pre-adoption clip instead of shadcn's fallback, which pins a permanent both-edges dim.

- [#438](https://github.com/qlan-ro/mainframe/pull/438) [`761367d`](https://github.com/qlan-ro/mainframe/commit/761367db526cc999dd8488ad24148ebe7a073bff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix dark-theme scrollbars: declare color-scheme and repair the mf-thin-scrollbar styling so surfaces no longer paint a white native track.

- [#432](https://github.com/qlan-ro/mainframe/pull/432) [`48de6cd`](https://github.com/qlan-ro/mainframe/commit/48de6cdc1217e2641d38ba85e612d73c8430382a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session Context panel: report global CLAUDE.md/AGENTS.md with their real openable ~/.claude path, and stop listing duplicate skills and CLAUDE.md entries.

- [#638](https://github.com/qlan-ro/mainframe/pull/638) [`17f377d`](https://github.com/qlan-ro/mainframe/commit/17f377d9d1e4927ee2159d25386e1bffc92efdb1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sort the sidebar's session list by recent activity in every grouping. Grouping by project used to list each project's sessions in the order the app happened to receive them — an order that changed between restarts — and the name and status modes left their ties there too. Each section now leads with the most recently active session, and every mode resolves ties the same way.

- [#572](https://github.com/qlan-ro/mainframe/pull/572) [`373f085`](https://github.com/qlan-ro/mainframe/commit/373f085472643632c3ed01e9f0ffcef4de32fb61) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session panel never appearing in packaged builds: the panel's width measurement ran once before the chat surface's initializing branch gave way to the real layout row, so the observer never attached and the panel stayed permanently hidden. The host is now a state-backed callback ref that re-measures whenever the row mounts. Dev servers booted fast enough to always win that race, which is why it only ever reproduced in release builds.

- [#416](https://github.com/qlan-ro/mainframe/pull/416) [`48218b7`](https://github.com/qlan-ro/mainframe/commit/48218b7e4654ad592ad361b0c5c67fe27e57cf7f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace session status dots with provider logos and keep unread attention state independent of notification preferences.

  Session rows now show provider-specific logos, use full-color/animated states for working and waiting sessions, and keep unread styling keyed to both stable thread ids and daemon chat ids. Pending permissions, waiting sessions, and completed/error lifecycle updates now mark background sessions unread even when OS notifications are disabled. Read session titles use normal foreground styling, while unread titles use a heavier weight.

- [#547](https://github.com/qlan-ro/mainframe/pull/547) [`b93d09e`](https://github.com/qlan-ro/mainframe/commit/b93d09ed257efc28f5d71bdfc7372ea8f9a669fc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a session row's PR chip vanishing under width pressure: at most one PR ever renders inline (the most recent, created preferred over merely-mentioned), a count indicator always stands in above one PR, and hover no longer reflows the row — only the purely decorative worktree glyph and tag dots yield width, one at a time, and only ever at their own natural size.

- [#625](https://github.com/qlan-ro/mainframe/pull/625) [`f799bc5`](https://github.com/qlan-ro/mainframe/commit/f799bc50aa7896001aebef589382922717469b1a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep a new session's tab open while it is a draft, and make it temporary once it is sent.

  Creating a session used to pin its tab immediately, so every new session accumulated a permanent tab wherever the pinned set happened to end. The strip now has a third slot: an unsent draft opens into it, where opening another session cannot displace it, and the first send demotes it into the ordinary preview slot — it turns italic, grows the "Keep open" pin, and the next session you open replaces it. The draft always renders last, so a new session is the end tab. The runtime's transient boot draft is told apart from a deliberate one by whether the session list had loaded when it was activated, so booting still leaves no stray "New Session" tab.

- [#443](https://github.com/qlan-ro/mainframe/pull/443) [`8189745`](https://github.com/qlan-ro/mainframe/commit/8189745d8deb596a8f9fc5480c88bb378f73ce51) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the sessions-list scrollbar and pinned group headers. The mf-thin-scrollbar class mixed the standards scrollbar properties with ::-webkit-scrollbar rules; engines that honor the standard properties ignore the webkit rules, letting the native white classic scrollbar paint on warm panels — the class now uses the standards path only (thin, transparent, thumb on hover). Pinned group headers no longer show row content through them: the scroller's top padding opened a see-through band above the sticky header, and WKWebView's backdrop-filter does not reliably blur sibling rows scrolled beneath it — the pinned host now composites the glass tint over an opaque base. Also restores the sessions-list-scroll test hook that Virtuoso's own data-testid was overriding.

- [#619](https://github.com/qlan-ro/mainframe/pull/619) [`ae0d26d`](https://github.com/qlan-ro/mainframe/commit/ae0d26d035b2cb4b2bad3cf6bc40a621d4985977) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Mute the sidebar action labels so New Thread, Kanban and Automations sit at the same ink as the rows below them.

  Their icons were already muted, but the labels rendered at full sidebar foreground, making the three rows read as the loudest thing in the sidebar. They now use `text-muted-foreground`, the resting ink the project rows already use.

- [#504](https://github.com/qlan-ro/mainframe/pull/504) [`8425ab4`](https://github.com/qlan-ro/mainframe/commit/8425ab4c8c52d4d7abdfc8a3d826c3fa0f8ecc6a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sidebar now shows a session as Working while only background subagents are active.

  The sidebar's WS event router dropped `background_task.started|updated|ended` in its default case, so a session whose only live activity was a background subagent never triggered a reload — the badge stayed on Idle even though the daemon's `displayStatus` was already Working. The router now reloads the session list on all three background-task lifecycle events.

- [#470](https://github.com/qlan-ro/mainframe/pull/470) [`7db6b53`](https://github.com/qlan-ro/mainframe/commit/7db6b535c6ac400833446816112388917964cd71) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Overhaul the left sidebar's visual density and information architecture: unified per-level indentation across Projects/Sessions/Tasks/Tags (matching macOS outline conventions, full-width selection highlights on indented rows), all four root sections now independently collapsible and persisted, Context/Skills/Agents moved into the right inspector while Tasks moved into the left sidebar as its own section (per HIG, contextual detail vs. navigable collections), colored tag pills replacing neutral chips with color dots, a redesigned daemon selector card matching the mobile app's pattern, and numerous row-height/padding/font/scroll-behavior fixes throughout.

- [#475](https://github.com/qlan-ro/mainframe/pull/475) [`219ace1`](https://github.com/qlan-ro/mainframe/commit/219ace16e7be524b8282307dcd13e5b8f185e402) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The sessions list no longer reserves layout width for a scrollbar that is invisible at rest. A global `scrollbar-width: thin` made WebKit render a classic, space-reserving bar, shrinking every row by 13px to line a gutter whose thumb is transparent until hover; the list now uses a Radix ScrollArea, whose absolutely-positioned thumb overlays the rows at no layout cost.

  Fixes a latent bug in the shared `ScrollArea`: its `[&>div]:!block` rule used Tailwind v3's important-prefix syntax, which compiles to nothing under Tailwind v4, so the rule had never taken effect. Radix's `display: table` viewport wrapper now gets a viewport-bounded width as intended, restoring `truncate` on flex rows in every ScrollArea.

  The Tasks section now shows at most five tasks with a "View all N tasks" row, and sits in the bottom cluster below the flexible spacer. Project rows reserve full-strength foreground for the unread signal instead of using it at rest, matching the session-row convention.

- [#479](https://github.com/qlan-ro/mainframe/pull/479) [`d428031`](https://github.com/qlan-ro/mainframe/commit/d428031ac7cc14c5cd0295632db3b4990c3a0691) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show context usage percentages for Codex sessions.

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Initialize new session composers with the same snapshotted defaults used on first send.

- [#622](https://github.com/qlan-ro/mainframe/pull/622) [`5d6a0a3`](https://github.com/qlan-ro/mainframe/commit/5d6a0a31070c0783ce2cc70536ce5768682e7e10) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Light the split pair's shared tab underline only while the split is on screen.

  A split groups two session tabs under one container in the title-bar strip, and that container drew its 2px underline unconditionally. Because a pair stays open while parked behind a third session, the strip could show three tabs wearing the selected underline at once — the pair's plus the focused tab's — leaving no way to tell which session you were actually looking at. The underline now lights on exactly the terms a lone tab's does: a member of the pair is the focused session. The container's faint tint is dropped with it, so grouping reads from the two tabs sitting adjacent rather than from a mark that outlives the split it describes.

- [#442](https://github.com/qlan-ro/mainframe/pull/442) [`4eab7ed`](https://github.com/qlan-ro/mainframe/commit/4eab7ed094a70d8c39087fb0590ca65067783ae1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop leaking the daemon on quit and fail loudly on port collisions. macOS quit paths (Cmd+Q, updater relaunch) end the run loop without destroying windows, so the window-Destroyed handler never killed the daemon — the orphan kept the port and the next launch's daemon died on EADDRINUSE with no log line, leaving the UI silently talking to an old, contract-skewed daemon. The Tauri shell now also kills the daemon on RunEvent::Exit, reaps the child (no zombie), and watches for unexpected daemon exits, surfacing them through daemon:status. The daemon surfaces bind failures as logged fatal errors and reports its pid via /health so a stale port owner can be identified with one curl.

- [#552](https://github.com/qlan-ro/mainframe/pull/552) [`0548660`](https://github.com/qlan-ro/mainframe/commit/054866036d2673751b3312aa3d87bb1a71047391) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A saved provider default model that the adapter no longer offers is dropped when a new chat is created, instead of being handed to the CLI as an unknown model id.

- [#434](https://github.com/qlan-ro/mainframe/pull/434) [`f6b4b36`](https://github.com/qlan-ro/mainframe/commit/f6b4b36d2a330b8da39dd27acc1f5894b1005613) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface a Stop in the toolbar for any running launch config, even one started outside the toolbar.

- [#419](https://github.com/qlan-ro/mainframe/pull/419) [`84a3788`](https://github.com/qlan-ro/mainframe/commit/84a37888837a52096d8e6efb581ed1683332a3e4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix subagent messages leaking into the main chat: partition task children by parentToolUseId (parallel and non-contiguous Tasks group correctly), end explore/progress grouping at subagent boundaries, surface in-content child tool_results, and suppress empty signature-only thinking blocks.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Switch sessions with ⌘1…⌘9, and hold ⌘ to see which number opens which tab. The strip and the sidebar both show the key, so ⌘4 stops being a guess. The Chat and Workspace surfaces move to ⌘⇧C and ⌘⇧W to free the digits.

- [#641](https://github.com/qlan-ro/mainframe/pull/641) [`97d17f7`](https://github.com/qlan-ro/mainframe/commit/97d17f792d9769a69829d669daa67ac24c6c50d0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Order the session rail's Tasks panel by last touched, in-progress tasks above open ones, so a task you just added or edited sits at the top instead of the bottom.

- [#612](https://github.com/qlan-ro/mainframe/pull/612) [`77eb70a`](https://github.com/qlan-ro/mainframe/commit/77eb70a6bc5024422fbfe6294f206c832e5b63d7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep pinned chat transcripts at the bottom across WKWebView content reflows.

- [#462](https://github.com/qlan-ro/mainframe/pull/462) [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix drag-and-drop not working on the Tasks kanban board, and add drag visual feedback.

  Tauri's native window-level drag/drop interceptor is enabled by default (`dragDropEnabled`), which swallows a drag session before the page's HTML5 `dragstart`/`dragover`/`drop` listeners ever fire. The kanban board (`TaskCard`/`TaskColumn`) and the composer's file-attachment dropzone both use plain HTML5 DnD (no native Tauri file-drop API is used anywhere), so setting `"dragDropEnabled": false` on the main window unblocks both without touching any OS-level file-drop feature.

  While fixing this, `TaskCard` now dims to 50% opacity while being dragged, and `TaskColumn` highlights with a tinted background and ring while a drag hovers over it — feedback that was previously invisible because the drag never reached the page at all.

- [#411](https://github.com/qlan-ro/mainframe/pull/411) [`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the packaged Tauri app hanging on "waiting for daemon". The daemon's CORS
  allowlist only accepted `http(s)://localhost|127.0.0.1` origins, so it never
  returned `Access-Control-Allow-Origin` for the packaged Tauri webview, whose
  page is served from the `tauri://localhost` custom scheme (`http://tauri.localhost`
  on Windows). WKWebView then blocked every daemon response as a CORS error and the
  renderer's `/health` poll could never succeed — even though the daemon was healthy.
  The allowlist now includes the Tauri webview origins.

- [#635](https://github.com/qlan-ro/mainframe/pull/635) [`012e0b0`](https://github.com/qlan-ro/mainframe/commit/012e0b0d05cb7350935a0693c27a47a54b549794) Thanks [@doruchiulan](https://github.com/doruchiulan)! - ⌘J opens a terminal in the workspace, revealing the surface if it was hidden.

- [#626](https://github.com/qlan-ro/mainframe/pull/626) [`6722a60`](https://github.com/qlan-ro/mainframe/commit/6722a60c1e1999c5e53c10919e9b7b7f42584f7f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep scrollbar thumbs visible in Tauri webviews.

- [#593](https://github.com/qlan-ro/mainframe/pull/593) [`4ac8666`](https://github.com/qlan-ro/mainframe/commit/4ac86664cb9b5d61fc3270ddd1fdd795507fa19c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop showing two working indicators at once. While a tool call was the last part of a running turn, the message rendered a bare pulse dot on top of the thread's "Working… 12s" row, with the message timestamp between them. The per-message dot is now suppressed in the main thread and kept only in nested subagent transcripts, which have no thread-level indicator.

- [#569](https://github.com/qlan-ro/mainframe/pull/569) [`074f06c`](https://github.com/qlan-ro/mainframe/commit/074f06c33c941c7d8dcfa2ba71e939a6c466dc61) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Retire the v1 layer from packages/ui. The duplicated tooltip, hint, popover, dropdown-menu and scroll-area primitives now render through their v2 counterparts; every generic `mf-*` colour and the whole v1 type scale are swept onto v2 semantics and deleted from the bridge sheet, which now holds only domain palettes and app chrome with no v2 equivalent.

- [#668](https://github.com/qlan-ro/mainframe/pull/668) [`fbf7f08`](https://github.com/qlan-ro/mainframe/commit/fbf7f0866550d0b62edf2b17a8478667d1b66ed9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Focus the terminal when you open one, so ⌘J (or a click on a terminal tab) leaves you ready to type.

- [#549](https://github.com/qlan-ro/mainframe/pull/549) [`2b648e8`](https://github.com/qlan-ro/mainframe/commit/2b648e8b26e33465f0fc5f60c0253a648d3aa600) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix attachments against a remote daemon: a stale device token used to fail the upload silently, drop the user's files from the composer, and show a bare "Failed to send" with no way back. A remote 401/403 now marks that daemon `needs-repair` in the footer (the stored token is untouched), the failed message names the cause (authorization, size, or unreachable) instead of a raw HTTP status, and the attachments the send consumed are put back into the composer instead of vanishing. Completing a re-pair swaps the live token in place, so the next send works without restarting the app.

  The Rust daemon (`packages/core-rs`, not a changeset package) now logs one structured record per attachment-upload outcome and per rejected-auth request — accepted/rejected, count, byte total, reason — with no file names, bytes, or tokens. It also stops axum's default 2 MB body limit from shadowing the daemon's explicit 30 MB layer, which was silently rejecting any attachment over ~1.5 MB with an empty-bodied 413 on every daemon, local or remote.

- [#561](https://github.com/qlan-ro/mainframe/pull/561) [`c06fc02`](https://github.com/qlan-ro/mainframe/commit/c06fc02a5da65c7e735ec92e385b5c808c1f53df) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sub-agent delegations (`CollabAgent`) now render as a titled sub-agent card showing the delegated task, the sub-agent's nested transcript, and its own final message. A sub-agent's turn no longer ends the parent session's turn or moves its context gauge.

- [#560](https://github.com/qlan-ro/mainframe/pull/560) [`b614ae9`](https://github.com/qlan-ro/mainframe/commit/b614ae9bc59653f40b5415fee952f075b2eba9d6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix plan-mode approval on the Rust daemon: approving a plan now applies the execution mode you chose, and "clear context and implement" restarts the session with the plan instead of leaving it stuck in plan mode.

- [#583](https://github.com/qlan-ro/mainframe/pull/583) [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix remote daemons paired over plain http: the paired scheme is now persisted and honored everywhere the endpoint is rebuilt, so an http remote connects instead of silently becoming unreachable. Plain http is refused at pairing time for any host other than loopback, with a clear explanation before a pairing code is spent.

- [#602](https://github.com/qlan-ro/mainframe/pull/602) [`aeee900`](https://github.com/qlan-ro/mainframe/commit/aeee9008a8c1a7a7a8a973906e537f9ee07779c9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Move the assistant-ui set to the 0.15 line, replacing the legacy context hooks it removes with `useAui`/`useAuiState` selectors. No user-facing change.

- [#601](https://github.com/qlan-ro/mainframe/pull/601) [`5378940`](https://github.com/qlan-ro/mainframe/commit/5378940150537f7ee721374aec81c913d1ae26c9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Internal cleanup: the shared surface-host geometry constant is retired into the surface host component itself, and the dead command-palette inspector icon entry and the unused right-rail sidebar glyph are removed. No user-visible change.

- [#604](https://github.com/qlan-ro/mainframe/pull/604) [`010a14c`](https://github.com/qlan-ro/mainframe/commit/010a14c4485d1315f733c2210b429663011e6ccc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session tabs now restore against the settled thread list, so a reload no longer drops every tab but the active one, and a failed or empty list no longer overwrites the persisted set.

- [#584](https://github.com/qlan-ro/mainframe/pull/584) [`3f63f15`](https://github.com/qlan-ro/mainframe/commit/3f63f157ffc966af0e3c0e805252beb5c5e24e1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer's @ button opens the mention picker instead of sending the message.

- [#606](https://github.com/qlan-ro/mainframe/pull/606) [`34a8780`](https://github.com/qlan-ro/mainframe/commit/34a8780d06070c05a56406c04c444863a0f25232) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Starting a session no longer leaves a second, unselectable tab behind — the draft tab becomes the session's tab in place.

- [#636](https://github.com/qlan-ro/mainframe/pull/636) [`4576784`](https://github.com/qlan-ro/mainframe/commit/4576784d88678e285be80dd5ffd78bf7282db8b0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Kanban board and the Automations library each get their own in-modal project picker, seeded from the sidebar's project filter on every open. Both surfaces now always open — with no session active or a projectless draft, they offer a project picker instead of a dead click — and an in-modal change is local to that open: it never writes back to the sidebar filter and is forgotten on close.

- [#481](https://github.com/qlan-ro/mainframe/pull/481) [`12a4d83`](https://github.com/qlan-ro/mainframe/commit/12a4d83a2fdb9ca688c37fc07c264bb5e1335a9c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add GitHub sync fields to the todos plugin schema so issue creation/sync has somewhere to write closed_at, state_reason, author, and remote linkage.

- [#437](https://github.com/qlan-ro/mainframe/pull/437) [`ec7cca7`](https://github.com/qlan-ro/mainframe/commit/ec7cca73c60c238cec57f5e1606377a21751314b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Refetch todos when the Tasks modal or quick-add opens so it shows current data instead of boot-time statuses.

- [#663](https://github.com/qlan-ro/mainframe/pull/663) [`6429c50`](https://github.com/qlan-ro/mainframe/commit/6429c50fe1a04eeaec25386afed93083a6518219) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Centre the macOS traffic lights on the sidebar header row, and move the Update pill to sit beside them. The lights sat 5px below the row's 24px midline in packaged builds: macOS 26 renders the classic button metrics for binaries linked against SDK ≤ 15 (every release build — the CI runner is macos-14), where the cluster centre lands at y + 2, while a locally built dev app links SDK 26 and centres at y − 2. Tuning by eye against a dev window therefore misaligned every release. tauri.conf.json now carries the packaged-correct y (22) and tauri:dev patches it to 26, so both builds centre on the same midline.

- [#661](https://github.com/qlan-ro/mainframe/pull/661) [`d34ba53`](https://github.com/qlan-ro/mainframe/commit/d34ba5327db55bed792a9feb2d117ee8dc98ab53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The macOS traffic lights no longer vanish when the window loses focus in a
  theme that differs from the system appearance. macOS draws the inactive
  buttons for the window's appearance, and with the overlay title bar their
  backdrop is the app content — dark-appearance inactive buttons are white,
  invisible on the light theme. The native window theme now tracks the app
  theme (`setWindowTheme` on the host bridge; System follows the OS).

- [#627](https://github.com/qlan-ro/mainframe/pull/627) [`2077f7c`](https://github.com/qlan-ro/mainframe/commit/2077f7c2340fd01fdd2abe775d8a345c4afc4f9e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Return the transcript to its newest message when you switch sessions. Every session shares one scrolling viewport, so reading back in one session left every session opened after it parked at that same offset, mid-history.

- [#649](https://github.com/qlan-ro/mainframe/pull/649) [`ffa0020`](https://github.com/qlan-ro/mainframe/commit/ffa00201b9be4d794f17571f3ddce5fefb57dce3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed the first-run tutorial popover clipping off the right edge of the
  viewport on step 4 ("Open the workspace"), whose anchor sits near the right
  edge of the toolbar. The label card's horizontal position is now clamped
  against both viewport edges, not just the left.

- [#628](https://github.com/qlan-ro/mainframe/pull/628) [`d1023b0`](https://github.com/qlan-ro/mainframe/commit/d1023b04856eb740f7395dbf377c7edbeceaabb6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent release Tauri webviews from rubber-banding the app shell when scrolling past a transcript boundary.

- [#612](https://github.com/qlan-ro/mainframe/pull/612) [`77eb70a`](https://github.com/qlan-ro/mainframe/commit/77eb70a6bc5024422fbfe6294f206c832e5b63d7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session-panel rework and chrome cleanups: the rail is always visible and vertically centred (it used to vanish below 876px and cover the find band); Background Activity, Launch, and Tasks are now independent stacked glass panels toggled from the rail (Tasks moved out of the left sidebar); branch management left the titlebar and lives on the welcome screen and the session panel's branch row; automations can be deleted from the library, are scoped to the selected project (plus unscoped ones), and each row is annotated with its project.

- [#428](https://github.com/qlan-ro/mainframe/pull/428) [`7127094`](https://github.com/qlan-ro/mainframe/commit/7127094834d0d13a3920ccaf8fa9cac4de0018ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Batch of chat and editor fixes: make console log output selectable, keep the thinking indicator inline after the last message, allow expanding in-progress bash tool cards, prefill the composer when running a todo in a session, and add an agent-annotation comment gutter to the diff viewer.

- [#565](https://github.com/qlan-ro/mainframe/pull/565) [`980a5fc`](https://github.com/qlan-ro/mainframe/commit/980a5fc17be65018b70c213866c9464c28568cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebase the v2 UI clone on the stock shadcn Luma preset. The custom token layer — named type rungs, compressed spacing, `mf-*` colours, three colour schemes, three window styles — is gone; v2 now renders on the preset's sheet with the macOS system blue as `--primary`.

- [#565](https://github.com/qlan-ro/mainframe/pull/565) [`980a5fc`](https://github.com/qlan-ro/mainframe/commit/980a5fc17be65018b70c213866c9464c28568cc9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Switch the v2 UI clone from the `radix-luma` style to `radix-vega`. Luma's pill geometry was too round for this app; vega squares the controls, tightens the sidebar rows and returns inputs to outlined fields. The token sheet is unchanged — the two styles ship identical stylesheets.

- [#585](https://github.com/qlan-ro/mainframe/pull/585) [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the `ultra` reasoning-effort level so the composer can offer and persist it.

- [#621](https://github.com/qlan-ro/mainframe/pull/621) [`a49f893`](https://github.com/qlan-ro/mainframe/commit/a49f893e60d934b621488f6f9b9aa58fdeaa9df2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Shrink the update pill so it fits the title-bar row it lives in.

  "Install update — v2.0.0-rc.25 is available" measured 249px in a slot that is under 100px wide at the default sidebar width, and it rendered in bold primary — the loudest thing in otherwise muted chrome. The pill now reads Update / 47% / Restart, carries the version and the next step in its hint, and is built on the `Badge` primitive it used to hand-roll, so it inherits the focus ring and the 12px icon.

- [#556](https://github.com/qlan-ro/mainframe/pull/556) [`5767796`](https://github.com/qlan-ro/mainframe/commit/5767796745e98c42a97f264fa67a9ab87aad2095) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep long unbreakable text inside the user bubble.

  A message containing a token longer than the bubble — a URL, an absolute path, a long inline-code span — used to paint past the card's border and over the transcript, because neither the user card, the queued card, nor the approved-plan card opted into word breaking. All three now break a word that cannot fit, and only such a word: ordinary messages wrap exactly where they did before. The plan card no longer sets `overflow-hidden`, which was silently clipping the same content instead of showing it.

- [#615](https://github.com/qlan-ro/mainframe/pull/615) [`4218e89`](https://github.com/qlan-ro/mainframe/commit/4218e8941da57b79301f0e5ba87c7cb86ce08073) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep scrollbar tracks transparent in macOS WKWebView.

- [#422](https://github.com/qlan-ro/mainframe/pull/422) [`db6a25d`](https://github.com/qlan-ro/mainframe/commit/db6a25d4f1725447842b5ad35df152d6854caeda) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the worktree chip icons staying stale after joining or creating a worktree: the composer config mirror now adopts chat updates that change only worktreePath/branchName, and the shell identity (titlebar branch chip, chat header, branch popover) re-derives custom from the remoteId-keyed thread entry so sessions created in the current app run update too.

- [#520](https://github.com/qlan-ro/mainframe/pull/520) [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix "Could not switch worktree — No such file or directory (os error 2)" when accepting a worktree-switch offer. Claude's own worktree tool relocates the session transcript as soon as the agent enters the worktree, so by the time the daemon rebinds the chat there is nothing left to move. That absence is now expected rather than fatal. When the move does fail for a real reason, the chat restarts on its current binding instead of being left stopped and unbound, and the toast explains what happened instead of quoting the raw OS error. Moving session files also no longer overwrites a transcript that is already at the destination, so a leftover file in the old directory cannot replace the live one. After a successful move the chat's stored transcript path now follows the transcript into the worktree instead of pointing at the directory it just left.

  Worktree offers no longer go missing after a worktree is deleted and recreated at the same path. A chat now remembers each worktree it has already seen by identity rather than by path alone, and refreshes that record on every scan instead of freezing it when the chat starts. A worktree rebuilt in place is a different worktree, so it is offered again — even when the remove and the add run as a single command and the path never appears to have gone away.

  Switching worktrees mid-session no longer leaves the thread stuck on "Composing…" with a Stop button. The switch restarts the CLI, and the restart alone was being read as a turn in flight; since no turn was running, nothing ever arrived to clear it.

  Switching is now blocked while the agent is answering, rather than cutting the answer off. The offer stays on screen and says it becomes available once the response finishes.

  The composer's worktree control is blocked on the same terms. Isolating a session, moving it to another worktree, or dropping its worktree each restart the CLI, so all three now wait for the response to finish. The popover still opens and still lists the branches and worktrees on offer — they are only disabled, under a note saying when they come back — and the daemon refuses the request even if it arrives another way.

- [#433](https://github.com/qlan-ro/mainframe/pull/433) [`f2fa02c`](https://github.com/qlan-ro/mainframe/commit/f2fa02c9312719951eef2f2a7384deb1476f98ef) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep live file-watching reliable and stop a spurious boot-time CSP error. The editor now re-subscribes its file watches on every WebSocket reconnect and the daemon re-arms watchers after inode-replacing (atomic) saves, so external edits keep reaching the open editor and the disk-conflict banner now also shows for markdown files. The client no longer opens a doomed `ws://127.0.0.1:0` connection before the daemon target is seeded.

- Updated dependencies [[`ce1d38d`](https://github.com/qlan-ro/mainframe/commit/ce1d38dc1408d8d70a88eed870ed24db171e71d4), [`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52), [`feebc74`](https://github.com/qlan-ro/mainframe/commit/feebc74c25681719d71d9eb7ecf99768735d92c8), [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911), [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385), [`a8ec7b1`](https://github.com/qlan-ro/mainframe/commit/a8ec7b1878df3f9562591ab070a90bff98e8a8d2), [`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c), [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa), [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f), [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b), [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e), [`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037), [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e), [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e), [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f), [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af), [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d), [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb), [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab), [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52), [`d34ba53`](https://github.com/qlan-ro/mainframe/commit/d34ba5327db55bed792a9feb2d117ee8dc98ab53), [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d), [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866), [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc)]:
  - @qlan-ro/mainframe-types@2.0.0
