# @qlan-ro/mainframe-ui

## 2.0.0-rc.17

### Minor Changes

- [#542](https://github.com/qlan-ro/mainframe/pull/542) [`39daa55`](https://github.com/qlan-ro/mainframe/commit/39daa550646397b31943ab6f747ea8f1fa42948d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Run surface can open any http/https URL in a tab, tunnelling loopback URLs on a remote daemon.

- [#534](https://github.com/qlan-ro/mainframe/pull/534) [`58b017f`](https://github.com/qlan-ro/mainframe/commit/58b017f57d7edc57ba277201c114201288d78975) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Warn before a model, effort, or tuning-feature change is applied to a session that already has history. The confirm names what is changing in its title, then explains that changing the model or reasoning effort invalidates the cached context, so the next message re-sends the conversation as new input and contributes to your usage or cost. It quotes the approximate size when the CLI has reported it. Nothing reaches the daemon until you confirm; cancelling leaves the control where it was. A chat with no messages, and a re-pick of the value already in effect, behave exactly as before, and a "Don't warn again" checkbox turns the confirm off for all three controls for good.

  The model picker is now inert while the assistant is working, matching the effort and features controls, so no control can reach a running CLI mid-answer.

### Patch Changes

- [#543](https://github.com/qlan-ro/mainframe/pull/543) [`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the models a locally running CLIProxyAPI serves as selectable Claude-adapter models. When the proxy answers on `127.0.0.1:8317`, its catalog is merged into the Claude adapter's under `cliproxy/`-namespaced ids and appears in the composer's model picker under a "CLIProxyAPI" section, below the native Claude models. Entries read like the native ones — "OpenAI - GPT 5.6 Sol", not `gpt-5.6-sol`, with a caption naming the cut of the model and the account that answers for it — and the section is ordered by provider, then capability, instead of however the proxy happened to list them. Picking one spawns the same `claude` CLI against the proxy — `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` point the child at the endpoint, `ANTHROPIC_DEFAULT_HAIKU_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` give it a background model the proxy actually serves, and any inherited `ANTHROPIC_API_KEY` is removed so the session can't fall back to the real account.

  The proxy's API key is read from its own config file at spawn time and never stored in Mainframe's database or the OS keyring; set `MAINFRAME_CLIPROXY_CONFIG` if the config lives outside the standard Homebrew paths. Rate-limit events from a proxy session no longer update the Anthropic quota indicator, which measures a subscription the session isn't billing. Switching a chat between a proxy model and a native one respawns the CLI instead of hot-swapping the model, since the endpoint changes with it.

  Nothing changes when no proxy is running: the group is absent from the picker, and the Providers settings pane reports it as not detected. Title generation and account quota deliberately stay on the real Anthropic account.

- [#532](https://github.com/qlan-ro/mainframe/pull/532) [`ca7cda3`](https://github.com/qlan-ro/mainframe/commit/ca7cda36edd6a4523d959c43e3d66718dc61f6ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Right-clicking an opened image offers Copy Image, which puts the bitmap on the system clipboard.

- [#539](https://github.com/qlan-ro/mainframe/pull/539) [`3479a7f`](https://github.com/qlan-ro/mainframe/commit/3479a7f9c772f1baa1da6d9ff4ecdf889b7d68b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep the first user message visible after sending it in a new session. The draft controller that held the message was discarded when the session switched to its canonical id, and the blank replacement seeded itself from a history read the daemon had not written the message to yet.

- [#538](https://github.com/qlan-ro/mainframe/pull/538) [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the older Claude models the CLI's own picker hides. The probed catalog is now merged with a curated list of models the API still serves — Opus 4.8/4.7/4.6/4.5/4.1 and Sonnet 4.6/4.5 — deduped against the probe by id and resolved alias. They appear under an "Older models" label in the composer's provider/model picker, and the static fallback catalog drops every retired id.

  Every model's context window, effort ladder and fast-mode flag is now taken from the CLI's own model registry instead of inferred from its family, correcting the 1M window on Opus 4.8/4.7, the xhigh effort level on Sonnet 5, and the effort ladders on Opus 4.6/4.5/4.1 and Sonnet 4.5.

- Updated dependencies [[`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c), [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.15

## 2.0.0-rc.16

### Minor Changes

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the automations editor around values you can name and reuse. Every text field in an automation now accepts `$name` references through the same picker, a Set value step names a result once so later steps can use it, and renaming that value rewrites every step that referred to it. Write `${name}` where a bare `$name` would run into surrounding text, as in `todo/${id}`.

  Each step that produces a value carries its own name, so reordering steps no longer silently repoints a reference at a different step. Two values sharing a name is reported as a problem on both, rather than one quietly winning.

  Webhook triggers can be registered from the editor, which now shows the signing secret alongside the URL — without it a registered hook rejected every delivery. The secret is shown on request and never leaves the editor; reveal it again any time, it does not change.

  Problems are reported on the step that caused them, including the ones the daemon finds at save time, which used to appear only as a toast. A reference to a name nothing defines is a warning rather than an error, so a prompt containing `$HOME` no longer blocks saving.

- [#521](https://github.com/qlan-ro/mainframe/pull/521) [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface the Setup Advisor in the toolbar. Opening it fingerprints the active project and lists the MCP servers, skills, hooks, subagents, and plugins that its stack earns, one tab per category, each command a click away from the clipboard. Every recommendation shows the signal that triggered it, and a third-party rule names its source repo and install count in a distinct chip — an aggregator install stays a decision, not a surprise.

- [#523](https://github.com/qlan-ro/mainframe/pull/523) [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Turn two things agents write into chat into things you can act on. A slash instruction in an assistant message becomes a chip that adds the instruction to the composer or opens a new session prefilled with it — neither sends, so you still decide. A localhost URL becomes a chip that opens the link when the daemon is your own machine, and offers to tunnel the port when it isn't, so a dev server running on a remote daemon is one click away instead of an SSH session. Tunnels are listed in the remote-access pane with a stop control, and they close when the chat's scope does.

- [#525](https://github.com/qlan-ro/mainframe/pull/525) [`84e28ef`](https://github.com/qlan-ro/mainframe/commit/84e28ef751338b9f237a2c84647d2dff00388c16) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Copy file paths and quote text straight from a chat message.

  Right-clicking a file path in a tool result offers Copy Absolute Path and Copy Relative Path. Both are derived from the same worktree and project roots that left-clicking the path opens with, so the path you copy and the file you open can never disagree. Markdown links keep their own copy/open menu, and paths inside a subagent transcript are left to the system menu.

  Selecting text in a message raises a floating toolbar with Quote and New session. Quote adds the selection to the composer as its own quote with its own comment box, so several passages — including passages from different messages — can be quoted and sent as one message. New session opens a draft on the same project, prefilled with the selection. Neither action sends anything on its own. The editor's Add Agent Context now adds a quote the same way, and a quote carrying no comment can be sent for the first time.

- [#520](https://github.com/qlan-ro/mainframe/pull/520) [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer to move a session into a worktree the agent just created. When an agent adds a worktree mid-session, the composer surfaces it as an offer: accept and the session rebinds and restarts there, dismiss and it stays dismissed for that chat. Sessions already isolated in a worktree can move to another one from the existing worktree popover.

### Patch Changes

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Teach automations three things the editor will need: a `set_variable` step that names a value once and reuses it downstream, `once` schedules that fire at a single moment instead of on a repeating pattern, and webhook triggers that carry their registration. Variables resolve by scope, so a name set inside a repeat belongs to that repeat and does not leak to later steps. The engine, the scheduler, and the shared types all understand them; the editor UI for authoring them lands separately.

- [#527](https://github.com/qlan-ro/mainframe/pull/527) [`eed8395`](https://github.com/qlan-ro/mainframe/commit/eed8395fd4333047d3fb7d1278f47bd697d4554c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A permission prompt the agent withdraws now disappears on its own instead of waiting for an answer it can no longer use, and the next queued prompt takes its place.

- [#513](https://github.com/qlan-ro/mainframe/pull/513) [`4ce69b3`](https://github.com/qlan-ro/mainframe/commit/4ce69b3a35c4078605716cd2153a2da303bff9be) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Change the default dark theme's accent from periwinkle purple to macOS system blue (#0A84FF), matching the light theme. The dark selection tint, focus ring, command-directive tint, and code-editor selection highlight follow the new accent.

- [#512](https://github.com/qlan-ro/mainframe/pull/512) [`4a84d8c`](https://github.com/qlan-ro/mainframe/commit/4a84d8c993398258407d127b20dc2afd31db4b24) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dismiss the image lightbox by clicking the image or the dimmed area around it.

  The lightbox closed only on clicks that landed on the overlay — the empty bands above and below the image — because the image and the dimmed space beside it sit inside the dialog's content box. Clicking anywhere that is not a control now closes it; the prev/next buttons, the counter, Escape, and the close button behave as before.

- [#520](https://github.com/qlan-ro/mainframe/pull/520) [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix "Could not switch worktree — No such file or directory (os error 2)" when accepting a worktree-switch offer. Claude's own worktree tool relocates the session transcript as soon as the agent enters the worktree, so by the time the daemon rebinds the chat there is nothing left to move. That absence is now expected rather than fatal. When the move does fail for a real reason, the chat restarts on its current binding instead of being left stopped and unbound, and the toast explains what happened instead of quoting the raw OS error. Moving session files also no longer overwrites a transcript that is already at the destination, so a leftover file in the old directory cannot replace the live one. After a successful move the chat's stored transcript path now follows the transcript into the worktree instead of pointing at the directory it just left.

  Worktree offers no longer go missing after a worktree is deleted and recreated at the same path. A chat now remembers each worktree it has already seen by identity rather than by path alone, and refreshes that record on every scan instead of freezing it when the chat starts. A worktree rebuilt in place is a different worktree, so it is offered again — even when the remove and the add run as a single command and the path never appears to have gone away.

  Switching worktrees mid-session no longer leaves the thread stuck on "Composing…" with a Stop button. The switch restarts the CLI, and the restart alone was being read as a turn in flight; since no turn was running, nothing ever arrived to clear it.

  Switching is now blocked while the agent is answering, rather than cutting the answer off. The offer stays on screen and says it becomes available once the response finishes.

  The composer's worktree control is blocked on the same terms. Isolating a session, moving it to another worktree, or dropping its worktree each restart the CLI, so all three now wait for the response to finish. The popover still opens and still lists the branches and worktrees on offer — they are only disabled, under a note saying when they come back — and the daemon refuses the request even if it arrives another way.

- Updated dependencies [[`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca), [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d), [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.14
