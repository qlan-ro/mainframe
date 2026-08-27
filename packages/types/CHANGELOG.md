# @qlan-ro/mainframe-types

## 2.2.0

### Patch Changes

- [#680](https://github.com/qlan-ro/mainframe/pull/680) [`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Slash commands are back in the composer.

  Typing `/` listed only skills. The daemon had been serving its commands the whole time — `/launch-config` among them — but the renderer never asked for them: the Electron→Tauri rebuild carried over the daemon half of the feature and not the client half, so the endpoint answered into nothing.

  `/` now lists commands above skills, marked with a wrench so they read as a different kind of thing, and picking one sends it as an invocation rather than as the literal text `/launch-config`. A command must be the whole message — `/launch-config for the api package` is sent as an ordinary message, because a command replaces the message with its own prompt and those extra words would be dropped without a trace.

  Commands come from the daemon's registry, so a command added there appears in the composer with no further change here, and adapter-published commands will work the same way once they are re-enabled.

- [#680](https://github.com/qlan-ro/mainframe/pull/680) [`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `/launch-config` now generates configs that run.

  Its instructions predated variable expansion and never described how the launcher actually
  starts a process, so it produced files that validated and then failed. It told the model a
  port had to be a JSON number, when `"${PORT:-3000}"` is the form to use for an
  environment-driven port; it required a `url` on every configuration, which is optional; and
  it implied an allowlist of runtimes that does not exist.

  It also omitted the four facts that decide whether a configuration works at all: there is no
  `cwd` field, so a process in a subdirectory has to say so in its arguments; a declared port
  is injected as `PORT` and gates readiness, so a wrong one leaves the process on "starting"
  for a minute; `${VAR}` and `${VAR:-default}` resolve against the project's `.env` at parse
  time, so the model never needs to read it; and the process environment is rebuilt rather
  than inherited from a shell.

  The prompt now lives in `prompts/launch-config.md` alongside the command registry instead of
  inside the source file, so it can be reviewed and edited as prose.
