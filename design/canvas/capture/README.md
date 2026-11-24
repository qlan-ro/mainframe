# Product-board capture

Redraws an area's product boards from the running app: the real UI against the Rust daemon in mock mode, started by the e2e harness (`packages/e2e`). Product boards are never drawn by hand.

```bash
bash design/canvas/capture/run.sh shell                 # every board of the area
bash design/canvas/capture/run.sh shell Shell-TitleBar  # only these boards
CAPTURE_SKIP_BUILD=1 bash design/canvas/capture/run.sh shell  # reuse the UI bundle of the last run
```

Each state's DOM is written into `design/canvas/project/<Board>.dc.html` with the app's built CSS in the board's helmet. The board's entry in `canvas.json` keeps its place and page; only its size and title follow the capture, and a new board lands below the others on its page. The script warns when a board has grown into a neighbour.

## Prerequisites

- `pnpm install` at the repo root, `pnpm --filter @qlan-ro/mainframe-e2e exec playwright install chromium`, python3.
- The Rust daemon. The harness looks in `packages/core-rs/target/{release,debug}` and builds a release binary when neither exists. `MF_E2E_RUST_DAEMON_PATH` points it at any other `mainframe-daemon`, for example the one inside an installed Mainframe.app; it must speak this branch's API.

A run is isolated. It uses ports 31516 (daemon) and 4399 (UI) of its own, a fresh data dir per group with no `config.json` (so no tunnel starts), projects of its own, and an empty HOME for the daemon, so no skill, agent, session or account of the machine reaches a board. `build.py` also refuses to write a board that holds `/Users/`, `/private/`, `/home/`, the user name or the host name. All of it lives in the ignored `design/canvas/capture/.work/`, which the next run clears.

## Files

| File | What it does |
| --- | --- |
| `areas/<area>.mts` | The area's boards and states. The file name is the area id in `design/areas.json`. |
| `seed.mts` | Realistic projects and sessions, network stubs, small page helpers. |
| `capture.spec.mts` | Starts the app per group, walks the states, writes `.work/<area>.json`, and saves a screenshot of each state there for comparison. |
| `serialise.mts` | Runs in the page: turns the window into static HTML. |
| `build.py` | Lays the frames out, embeds the CSS, writes the board and `canvas.json`. |
| `../lib/boards.py` | The page shape and board chrome, shared with `../foundations/`. |

## Adding a state

A group is one running app: a `launch` (the recording to replay, as in the specs), `before` (stubs, before the page loads), `seed` (projects and sessions) and its states in order. A state's `setup` takes the page from the previous state to this one with the helpers the specs use (`packages/e2e/helpers/tauri`).

```ts
{
  id: 'tab-menu',
  caption: '**Tab menu.** Right-click a session tab.',
  crop: [300, 0, 720, 420],   // or a test id, or nothing for the whole window
  setup: async ({ page, vars }) => {
    await escape(page);       // close what the previous state opened
    await page.getByTestId(`session-tab-${vars['last']}`).click({ button: 'right' });
    await page.getByTestId('session-tab-ctx-close').waitFor();
  },
},
```

- **Light and dark.** A frame follows the board's Theme tweak, because the theme is CSS alone. Set `theme: 'dark'` to pin one, for example where code is highlighted with inline colours.
- **Hover and focus** are kept: the elements hovered or focused at capture carry `data-dcb-*` attributes the CSS answers to. Leave the pointer where it belongs, or `parkPointer(page)`.
- **States the mock daemon has no source for** (plan usage, failing routes): `stub` and `fail` in `seed.mts` answer the request in the browser.
- Give a state that animates in a longer `wait`.

When a state fails, `.work/failed.png` shows the page as it was.

## Rules the serialiser keeps

- Whitespace-only text is dropped beside blocks and in flex or grid boxes, and pinned with a zero-width space elsewhere; the canvas runtime drops bare whitespace.
- Every scrolled area's offset is pinned into the clone, and sticky elements become relative at the offset they had.
- Inputs, textareas and checkboxes keep their values. Images are inlined, canvases become images.
- It reads the whole body, so menus, tooltips, dialogs and the scrollbar thumb outside `#root` are included.
- It works on a clone and never edits the page, so React carries on to the next state.
- Board chrome classes start with `dcb-` and cannot meet an app class. App rules for `:root`, `html`, `body`, `100vh` and `100vw` move onto the frame.

## Checking a board

```bash
node design/canvas/proposals/shot.cjs design/canvas/project/Shell-Window.dc.html light   # and dark
```

This renders the board in the canvas runtime (`design/canvas/proposals/render/support.js`, see `design/README.md`). Compare it with `.work/<Board>.<state>.png`.

## Known limits

- **Interactive boards are not captured.** A board whose states switch on click (`Shell-Flow` and the other `*-Flow` boards) needs its logic written into the board. `Shell-Flow` is still the 11 Nov capture.
- **Only some boards have states yet.** Shell has `Shell-Window`, `Shell-States` and `Shell-TitleBar`. The other areas start with the one board their first capture added; their older boards come from the 11–13 Nov captures until the PR that changes that area adds their states here.
- `Shell-TitleBar` no longer draws the preview-tab strip, which 2.16 shows only as an italic title; the rail's hover states are one state instead of five.
- Mock sessions: provider marks and model names are the mock adapter's placeholders, and turns come from `packages/e2e/fixtures/recordings`.
- **Not deterministic:** clock times, turn durations and the project colours (hashed from a random id) differ between runs, so a re-capture always changes some bytes.
- Scroll-driven edge fades (`scroll-fade-*`) are not drawn, because animations are off in a frame.
- A frame is static HTML at one window size: media queries see the canvas's width, not the frame's. Container queries are right.
