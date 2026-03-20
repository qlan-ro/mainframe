# Cloudflare Tunnel Setup

Mainframe uses a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose the daemon over the internet — required for the mobile companion app and any remote access. The tunnel creates a secure outbound connection from your machine to Cloudflare's edge, so you don't need to open ports or configure a firewall.

## Prerequisites

Install `cloudflared` on the machine running the daemon:

- **macOS:** `brew install cloudflared`
- **Linux:** see [Cloudflare downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- **Windows:** download from the same page

## Option 1: Let the daemon manage the tunnel

The simplest approach. The daemon spawns `cloudflared` as a child process and tears it down on exit.

### Quick tunnel (anonymous)

No Cloudflare account needed. The URL changes on every restart.

```bash
TUNNEL=true mainframe-daemon
```

Or in the desktop app: **Settings → Tunnel → Enable**.

The daemon starts a [quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) and prints the assigned `*.trycloudflare.com` URL to the log.

### Named tunnel (persistent URL)

Requires a Cloudflare account and a domain managed by Cloudflare.

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels → **Create a tunnel**
2. Choose **Cloudflared** connector, give the tunnel a name
3. Copy the tunnel **token** (shown in the install command)
4. Add a **public hostname** (e.g. `mainframe.example.com`) pointing to `http://localhost:31415`
5. Start the daemon with the token and URL:

```bash
TUNNEL=true TUNNEL_TOKEN=<TOKEN> TUNNEL_URL=https://mainframe.example.com mainframe-daemon
```

Or configure once and forget:

```json
// ~/.mainframe/config.json
{
  "tunnel": true,
  "tunnelToken": "<TOKEN>",
  "tunnelUrl": "https://mainframe.example.com"
}
```

The URL stays the same across restarts.

## Option 2: Run `cloudflared` yourself

If you prefer to manage the tunnel process independently — for example, running it as a systemd service or in a separate terminal — skip the `TUNNEL=true` flag and just tell the daemon where the tunnel points:

```bash
# Terminal 1: run the named tunnel yourself
cloudflared tunnel run --token <TOKEN>

# Terminal 2: start the daemon with the known URL
TUNNEL_URL=https://mainframe.example.com mainframe-daemon
```

In this mode the daemon does not spawn or stop `cloudflared`. It uses the URL for mobile pairing and push notifications.

## Runtime API

You can also start and stop the tunnel at runtime via the daemon's HTTP API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/tunnel/status` | Current state: running, URL, health |
| `POST /api/tunnel/start` | Start tunnel (optionally with `{ token, url }` for named mode) |
| `POST /api/tunnel/stop` | Stop tunnel (optionally `{ clearConfig: true }` to wipe saved credentials) |

## Troubleshooting

- **`cloudflared` not found:** Make sure the binary is on your `PATH`. Run `cloudflared version` to verify.
- **Tunnel starts but mobile can't connect:** DNS propagation can take a few seconds. The daemon waits up to 15 seconds for DNS to resolve. Check the logs for warnings.
- **Named tunnel URL not reachable:** Verify the public hostname in the Cloudflare dashboard points to `http://localhost:31415` (or your configured `DAEMON_PORT`).
