---
'@qlan-ro/mainframe-core': patch
---

Copy-paste consolidation in core (behavior-preserving):

- `PluginManager`: extract the shared router-mount + `buildPluginContext` block from `loadBuiltin` and `loadPlugin` into a private `buildPluginRuntime` helper. The two paths still differ only in how they obtain the manifest and activate function; ordering and side effects are unchanged.
