---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
---

Stable mobile device identity (UUID generated on the phone, persisted in SecureStore) eliminates duplicate paired-device rows on re-pair. Tokens are now bound to a per-device `auth_epoch` counter so device removal and re-pairing actually invalidate old tokens. WebSocket upgrade and `/api/auth/status` route through the same `validateAuthedToken` check. `/api/auth/register-push` now requires a matching bearer; deleting a device also unregisters its push token. Adds `GET /api/auth/pair-status?code=…` so the CLI can detect re-pairs (same `deviceId`, no new device row). Pair-code entry on mobile is now an OTP-style 6-box input that auto-submits.

Fixes #148, #156.
