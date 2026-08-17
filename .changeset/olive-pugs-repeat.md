---
'@qlan-ro/mainframe-app-tauri': minor
'@qlan-ro/mainframe-ui': minor
---

Generate chat titles on-device with Apple Intelligence

On a Mac with Apple Intelligence enabled, a new chat's title now comes from
Apple's on-device model instead of a one-shot Haiku call over the Claude CLI. It
costs no tokens, works offline, answers in about a second, and leaves no
throwaway session behind in the CLI's history.

The trade is quality: a 3B on-device model writes vaguer titles than Haiku and
occasionally mislabels a message that talks about instructions. Set
`general.titleGeneration.localDisabled` to `true` to keep the CLI titles.

Everywhere else — Intel Macs, macOS below 26, Apple Intelligence switched off,
Linux, or a build whose helper couldn't be compiled — titles are generated
exactly as before.
