---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix presentation-layer review findings in the Settings feature. The Provider and Remote Access
panes used desktop-only `mf-*` design tokens (e.g. `mf-text-primary`, `mf-input-bg`, `mf-accent`,
`mf-divider`, `mf-hover`) plus raw color literals that don't exist in app-tauri's `globals.css`, so
Tailwind silently dropped them and the panes rendered unstyled — now translated to the real theme
contract (`foreground`/`muted-foreground`, `card`/`popover`, `primary`, `border`, `accent`,
`destructive`, `mf-warning`/`mf-success`, named type-scale tokens). Replaced the hand-rolled
`ModelDropdown` (document `mousedown` click-outside listener) with the shadcn `DropdownMenu`, and
swapped the raw `<input type=checkbox/radio>` / `<select>` controls in `ProviderConfigForm`,
`ProviderTuningDefaults`, `CodexTuningDefaults`, and `SessionModeRadio` for the shadcn
`Switch`/`Select`/`RadioGroup` primitives (dropping the `marginTop` calc hack). Also removed the
dead `PROVIDER_COLORS`/`PROVIDER_BORDER_COLORS` maps and added a clipboard-failure log to
`CopyButton`. All `data-testid`s and behavior preserved.
