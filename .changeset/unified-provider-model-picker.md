---
"@qlan-ro/mainframe-app-tauri": minor
---

Unified provider + model picker in the composer. One trigger opens a popover with a
PROVIDER segmented row (every registered adapter; uninstalled ones shown locked,
the whole row locked once the thread has messages) and a "<provider> MODELS" list
(model label + description, a "· default" marker, a check on the current model).
Replaces the two separate AdapterSelect + ModelSelect controls. Selection writes
through PATCH /config (server-authoritative; no assistant-ui ModelContext, which is
inert under our external-store runtime).
