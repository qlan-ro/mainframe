---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

`/launch-config` now generates configs that run.

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
