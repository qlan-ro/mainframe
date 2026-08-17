---
'@qlan-ro/mainframe-app-tauri': minor
'@qlan-ro/mainframe-ui': minor
---

Generate chat titles on-device with Apple Intelligence

On a Mac with Apple Intelligence enabled, a new chat's title now comes from
Apple's on-device model instead of a one-shot Haiku call over the Claude CLI. It
costs no tokens, works offline, answers in about a second, and leaves no
throwaway session behind in the CLI's history.

Everywhere else — Intel Macs, macOS below 26, Apple Intelligence switched off,
Linux, or a build without the helper — titles are generated exactly as before.
Set `general.titleGeneration.localDisabled` to `true` to force the CLI path on a
machine that would otherwise use the on-device model.
