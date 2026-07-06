<h1 align="center">Mainframe</h1>

<p align="center">
  AI-native development environment for orchestrating agents
</p>

<p align="center">
  <a href="https://github.com/qlan-ro/mainframe/actions/workflows/ci.yml">
    <img src="https://github.com/qlan-ro/mainframe/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/qlan-ro/mainframe" alt="MIT License">
  </a>
</p>

<p align="center">
  <picture>
    <img src="docs/screenshot.png" alt="Mainframe desktop" height="340">
  </picture>
  &nbsp;&nbsp;
  <picture>
    <img src="docs/screenshot-mobile.png" alt="Mainframe mobile" height="340">
  </picture>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/3eca698b-824f-4e9f-a80b-bcb6e74f31c9" controls muted playsinline width="720">
    Your browser doesn't support inline video. <a href="https://github.com/user-attachments/assets/3eca698b-824f-4e9f-a80b-bcb6e74f31c9">Download the demo</a>.
  </video>
</p>

---

## What is Mainframe?

Mainframe brings all your AI coding agents into one interface. Instead of juggling terminal windows, switching between your IDE and CLI, and losing track of what each agent is doing across projects — Mainframe gives you a single place to manage it all.

AI CLI tools are powerful, but they live in the terminal. Mainframe adds the layer terminals can't: visual file editing, live sandbox previews, task management, cross-project session history, and a mobile companion for working on the go.

> **One person, weekends, lots of coffee.** I poke at this when the mood strikes, ship what I feel like shipping, and change my mind a lot. The roadmap is a sticky note. If you're here this early, welcome to the construction site — bring a hard hat.
>
> **Work in progress.** Mainframe is under active development — some features are incomplete and the mobile companion app is not yet published. Currently focusing on fixing any annoying bugs.
>
> **Windows and Linux** Apps not tested at all, I am open to help with any initial issues found, but not my focus at all for now
>
> **HELP NEEDED** UI/UX experts contributions are a blessing, I'm not the best guy for building UIs

## How it's put together

Mainframe is two pieces:

- **The daemon** — a headless service that does the real work: spawns and supervises the agent CLIs, owns projects and session history, and exposes an HTTP + WebSocket API.
- **Clients** — the desktop app, the mobile companion, or anything you build against the API.

```
claude · codex CLIs  ◄── spawns ──  DAEMON  ◄── HTTP/WS ──  desktop app · mobile app · your tools
                              (local or on a server)
```

The desktop app ships with a daemon built in — download it and you're done. The same daemon also installs standalone on a server, and any client can pair with it remotely.

**Which setup do I want?**

| You want to… | Run |
|---|---|
| Use agents on your dev machine, full UI | **Desktop app** — daemon included, nothing else to install |
| Run agents on a server, headless, or under your own UI/automation | **Standalone daemon** — see [Running the Daemon](docs/guides/running-the-daemon.md) |
| Drive a server's agents from the desktop app *(new)* | Both: expose the server daemon via a [named tunnel](docs/guides/cloudflare-tunnel.md), then pair it in the app's daemon picker — switch between "This Mac" and remotes anytime |
| Work from your phone | **Mobile app**, paired to any of the above (tunnel required) |

## Features

- **Unified provider interface** — One app for Claude, Codex, and potentially other AI coding agents — switch providers without changing your workflow
- **API-first daemon** — Everything the apps do goes through the daemon's HTTP and WebSocket API; run it standalone and build your own UI, integrations, or automations
- **Multi-project session management** — Run sessions across multiple projects with instant context switching and full session history
- **Remote daemons** *(new)* — Pair the desktop app with daemons on your servers and drive their agents as if they were local
- **In-app file editing** — View and edit files, diffs, and code directly in Mainframe without switching to your IDE
- **Sandbox preview** — Launch dev servers and preview your app with a built-in browser and inspector for adding precise context
- **Task management** — Integrated kanban board to track agent work and your own todos alongside sessions
- **Content referencing** — @-mention files, add context on diff viewer, add context from the file editor, to give agents exactly the context they need
- **AI tools management - WIP** — Makes sure your project is AI ready. Handling Subagents, Skills, MCPs, context files.
- **Mobile companion** — Monitor and interact with your sessions from your phone — review, approve, and respond on the go
- **Extensible plugin system - WIP** — Add UI panels, databases, event listeners, and new AI adapters through a capability-based plugin API

## Getting Started

### Prerequisites

Mainframe orchestrates AI coding agents — the machine running the **daemon** needs at least one agent CLI installed and signed in:

```bash
curl -fsSL https://claude.ai/install.sh | bash    # Claude Code
npm install -g @openai/codex                      # Codex — or: brew install --cask codex
```

For remote access via tunnel: the **desktop app** needs [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed (`brew install cloudflared`); the **standalone daemon** bundles it — nothing to install.

### Desktop app

Download the latest release for your platform from [GitHub Releases](https://github.com/qlan-ro/mainframe/releases). The daemon runs inside the app — no separate install. For remote/mobile access, enable the tunnel in **Settings → Tunnel**.

### Standalone daemon

For servers, headless use, or building on the API:

```bash
curl -fsSL https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash
mainframe-daemon
```

That's the whole quick start. For running it as a systemd service, prerequisites in detail, and troubleshooting, see **[Running the Daemon](docs/guides/running-the-daemon.md)**. To expose it for remote clients, see **[Cloudflare Tunnel Setup](docs/guides/cloudflare-tunnel.md)**.

### Connecting clients to a daemon

Every client pairs the same way: the daemon shows a short-lived pairing code, you enter it in the client, and the daemon issues that device a token.

| Client | Start pairing in | Get the code from |
|---|---|---|
| **Mobile app** — publishing soon; ping me to join TestFlight | Tap **Connect**, scan the QR or type the code | Desktop: **Settings → Devices → Pair New Device**. Headless: `mainframe-daemon pair` |
| **Desktop app → remote daemon** *(new)* | Sidebar daemon picker → **Add remote daemon** → paste the daemon's tunnel URL → enter the code | Same as above, on the remote daemon |

Pairing over the internet requires a tunnel on the daemon's machine — and remote daemons need a **named** tunnel (a quick tunnel's URL changes on restart, which breaks the pairing). See the [tunnel guide](docs/guides/cloudflare-tunnel.md).

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, package breakdown |
| [Running the Daemon](docs/guides/running-the-daemon.md) | Standalone install, prerequisites, systemd service |
| [Cloudflare Tunnel Setup](docs/guides/cloudflare-tunnel.md) | Remote access: quick vs named tunnels, troubleshooting |
| [API Reference](docs/API-REFERENCE.md) | HTTP and WebSocket API for the daemon |
| [Developer Guide](docs/DEVELOPER-GUIDE.md) | Setup, workflow, monorepo conventions, configuration |
| [Contributing](CONTRIBUTING.md) | How to contribute, code standards, PR process |

## Development

```bash
git clone https://github.com/qlan-ro/mainframe.git
cd mainframe
pnpm install && pnpm build && pnpm dev
```

See the [Developer Guide](docs/DEVELOPER-GUIDE.md) for full setup, monorepo conventions, and environment variables (env vars override `~/.mainframe/config.json`, which overrides defaults).

## Plugin System

Ideally Mainframe should be easily extended. Plugins can add UI panels, listen to daemon events, expose HTTP endpoints, and even register new AI CLI adapters. But for now this is basically just an idea with a basic implementation. Probably needs to be revisited, better architecture. When I'll have time :)

**What ships built-in:**

- **Claude adapter** — the Claude Code integration is itself a plugin
- **Task board** — the kanban task manager is a plugin with its own database, attachment storage, and fullview panel

**Build your own:** Write a `manifest.json` declaring your capabilities, export an `activate()` function in `index.js`, and drop it in `~/.mainframe/plugins/`. The daemon loads it on startup.

See the [Plugin Developer Guide](docs/PLUGIN-DEVELOPER-GUIDE.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests go in [GitHub Issues](https://github.com/qlan-ro/mainframe/issues).

## License

[MIT](LICENSE) — © 2026 Mainframe Contributors
