# @qlan-ro/mainframe-ui

## 2.2.0

### Minor Changes

- [#683](https://github.com/qlan-ro/mainframe/pull/683) [`8b36033`](https://github.com/qlan-ro/mainframe/commit/8b3603326612e354422ed51b1dd0c68a351a302f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the sidebar's inline Projects list with a multi-select project scope dropdown. Any number of projects can be checked (empty = all); the trigger shows the scope, the attention hidden by it, and a hover ✕ that clears it. Selecting a project no longer switches the active session. The single-project filter persisted in `mf:filterProjectId` migrates to the new `mf:filterProjectIds` set automatically.

### Patch Changes

- [#680](https://github.com/qlan-ro/mainframe/pull/680) [`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Slash commands are back in the composer.

  Typing `/` listed only skills. The daemon had been serving its commands the whole time — `/launch-config` among them — but the renderer never asked for them: the Electron→Tauri rebuild carried over the daemon half of the feature and not the client half, so the endpoint answered into nothing.

  `/` now lists commands above skills, marked with a wrench so they read as a different kind of thing, and picking one sends it as an invocation rather than as the literal text `/launch-config`. A command must be the whole message — `/launch-config for the api package` is sent as an ordinary message, because a command replaces the message with its own prompt and those extra words would be dropped without a trace.

  Commands come from the daemon's registry, so a command added there appears in the composer with no further change here, and adapter-published commands will work the same way once they are re-enabled.

- [#681](https://github.com/qlan-ro/mainframe/pull/681) [`7a888f5`](https://github.com/qlan-ro/mainframe/commit/7a888f5b9aa40dfb403a8734466f55b6eb557af9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tell GitHub's two connect buttons apart

  With a GitHub App client ID configured, the credential field offered two buttons that both read "Connect GitHub…" — one starting device-flow sign-in, one opening the token field. Nothing distinguished them.

  Sign-in now leads as the primary action and says "Sign in with GitHub"; the token path sits below it as "Use a personal access token…". With no client ID configured, the token button is the only one and reads "Connect GitHub…" as before.

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

- Updated dependencies [[`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97), [`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97)]:
  - @qlan-ro/mainframe-types@2.2.0
