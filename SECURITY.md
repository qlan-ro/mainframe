# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Mainframe, please
report it responsibly.

**Use GitHub's private vulnerability reporting:**
Go to the [Security tab](https://github.com/qlan-ro/mainframe/security/advisories/new)
and click "Report a vulnerability". This keeps the details private until a fix is available.

**What to expect:**
- Acknowledgment within 48 hours
- Status update within 7 days
- No public disclosure before a fix is released

## Scope

Mainframe runs as a local desktop application with no cloud components. The daemon
binds to localhost only and has no authentication by design — it is not intended
to be exposed to a network. Reports about the daemon being accessible over a network
are out of scope.

## Known Limitations

- The daemon API has no authentication. Do not expose port 31415 to a network.
- Electron's renderer process has Node.js integration disabled by default.
