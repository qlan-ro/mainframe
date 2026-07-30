# @qlan-ro/mainframe-core

## 2.0.0-rc.15

### Minor Changes

- [#543](https://github.com/qlan-ro/mainframe/pull/543) [`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the models a locally running CLIProxyAPI serves as selectable Claude-adapter models. When the proxy answers on `127.0.0.1:8317`, its catalog is merged into the Claude adapter's under `cliproxy/`-namespaced ids and appears in the composer's model picker under a "CLIProxyAPI" section, below the native Claude models. Entries read like the native ones — "OpenAI - GPT 5.6 Sol", not `gpt-5.6-sol`, with a caption naming the cut of the model and the account that answers for it — and the section is ordered by provider, then capability, instead of however the proxy happened to list them. Picking one spawns the same `claude` CLI against the proxy — `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` point the child at the endpoint, `ANTHROPIC_DEFAULT_HAIKU_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` give it a background model the proxy actually serves, and any inherited `ANTHROPIC_API_KEY` is removed so the session can't fall back to the real account.

  The proxy's API key is read from its own config file at spawn time and never stored in Mainframe's database or the OS keyring; set `MAINFRAME_CLIPROXY_CONFIG` if the config lives outside the standard Homebrew paths. Rate-limit events from a proxy session no longer update the Anthropic quota indicator, which measures a subscription the session isn't billing. Switching a chat between a proxy model and a native one respawns the CLI instead of hot-swapping the model, since the endpoint changes with it.

  Nothing changes when no proxy is running: the group is absent from the picker, and the Providers settings pane reports it as not detected. Title generation and account quota deliberately stay on the real Anthropic account.

### Patch Changes

- [#541](https://github.com/qlan-ro/mainframe/pull/541) [`82f5198`](https://github.com/qlan-ro/mainframe/commit/82f5198fed58155ab76cdb8c3bbce0e373c2851f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sessions now get an AI-generated title instead of the truncated first message. Titles are generated with `codex exec --ephemeral --ignore-user-config`, which leaves no session file, history entry, or thread row behind. Each adapter now titles with its own binary, so a machine with only Codex installed no longer shells out to `claude`; `provider.<adapterId>.titleBinary` still overrides it.

- [#529](https://github.com/qlan-ro/mainframe/pull/529) [`739b8d8`](https://github.com/qlan-ro/mainframe/commit/739b8d8e9baf1a808969fcb9e32c279703900c0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Claude adapter persisting session-scoped permission grants. It used to rewrite every permission update's destination to `.claude/settings.local.json` before echoing it back to the CLI, regardless of what the CLI itself declared — most damagingly for a permission-mode change, which landed as the project's new default mode. The adapter now forwards each update's declared destination as-is, with one added rule: a mode change is never forwarded to a persisting destination, so it can only ever apply to the running session.

  The same inverted rewrite is removed from the orphaned Node daemon (`packages/core`); its `setMode` guard was not ported there, since that daemon is unshipped and kept only for its `package.json` version.

  Entries this bug already wrote into `.claude/settings.local.json` — most notably a stray `defaultMode` — are not migrated or removed by this fix. If you see one you didn't set deliberately, delete it by hand.

- Updated dependencies [[`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c), [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.15
