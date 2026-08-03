# @qlan-ro/mainframe-ui

## 2.0.0-rc.18

### Minor Changes

- [#536](https://github.com/qlan-ro/mainframe/pull/536) [`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reference another session from the composer with `@`.

  Typing `@` in the composer now offers other sessions in the project alongside files and agents. Picking one inserts `@label`; sending the message prepends a reference line carrying the session's transcript path, and the sent message renders the mention as a chip instead of the raw path. Session titles are now derived from what the message showed the reader, so neither a reference line nor a preview-capture block can leak into a sidebar title.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Browse skills.sh from the Setup Advisor. The Skills section is now one list — the skills you have, then the registry's most-installed — with search covering the whole registry rather than the visible rows. An installed row reads "Installed" and swaps to Uninstall on hover, so no row offers to install something you already have; installing asks which scope on the Install button itself, at the moment you install. Two daemon routes back it, and the list degrades to search-only when the registry catalog can't be read, keeping your installed rows. Both reads report themselves: the list waits as skeletons rather than briefly offering to install skills you already have, and a refresh or a search marks the search field while it runs.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Install and uninstall skills from the Setup Advisor's new Skills section, run through the `skills` CLI on the daemon host.

- [#551](https://github.com/qlan-ro/mainframe/pull/551) [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude Code workflow runs now show their phases, agents and totals in a details panel, reachable from the transcript and the background-activity popover.

- [#559](https://github.com/qlan-ro/mainframe/pull/559) [`69aad41`](https://github.com/qlan-ro/mainframe/commit/69aad410a149b9e608eb5b996a06b2fbabccc314) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tasks board: two-way GitHub Issues sync — link a repo, import or publish tasks, and reconcile title, body, state, and labels with an after-the-fact overwrite report.

- [#548](https://github.com/qlan-ro/mainframe/pull/548) [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude's attention requests now raise a Mainframe notification, including a native desktop banner, with a new Chat setting to turn them off.

### Patch Changes

- [#555](https://github.com/qlan-ro/mainframe/pull/555) [`3124305`](https://github.com/qlan-ro/mainframe/commit/31243059da3449a0f4ad8e7fbfacc44f2b773bc3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Inline gate cards (plan, permission, ask-a-question) now span the same width as the composer instead of stopping ~64px short of it.

- [#558](https://github.com/qlan-ro/mainframe/pull/558) [`2be9b43`](https://github.com/qlan-ro/mainframe/commit/2be9b43f1773a330e8cd3ef8e28798299a7c95b8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the GitHub actions through the `gh` CLI instead of a hand-rolled HTTP client. `github.create_pr` and `github.list_prs` no longer ask for a token — `gh` already holds one — and `github.list_prs` now resolves `@me`, which the REST search endpoint never did. When `gh` is missing or signed out, the action catalog reports both actions unavailable and the editor mutes them with the remedy instead of offering a step that always fails.

- [#550](https://github.com/qlan-ro/mainframe/pull/550) [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A project whose directory is gone is now marked unavailable in the switcher, its sessions refuse to send with the real reason instead of failing silently, and the recovery card sits above the composer in the thread's sticky footer instead of at the top of the transcript, where it stayed visible but scrolled out of reach.

- [#546](https://github.com/qlan-ro/mainframe/pull/546) [`82c23ba`](https://github.com/qlan-ro/mainframe/commit/82c23ba06b9502b22935252114e2eaf1aec5749d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Project in the sessions sidebar now opens the app's own confirmation dialog instead of a browser dialog the desktop webview never renders, so the action works at all. A removal the daemon rejects raises an error toast carrying its message and leaves the project in the list, instead of reporting a false success.

- [#547](https://github.com/qlan-ro/mainframe/pull/547) [`b93d09e`](https://github.com/qlan-ro/mainframe/commit/b93d09ed257efc28f5d71bdfc7372ea8f9a669fc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a session row's PR chip vanishing under width pressure: at most one PR ever renders inline (the most recent, created preferred over merely-mentioned), a count indicator always stands in above one PR, and hover no longer reflows the row — only the purely decorative worktree glyph and tag dots yield width, one at a time, and only ever at their own natural size.

- [#549](https://github.com/qlan-ro/mainframe/pull/549) [`2b648e8`](https://github.com/qlan-ro/mainframe/commit/2b648e8b26e33465f0fc5f60c0253a648d3aa600) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix attachments against a remote daemon: a stale device token used to fail the upload silently, drop the user's files from the composer, and show a bare "Failed to send" with no way back. A remote 401/403 now marks that daemon `needs-repair` in the footer (the stored token is untouched), the failed message names the cause (authorization, size, or unreachable) instead of a raw HTTP status, and the attachments the send consumed are put back into the composer instead of vanishing. Completing a re-pair swaps the live token in place, so the next send works without restarting the app.

  The Rust daemon (`packages/core-rs`, not a changeset package) now logs one structured record per attachment-upload outcome and per rejected-auth request — accepted/rejected, count, byte total, reason — with no file names, bytes, or tokens. It also stops axum's default 2 MB body limit from shadowing the daemon's explicit 30 MB layer, which was silently rejecting any attachment over ~1.5 MB with an empty-bodied 413 on every daemon, local or remote.

- [#560](https://github.com/qlan-ro/mainframe/pull/560) [`b614ae9`](https://github.com/qlan-ro/mainframe/commit/b614ae9bc59653f40b5415fee952f075b2eba9d6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix plan-mode approval on the Rust daemon: approving a plan now applies the execution mode you chose, and "clear context and implement" restarts the session with the plan instead of leaving it stuck in plan mode.

- [#556](https://github.com/qlan-ro/mainframe/pull/556) [`5767796`](https://github.com/qlan-ro/mainframe/commit/5767796745e98c42a97f264fa67a9ab87aad2095) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep long unbreakable text inside the user bubble.

  A message containing a token longer than the bubble — a URL, an absolute path, a long inline-code span — used to paint past the card's border and over the transcript, because neither the user card, the queued card, nor the approved-plan card opted into word breaking. All three now break a word that cannot fit, and only such a word: ordinary messages wrap exactly where they did before. The plan card no longer sets `overflow-hidden`, which was silently clipping the same content instead of showing it.

- Updated dependencies [[`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037), [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb), [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.16

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
