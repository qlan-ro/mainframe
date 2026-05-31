---
'@qlan-ro/mainframe-core': patch
---

Copy-paste consolidation in core (behavior-preserving):

- `PluginManager`: extract the shared router-mount + `buildPluginContext` block from `loadBuiltin` and `loadPlugin` into a private `buildPluginRuntime` helper. The two paths still differ only in how they obtain the manifest and activate function; ordering and side effects are unchanged.
- `ChatConfigManager`: extract `requireActiveChat` (getActiveChat + throw), `detachSession` (kill spawned session + null), and `applyWorktreeUpdate` (set path/branch + db update + emit) helpers, removing the same blocks copy-pasted across `updateChatConfig`/`enableWorktree`/`attachWorktree`/`disableWorktree`.
- `ClaudeSession`: extract a `buildControlRequest` helper that owns the control_request envelope and a single `nanoid` request-id generator, replacing seven hand-rolled payloads that mixed `crypto.randomUUID` and `nanoid`.
