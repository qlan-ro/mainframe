---
'@qlan-ro/mainframe-ui': patch
---

Every http(s) link in the transcript now offers the same menu the localhost tunnel chip already had: open in Mainframe as a workspace URL tab, open in the external browser, and copy the link. Previously only a loopback URL on a tunnel-eligible port got the in-app open action — a link to any other host offered just copy and an external-browser open, with no way to load it inside the app. The in-app row only renders for an href that already carries an `http:`/`https:` scheme, so a `mailto:` link or a relative path keeps its narrower menu instead of gaining a broken action. Opening a remote URL this way never starts a port tunnel; that stays chip-only, alongside the tunnel status badge and stop control.
