# Testing the remote-daemon connection

This guide explains how to exercise the remote-daemon feature locally by running
a **second** Mainframe daemon as the "remote" and pairing the desktop app to it
over a Cloudflare tunnel. Verify the round-trip on **both** the Tauri and
Electron builds.

## What "remote" means here

The desktop app connects to one daemon at a time. The "remote" daemon is just
another Mainframe daemon — agents and code live on *its* machine — reached over
the tunnel with a per-device bearer token. For local testing, the second daemon
runs on your own machine on a different port and data directory; nothing about
the flow changes versus a daemon on a real server.

## 1. Start a second ("remote") daemon

Run a second daemon with its own port and data directory so it doesn't collide
with your primary one:

```bash
DAEMON_PORT=31600 MAINFRAME_DATA_DIR="$HOME/.mainframe-remote" \
  pnpm --filter @qlan-ro/mainframe-core start
```

This daemon has its own projects, chats, and auth secret under
`~/.mainframe-remote`. Add a project to it so there is something to open once
paired.

## 2. Expose it over a named Cloudflare tunnel

Remote daemons must use a **named** tunnel — quick tunnels rotate their URL on
every restart, which would invalidate the paired URL. See
[`cloudflare-tunnel.md`](./cloudflare-tunnel.md) for the full tunnel setup.

Start the tunnel for the remote daemon (in its **Remote Access** settings, or
via `cloudflared` pointed at `http://localhost:31600`) and note the stable
`https://<name>.trycloudflare`-style or custom-domain URL.

## 3. Generate a pairing code

On the remote daemon, open **Settings → Remote Access → Generate pairing code**
(it is valid for 5 minutes). On a headless box, hit the route directly from the
daemon's own loopback:

```bash
curl -s -X POST http://localhost:31600/api/auth/pair
```

## 4. Pair from the desktop app

In the app's sidebar footer, open the daemon picker → **Add remote daemon…**:

1. **Connect** — paste the tunnel URL and click **Verify** (a `GET /health`
   reachability check).
2. **Pair** — enter the 6-char pairing code and a device name, then **Pair
   daemon**. The token is stored in the OS keyring (Tauri) / `safeStorage`
   (Electron); the registry entry lands in `~/.mainframe/remote-daemons.json`.

The app switches to the remote daemon: the footer shows it as connected, and the
sessions/projects/files are now the **remote** daemon's.

## 5. What to verify

- **Switching** between local and the remote daemon swaps the whole context
  (sessions, projects, files) and does not bleed ids across daemons.
- **Chat + agents + files + changes + git** work against the remote daemon.
- **Local-only affordances are disabled** when remote: "Reveal in Finder",
  "Open externally", and the embedded preview tab.
- **Terminal** stays laptop-local; its cwd falls back to your home directory
  (the remote worktree path doesn't exist locally).
- **Unreachable** — stop the remote daemon/tunnel; the footer offers
  switch-to-local. **Re-pair** — revoke the device on the remote (Remote Access
  → Devices); the next request prompts to re-pair.

Run the full round-trip on **both** the Tauri and Electron desktop builds — the
two host backends (keyring vs `safeStorage`) are independent implementations of
the same `daemons` host-bridge contract.
