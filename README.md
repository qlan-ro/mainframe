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

Mainframe is an open-source desktop app that brings all your AI coding agents into one interface. Instead of juggling terminal windows, switching between your IDE and CLI, and losing track of what each agent is doing across projects — Mainframe gives you a single place to manage it all.

AI CLI tools are powerful, but they live in the terminal. Mainframe adds the layer terminals can't: visual file editing, live sandbox previews, task management, cross-project session history, and a mobile companion for working on the go.

> **One person, weekends, lots of coffee.** I poke at this when the mood strikes, ship what I feel like shipping, and change my mind a lot. The roadmap is a sticky note. If you're here this early, welcome to the construction site — bring a hard hat.
>
> **Work in progress.** Mainframe is under active development — some features are incomplete and the mobile companion app is not yet published. Currently focusing on fixing any annoying bugs.
>
> **Windows and Linux** Apps not tested at all, I am open to help with any initial issues found, but not my focus at all for now
>
> **HELP NEEDED** UI/UX experts contributions are a blessing, I'm not the best guy for building UIs

## Features

- **Unified provider interface** — One app for Claude, Codex, and potentially other AI coding agents — switch providers without changing your workflow
- **Multi-project session management** — Run sessions across multiple projects with instant context switching and full session history
- **In-app file editing** — View and edit files, diffs, and code directly in Mainframe without switching to your IDE
- **Sandbox preview** — Launch dev servers and preview your app with a built-in browser and inspector for adding precise context
- **Task management** — Integrated kanban board to track agent work and your own todos alongside sessions
- **Content referencing** — @-mention files, add context on diff viewer, add context from the file editor, to give agents exactly the context they need
- **AI tools management - WIP** — Makes sure your project is AI ready. Handling Subagents, Skills, MCPs, context files.
- **Mobile companion** — Monitor and interact with your sessions from your phone — review, approve, and respond on the go
- **Extensible plugin system - WIP** — Add UI panels, databases, event listeners, and new AI adapters through a capability-based plugin API
- **API-first daemon** — Run the daemon standalone and build your own UI, integrations, or automations on top of its HTTP and WebSocket API

## Getting Started

### Desktop App

Download the latest release for your platform from [GitHub Releases](https://github.com/qlan-ro/mainframe/releases).

### Daemon Only

Install the standalone daemon if you want to run it headless or build your own interface:

```bash
curl -fsSL https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash
```

### Remote Access to Mainframe Daemon (e.g. Mobile App)

The mobile companion app and any remote access require a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — a secure outbound connection from your machine to Cloudflare's edge, so you don't need to open ports or configure a firewall.

- **Desktop app:** Enable the tunnel from **Settings → Tunnel**.
- **Standalone daemon:** Set `TUNNEL=true` when starting the daemon, or configure it in `~/.mainframe/config.json`.

See the [Cloudflare Tunnel guide](docs/guides/cloudflare-tunnel.md) for named tunnels with a persistent URL, self-managed setups, and troubleshooting.

### Mobile Companion App - Publishing soon, if you want to join TestFlight testing I would be really happy to help you join

**Pairing with your desktop:**

1. Open the desktop app and go to **Settings → Devices → Pair New Device**
2. A pairing code (and QR code) appears on screen
3. Open the mobile app, tap **Connect**, and scan the QR code or enter the code manually
4. The daemon issues a token — your phone is now paired and can send messages, respond to permissions, and receive push notifications

**Pairing from the CLI (headless/daemon-only):**

```bash
mainframe-daemon pair
```

This prints a pairing code to the terminal. Enter it in the mobile app to complete pairing.

### Prerequisites

Mainframe orchestrates AI coding agents — you'll need at least one installed:

- [Claude CLI](https://claude.ai/code) (requires a Claude account)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (optional — only needed for remote/mobile access via tunnel)

## Development

See the [Developer Guide](docs/DEVELOPER-GUIDE.md) for full setup instructions.

```bash
git clone https://github.com/qlan-ro/mainframe.git
cd mainframe
pnpm install && pnpm build && pnpm dev
```

### Configuration

Env vars override `~/.mainframe/config.json`, which overrides defaults.

See the [Developer Guide](docs/DEVELOPER-GUIDE.md#environment-variables) for details.

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, package breakdown |
| [API Reference](docs/API-REFERENCE.md) | HTTP and WebSocket API for the daemon |
| [Developer Guide](docs/DEVELOPER-GUIDE.md) | Setup, workflow, monorepo conventions |
| [Contributing](CONTRIBUTING.md) | How to contribute, code standards, PR process |

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
