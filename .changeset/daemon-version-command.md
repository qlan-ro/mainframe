---
"@qlan-ro/mainframe-core": minor
---

Surface the daemon version. `mainframe --version` (also `-v` / `version`) prints
the installed binary's version, `mainframe status` shows the **running** daemon's
version, and `GET /health` now returns a `version` field. The version is inlined
into the bundle at build time (esbuild `define`), with a `package.json` fallback
for dev and unbundled runs.
