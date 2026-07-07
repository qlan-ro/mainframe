# Running the Daemon

The Mainframe daemon is a background service that manages agent CLIs (Claude, Codex) and serves the desktop and mobile apps over HTTP/WebSocket. This guide covers running it on a server or always-on machine — installing prerequisites, installing the daemon, and keeping it running as a service.

A server daemon set up this way can be driven by any client: the mobile app, your own API integrations, or the desktop app — which can pair with it as a **remote daemon** (daemon picker → *Add remote daemon*) and switch between it and the local one.

> For exposing the daemon to the mobile app or remote clients, see **[Cloudflare Tunnel Setup](./cloudflare-tunnel.md)** — this guide links to it rather than repeating tunnel configuration. Remote-daemon pairing from the desktop app needs a **named** tunnel (quick-tunnel URLs rotate on restart).

## System requirements

- **64-bit Linux or macOS.**
- **A modern glibc (Linux).** The bundled Node runtime requires **glibc ≥ 2.28** — Ubuntu 20.04+, Debian 10+, RHEL 8+. Ubuntu 18.04 (glibc 2.27) and older will fail with `GLIBC_2.28 not found`; upgrade the OS or run the daemon in a container with a modern base image.
- **`libatomic`** must be present. Minimal server images often omit it; the daemon's Node binary won't start without it (`libatomic.so.1: cannot open shared object file`).
  - Debian/Ubuntu: `apt-get install -y libatomic1`
  - RHEL/Fedora: `yum install -y libatomic`
  - Alpine: `apk add libatomic libstdc++`

The daemon ships its own Node runtime, so you do **not** need to install Node to run it. Node is only relevant if you install the agent CLIs via npm (below).

## 1. Install the agent CLIs

The daemon spawns these as child processes and finds them on your `PATH`. Install the ones you use.

**Claude Code**

```bash
curl -fsSL https://claude.ai/install.sh | bash   # installs to ~/.local/bin/claude
```

Verify: `claude --version`. The native installer needs no Node.js and auto-updates. See the [Claude Code setup docs](https://code.claude.com/docs/en/setup) for alternatives (e.g. `npm install -g @anthropic-ai/claude-code`).

**Codex CLI**

```bash
npm install -g @openai/codex      # or: brew install --cask codex
```

Verify: `codex --version`. See the [Codex CLI docs](https://developers.openai.com/codex/cli). The installer places a `codex` binary on your `PATH` (commonly `~/.local/bin`).

**cloudflared** (only for remote access) is **bundled with the standalone daemon** — you usually don't install it separately. See [Cloudflare Tunnel Setup → Prerequisites](./cloudflare-tunnel.md#prerequisites) if you need it standalone.

Sign each CLI into its account once (`claude`, `codex`) before the daemon drives it.

## 2. Install the daemon

```bash
curl -fsSL https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash
```

This downloads a self-contained release tarball to `~/.mainframe/bin` — a bundled Node runtime, `cloudflared`, and the daemon. The launcher is `~/.mainframe/bin/bin/mainframe`. Add it to your `PATH`:

```bash
export PATH="$HOME/.mainframe/bin/bin:$PATH"   # add to ~/.bashrc or ~/.zshrc
```

> The command is `mainframe`. Older installs exposed it as `mainframe-daemon`; that name still ships as an alias, so existing systemd units keep working after an update.

## 3. Run it

```bash
mainframe
```

The daemon listens on `http://127.0.0.1:31415` by default. To connect the mobile app, generate a pairing code from a second shell (the daemon must already be running):

```bash
mainframe pair
```

Enter the code in the mobile app. Pairing over the internet requires a tunnel — see [step 5](#5-remote-access).

Configuration is read from `~/.mainframe/config.json` and these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DAEMON_PORT` | HTTP + WebSocket port | `31415` |
| `MAINFRAME_DATA_DIR` | Data directory (SQLite DB, attachments, logs) | `~/.mainframe` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## 4. Run as a service (systemd)

A raw `mainframe` dies when your SSH session ends. On Linux, run it under systemd so it survives logout and restarts on boot or crash.

**Run as a dedicated non-root user.** The daemon drives AI agents that execute shell commands; running them as root gives every command unrestricted power over the host. A normal user also means you don't need the `IS_SANDBOX=1` escape hatch (Claude Code refuses `--dangerously-skip-permissions` as root unless a sandbox is asserted).

The key gotcha: **systemd does not inherit your login `PATH`**, so the unit must list the directory holding `claude`/`codex` (usually `~/.local/bin`) or the daemon can't spawn them.

```ini
# /etc/systemd/system/mainframe.service
[Unit]
Description=Mainframe Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mainframe
Environment=HOME=/home/mainframe
Environment=PATH=/home/mainframe/.local/bin:/home/mainframe/.mainframe/bin/bin:/home/mainframe/.mainframe/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/mainframe/.mainframe/bin/bin/mainframe
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now mainframe
systemctl status mainframe
journalctl -u mainframe -f      # live logs
```

Note the launcher path is `.mainframe/bin/bin/mainframe` (nested `bin/bin` — the release tarball's `bin/` extracted under the install dir).

## 5. Remote access

To reach the daemon from the mobile app or another machine, expose it with a Cloudflare tunnel. The daemon can manage `cloudflared` for you (`TUNNEL=true`) or use a persistent named tunnel.

**See [Cloudflare Tunnel Setup](./cloudflare-tunnel.md)** for quick vs. named tunnels, the runtime API, and troubleshooting. To enable it under systemd, add `Environment=TUNNEL=true` (plus `TUNNEL_TOKEN`/`TUNNEL_URL` for a named tunnel) to the unit above.

## Updating

Upgrade in place with the built-in updater. It downloads the latest release tarball for your platform and unpacks it over `~/.mainframe/bin`:

```bash
mainframe update            # latest stable release
mainframe update --pre      # include pre-releases (e.g. the current 2.0 rc line)
mainframe update --version v2.0.0-rc.1   # a specific tag
```

`update` replaces the on-disk files only — the running daemon keeps serving until you restart it, so finish with:

```bash
systemctl restart mainframe      # or: kill the foreground process and re-run `mainframe`
```

Check versions with `mainframe --version` (the installed binary) and `mainframe status` (the **running** daemon) — after a restart they should match.

Re-running the [install script](#2-install-the-daemon) does the same thing and is the fallback if the daemon is too broken to run `mainframe update`.

## Troubleshooting

- **`GLIBC_2.28 not found` / `libatomic.so.1: cannot open shared object file`** — see [System requirements](#system-requirements). Old OS or missing `libatomic`.
- **`Cannot find module 'better-sqlite3'`** — releases now bundle a full `node_modules` next to the daemon, so a fresh install shouldn't hit this. If you're on an **older tarball** that predates the fix, either re-run the [install](#2-install-the-daemon) to pull a current release, or install the module beside the bundle as a stopgap: `cd ~/.mainframe/bin/lib && npm init -y && npm install better-sqlite3@^12`.
- **`claude`/`codex` not found (only under systemd)** — the unit's `PATH` is missing the CLI directory. Add `~/.local/bin`, then `systemctl show mainframe -p Environment` to confirm.
- **`--dangerously-skip-permissions cannot be used with root/sudo`** — you're running the daemon as root. Run as a non-root user (recommended), or set `IS_SANDBOX=1` only inside a genuinely contained environment.
- **Pairing works locally but not remotely** — you need a tunnel; see [step 5](#5-remote-access).
