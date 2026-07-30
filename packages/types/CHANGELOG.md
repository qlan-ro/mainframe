# @qlan-ro/mainframe-types

## 2.0.0-rc.15

### Patch Changes

- [#543](https://github.com/qlan-ro/mainframe/pull/543) [`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the models a locally running CLIProxyAPI serves as selectable Claude-adapter models. When the proxy answers on `127.0.0.1:8317`, its catalog is merged into the Claude adapter's under `cliproxy/`-namespaced ids and appears in the composer's model picker under a "CLIProxyAPI" section, below the native Claude models. Entries read like the native ones — "OpenAI - GPT 5.6 Sol", not `gpt-5.6-sol`, with a caption naming the cut of the model and the account that answers for it — and the section is ordered by provider, then capability, instead of however the proxy happened to list them. Picking one spawns the same `claude` CLI against the proxy — `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` point the child at the endpoint, `ANTHROPIC_DEFAULT_HAIKU_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` give it a background model the proxy actually serves, and any inherited `ANTHROPIC_API_KEY` is removed so the session can't fall back to the real account.

  The proxy's API key is read from its own config file at spawn time and never stored in Mainframe's database or the OS keyring; set `MAINFRAME_CLIPROXY_CONFIG` if the config lives outside the standard Homebrew paths. Rate-limit events from a proxy session no longer update the Anthropic quota indicator, which measures a subscription the session isn't billing. Switching a chat between a proxy model and a native one respawns the CLI instead of hot-swapping the model, since the endpoint changes with it.

  Nothing changes when no proxy is running: the group is absent from the picker, and the Providers settings pane reports it as not detected. Title generation and account quota deliberately stay on the real Anthropic account.

- [#538](https://github.com/qlan-ro/mainframe/pull/538) [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Offer the older Claude models the CLI's own picker hides. The probed catalog is now merged with a curated list of models the API still serves — Opus 4.8/4.7/4.6/4.5/4.1 and Sonnet 4.6/4.5 — deduped against the probe by id and resolved alias. They appear under an "Older models" label in the composer's provider/model picker, and the static fallback catalog drops every retired id.

  Every model's context window, effort ladder and fast-mode flag is now taken from the CLI's own model registry instead of inferred from its family, correcting the 1M window on Opus 4.8/4.7, the xhigh effort level on Sonnet 5, and the effort ladders on Opus 4.6/4.5/4.1 and Sonnet 4.5.
