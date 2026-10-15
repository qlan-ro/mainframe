# Live QA: Mainframe

Follow `~/.agents/skills/live-qa/SKILL.md` for workflow, drivers and lifecycle.
These notes supply project-specific launch, isolation, fixture and UI facts.

## Targets and launch

| Target | Surface | Driver | Launch |
|---|---|---|---|
| `browser` | Shared React renderer + Rust daemon; cheapest for renderer/daemon checks | Playwright | `bash .agents/test-env.sh up browser` |
| `tauri` | Tauri dev shell, including native surfaces | Tauri | `bash .agents/test-env.sh up tauri` |
| `tauri-qa` | Packaged debug app with the QA bridge/config overlay | Tauri | `bash .agents/test-env.sh up tauri-qa` |

The browser target does not cover preview child webviews, native menus/dialogs,
window chrome or Tauri-command-backed behavior. It does not reproduce WKWebView rendering.
For packaged behavior, see [the QA build guide](../docs/guides/packaged-tauri-qa.md);
the QA overlay changes CSP, so it is not identical to the production security configuration.

The harness accepts `--worktree <absolute-path>` and routes through the primary
checkout's launch scripts while building/running the requested checkout.
`up browser` and `up tauri` own preparation and readiness; `prepare browser|tauri`
performs their preparation without launching. `tauri-qa` requires
`bash scripts/build-qa-tauri.sh` in the target checkout before its first launch and
after relevant source changes; its `up` does not rebuild the bundle.
Use the printed URL, ports and log paths. Desktop identity is the backend `cwd`
and intended window; the project selected inside the app is not the binary's checkout.

Use explicit run-owned ports with `bash .agents/test-env.sh down <ports...>`
(and `--worktree <path>` for another checkout). For dev targets, pass the recorded
`DAEMON_PORT` and `VITE_PORT`; for packaged QA, pass its recorded daemon and bridge
ports. The no-argument teardown also targets legacy CDP port `9222`, which need
not belong to this run. Teardown checks port numbers, not process ownership.
Killing a Tauri daemon port may also terminate its parent app; it is not a daemon-only restart.

## Environment and data

- `scripts/setup-ports.sh` generates `.env` on first use. Dev daemon ports are
  `31416–32416`; Vite ports are `5174–6174`. Existing `.env` values are reused.
- `tauri` and `browser` in one checkout share `.env` ports and cannot run together
  on those ports. The browser target also builds the Rust daemon.
- Automated runs pass `MF_QA_RUN_DIR=<absolute run directory>` to the harness.
  All three targets then use `<run directory>/data`, overriding shared defaults;
  keep that same directory on resume. This isolates app data, not OS keychain/provider
  accounts. Reuse a verified running app before calling `up` again.
- Without `MF_QA_RUN_DIR`, dev data defaults to `~/.mainframe_dev`, shared across checkouts. Packaged QA
  defaults to `~/.mainframe_qa`, also shared; its overrides are `MF_QA_DATA_DIR`
  and `MF_QA_DAEMON_PORT`. Its daemon port defaults to the dev port plus 1000.
  Separate ports do not make these data directories isolated per run.
- Capacity ceilings: one `tauri`, one `tauri-qa`, four browsers, four runs total;
  only one native build at a time. Parallel runs still require independent data
  and ports. Shared-data runs are sequential.
- Production daemon port `31415` and data directory `~/.mainframe` are protected.
  All builds also share bundle ID `ro.qlan.mainframe` and the WKWebView data store;
  resetting that store affects the installed app too.

## Authentication and fixtures

- The SQLite file is `$MAINFRAME_DATA_DIR/mainframe.db`; default dev data is shared.
  There is no `DELETE /api/chats/:id` endpoint. `POST /api/chats/:id/archive`
  hides a chat; it does not delete the fixture.
- Direct session-state writes to SQLite may not update the running daemon's cache;
  use app/API operations for live state transitions.
- Register filesystem fixtures with `POST /api/projects {"path":"<checkout>"}`,
  or seed only the project row using the recipe below. Neither requires UI setup.
  Check the returned path; an existing project named Mainframe may use another checkout.
- For CLI transcript/session-path scenarios on macOS, `/tmp` resolves through
  `/private/tmp`; use a canonical project path (for example under `~/Projects`).
  This does not restrict the skill's artifact directory.
- External-edit fixtures should avoid the renderer's watched source directories,
  where HMR would interfere with the observation.

### Seed a project in an isolated database

Launch with `MF_QA_RUN_DIR` set to a unique absolute directory under `/tmp/live-qa`
and wait for harness readiness. Confirm its printed `DATA_DIR` is that run's `data`
directory. The daemon must create and migrate `mainframe.db` before seeding.
Use a Rust toolchain meeting `packages/core-rs/Cargo.toml`'s `rust-version`.
The browser launcher prints process IDs and uses `nohup`; verify the recorded
processes and endpoints still exist after the launcher returns to your execution host.

Set `MF_QA_PROJECT_PATH` to an existing directory. For native transcript checks,
use the transcript's original canonical project path, which may differ from the
checkout being tested. Seeding registers this path; it does not copy or edit it.
From the repository checkout, run `python3 .agents/seed-qa-project.py seed`
with both variables exported. The helper writes its unique ID and canonical path
to `$MF_QA_RUN_DIR/project-fixture.json` and prints them after the insert commits.

Keep the marker even if insertion fails; inspect the database before retrying.
Do not reuse another run's marker. The helper refuses an absent database and
paths outside the isolated run, including symlinked data directories.

Verify the marker's ID and canonical path in `GET /api/projects` on the recorded
daemon port. This route reads SQLite; direct writes do not emit app events or
refresh daemon caches. Reload the project list before selecting the fixture.
For an existing native session, call
`POST /api/projects/{projectId}/external-sessions/import` with
`{"sessionId":"<native-session-id>","adapterId":"claude"}`.
Record the returned `data.id` in the run checkpoint before further actions.
The API creates the chat, native-session and segment records; do not seed those
rows manually. Check `GET /api/chats/{id}/messages` and the intended UI state.

For restoration, finish evidence capture, stop the run-owned target with the
explicit recorded ports described above, and verify the daemon has exited. Run
`python3 .agents/seed-qa-project.py restore <recorded-chat-id> ...`,
omitting IDs if none were imported. The transaction refuses unrecorded chats,
deletes only this fixture's rows and checks native-session cleanup and foreign keys.
Other dependencies cause rollback and require inspection. Keep the marker with
the report; do not delete the project directory or native transcript.
Unless teardown was requested, restart the same isolated target through the harness
with the same `MF_QA_RUN_DIR` and checkout, and verify readiness for interactive review.
Record the checkout HEAD and build identity again; after HEAD or source changes,
rebuild before review rather than reusing the earlier binary. Dev targets build on
`up`; packaged QA needs the rebuild described under Targets and launch.
After restoration, close and verify closure of the run's named automation browser
unless the user requested it stay open. An explicit teardown request leaves the
target stopped; otherwise leave the restarted app server or native app available.

## UI targeting

- Workspace root: `data-testid="workspace-surface"`. Tab strips use
  `workspace-tab-strip-<paneId>`; pills use `workspace-tab-<id>`, `role="tab"`
  and `aria-selected`. Old `data-zone="right-top"` / `data-active` recipes are stale.
  Some layouts show content without a tab strip.
- Radix tooltips portal to `<body>`. Multiple or dismissing tooltips can coexist;
  match the expected tooltip text rather than an arbitrary `[role="tooltip"]`.

## Known limitations

Dev and packaged QA bridge bases are `127.0.0.1:9223` and `127.0.0.1:9323`;
use the actual launched endpoint. Bridge failures observed in July 2026 (not reverified on the current bridge):

- `window.__MCP__.resolveRef is not a function`: selector/ref helpers may be broken;
  use the global Tauri driver's diagnostic and coordinate fallback procedure.
- `Resolve-ref helper was not available in the webview after registration.`:
  the packaged-QA guide documents a helper-cache recovery that stops all bridge
  sessions. It is conditional recovery, not normal teardown, and cannot interrupt
  another run's connection.
- `window not found` with a mounted preview: stop the run-owned preview launch
  config before attaching; this is distinct from the helper-cache failure.
- Keep DOM snapshots scoped to a small container. Older installed bridges have
  rejected compound `:not()` selectors in `webview_wait_for`.
