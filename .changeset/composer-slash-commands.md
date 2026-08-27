---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Slash commands are back in the composer.

Typing `/` listed only skills. The daemon had been serving its commands the whole time — `/launch-config` among them — but the renderer never asked for them: the Electron→Tauri rebuild carried over the daemon half of the feature and not the client half, so the endpoint answered into nothing.

`/` now lists commands above skills, marked with a wrench so they read as a different kind of thing, and picking one sends it as an invocation rather than as the literal text `/launch-config`. A command must be the whole message — `/launch-config for the api package` is sent as an ordinary message, because a command replaces the message with its own prompt and those extra words would be dropped without a trace.

Commands come from the daemon's registry, so a command added there appears in the composer with no further change here, and adapter-published commands will work the same way once they are re-enabled.
