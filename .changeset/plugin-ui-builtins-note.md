---
---

Document that builtin plugin UI is currently rendered from a hardcoded `BUILTIN_GLOBAL_COMPONENTS` map in the desktop shell, and that the backend already emits `plugin.panel.*`, `plugin.action.*`, and `plugin.notification` events that a future external-plugin loader will consume.
