# Plugin System — Architecture Design

**Date:** 2026-02-22
**Status:** Draft
**Scope:** Plugin system for OSS core (prerequisite for Workflows and all future extensions)

---

## 0. Context

This document designs the plugin system that will be added to the OSS core. It supersedes
the permissive "harden later" model described in `2026-02-18-workflows-design.md § 2`
and replaces it with a **capability-declaration + user-consent** model.

Three incomplete plans must execute first as prerequisites — they are addressed in
§ 10 (Prerequisite Refactors). The plugin system design here assumes those are done.

---

## 1. Vision

The plugin system lets external code extend the daemon with new routes, database
tables, background workers, and UI panels — without touching the OSS core. Every
extension ships as a plugin:

| Extension type | Example plugins |
|---|---|
| CLI adapter | `plugin-claude`, `plugin-gemini`, `plugin-codex` |
| Core feature (daemon + UI) | `plugin-workflows`, `plugin-todos` |
| Utility (daemon only) | `plugin-webhooks`, `plugin-metrics` |
| UI extension only | `plugin-custom-theme` |
| Sandbox | `plugin-sandbox` (launch + preview apps) |

The Claude CLI adapter ships today as hardcoded core. After this system, it becomes
a **bundled built-in plugin** — always present, but following the same contract as any
third-party adapter plugin.

---

## 2. Security Model

### 2.1 Threat Model

Plugins execute on the user's machine with the daemon's Node.js privileges. A
malicious (or supply-chain-compromised) plugin could:

1. **Prompt injection** — silently append instructions to an ongoing AI conversation
2. **Permission interception** — auto-allow all permission requests
3. **Conversation snooping** — read sensitive messages from all chats
4. **Process execution** — spawn arbitrary child processes (malware, crypto miners)
5. **Data exfiltration** — leak conversation history to a remote server

### 2.2 Primary Defense: Capability-Declaration + User Consent

Every plugin declares capabilities in its manifest. Before the plugin is loaded for
the first time, the user sees a consent dialog listing each capability with a risk
label. The plugin only receives access to capabilities the user explicitly approved.
This is the **primary and sufficient** security control.

Attempting to use an undeclared or unapproved capability throws immediately at
runtime — so a plugin that declares `chat:read` but not `chat:write` simply has no
`sendMessage()` function available. There is no way to silently escalate.

Because the user is the decision-maker, there are no architectural bans. If a user
approves `chat:write` for a plugin — knowing it can send messages to their AI sessions
— that is a conscious, informed choice. The consent UI makes the implications clear.

### 2.3 Install-Time Consent Flow

```
User installs plugin (drops directory into ~/.mainframe/plugins/)
  ↓
Daemon detects new plugin directory on next start (or manual reload)
  ↓
Daemon reads & validates manifest.json
  If invalid → log warning, skip plugin, never show consent dialog
  If valid   → send WS event to desktop: 'plugin.consent.required'
  ↓
Desktop shows consent dialog:

  ┌─────────────────────────────────────────────────────┐
  │  Plugin "Workflows" v2.1.0 by Mainframe Team        │
  │  "Durable AI workflow automation"                   │
  │                                                     │
  │  This plugin is requesting access to:               │
  │                                                     │
  │  ✅ Storage            — Store data in a local DB   │
  │  ✅ UI Panels          — Add panels to the sidebar  │
  │  ⚠️  Read messages      — Read your chat history    │
  │  ⚠️  Create AI sessions — Start new AI conversations│
  │  🔴 Send AI messages   — Send to your AI sessions   │
  │  🔴 Run processes      — Execute programs           │
  │                                                     │
  │  [Decline]   [Allow selected ▾]   [Allow all]       │
  └─────────────────────────────────────────────────────┘

  ↓
User approves (all or selected subset)
  ↓
Consent stored in settings:
  { pluginId, approvedCapabilities: [...], consentDate, version }
  ↓
PluginManager loads plugin, builds PluginContext with APPROVED capabilities only
```

If the user approves only a subset, the plugin context exposes only those APIs.
The plugin should degrade gracefully when optional capabilities are missing — it can
check `ctx.manifest.approvedCapabilities` to know what it actually received.

If the plugin version changes (new minor/patch: auto-reuse consent; major bump or
new capabilities added: prompt again), the consent dialog reopens.

Builtin plugins (Claude adapter) bypass consent — they are part of the core and
ship with the app.

### 2.4 Secondary Defenses (defense in depth)

**Route namespace isolation** — Plugin routes mount only under `/api/plugins/{id}/`.
The scoped router rejects path traversal attempts at mount time (Zod validation).

**DB isolation** — Each plugin gets its own SQLite file. Cross-plugin or cross-core
DB access is impossible at the file system level, not just by convention.

**Event bus filtering** — Without `chat:events`, the event bus only delivers
sanitized metadata (chat.started, chat.completed, etc. — no content). Plugins do
not see raw adapter events unless they've declared and been approved for `chat:events`.

**Permission pipeline is never exposed** — No capability grants access to the
permission handler. A plugin cannot intercept or auto-approve tool permissions.

---

## 3. Plugin Capabilities Reference

### Implicit capability (no declaration, no consent needed)

Every loaded plugin automatically receives **public daemon events** — coarse-grained
lifecycle metadata with no message content (session started, completed, errored;
project added/removed). This is equivalent to what is already visible in the session
list UI. Since passing the consent dialog already implies the plugin is loaded and
trusted for its declared capabilities, requiring an additional consent step for data
that is already on screen has no value.

`ctx.events.onDaemonEvent()` is therefore **always available** to any loaded plugin.
The event bus still has two tiers internally (public metadata vs. full content), so
the `chat:events` gate remains meaningful — but the low tier is implicit.

### Declared capabilities (shown in consent dialog)

```typescript
type PluginCapability =
  // ── Storage ──────────────────────────────────────────────────────────── ✅
  | 'storage'             // own SQLite file at ~/.mainframe/plugins/{id}/data.db

  // ── UI contributions ─────────────────────────────────────────────────── ✅
  | 'ui:panels'           // register sidebar panels
  | 'ui:notifications'    // emit toast notifications

  // ── Chat access ──────────────────────────────────────────────────────── ⚠️/🔴
  | 'chat:read'           // list chats + metadata (no message text)
  | 'chat:read:content'   // additionally: read full message text and tool calls
  | 'chat:create'         // start new plugin-attributed AI chat sessions
  | 'chat:write'          // send messages to existing chats (including user's)
  | 'chat:events'         // receive real-time message + tool events (full content)

  // ── Adapter registration ─────────────────────────────────────────────── 🔴
  | 'adapters'            // register a CLI provider into the AdapterRegistry

  // ── Process execution ────────────────────────────────────────────────── 🔴
  | 'process:exec'        // spawn child processes (adapter plugins only)

  // ── Network ──────────────────────────────────────────────────────────── ⚠️
  | 'http:outbound';      // make outbound HTTP requests (license servers, webhooks)
```

### Capability risk levels for consent dialog

| Capability | Risk | Dialog label | Description shown to user |
|---|---|---|---|
| `storage` | ✅ Low | Store data | Keeps data in an isolated local database |
| `ui:panels` | ✅ Low | Show UI panels | Adds panels to the app sidebar |
| `ui:notifications` | ✅ Low | Show notifications | Displays toast notifications |
| `chat:read` | ✅ Low | List chats | Sees your chat list and metadata (no message text) |
| `chat:read:content` | ⚠️ Medium | Read messages | Can read the full text of your AI conversations |
| `chat:create` | ⚠️ Medium | Create AI sessions | Can start new AI sessions on your behalf |
| `http:outbound` | ⚠️ Medium | Make network requests | Can contact external servers |
| `chat:write` | 🔴 High | Send AI messages | Can send messages into your AI sessions |
| `chat:events` | 🔴 High | Stream conversations | Receives every message in real-time as it streams |
| `adapters` | 🔴 High | Register AI provider | Registers a new CLI as an AI provider |
| `process:exec` | 🔴 High | Run processes | Can spawn programs on your machine |

---

## 4. Plugin Manifest

```jsonc
{
  "id": "workflows",         // must match ^[a-z][a-z0-9-]*$
  "name": "Workflows",
  "version": "2.1.0",
  "description": "Durable AI workflow automation",
  "author": "Mainframe Team",
  "license": "MIT",

  // Declared capabilities — shown in consent dialog, enforced at runtime
  "capabilities": [
    "storage",
    "ui:panels",
    "chat:read:content",     // need to read outputs of AI steps
    "chat:create",           // create sessions for prompt steps
    "http:outbound"          // license validation
  ],

  // Adapter plugins only: declare the CLI binary
  "adapter": {
    "binaryName": "gemini",
    "displayName": "Gemini CLI"
  }
}
```

Manifest is validated with a Zod schema at load time. Invalid manifests cause the
plugin to be skipped — never a crash, always a log warning.

---

## 5. Plugin Directory Structure

### 5.1 User-installed plugins

```
~/.mainframe/plugins/
  workflows/
    manifest.json        ← Zod-validated
    index.js             ← CommonJS: exports activate(ctx)
    ui.mjs               ← ESM: exports { PanelComponent }
    node_modules/        ← plugin's own deps
```

### 5.2 Project-local plugins (scoped to one project)

```
<project>/.mainframe/plugins/
  my-custom-tool/
    manifest.json
    index.js
```

Project-local plugins can only access that project via `projectService`.

### 5.3 Bundled built-in plugins (shipped with core)

```
packages/core/src/plugins/builtin/
  claude/              ← ClaudeAdapter as a plugin (always loaded, not user-removable)
    manifest.json
    index.ts
```

Builtin plugins bypass the consent dialog — they ship with the app and are implicitly
trusted. They still use the same `PluginContext` API to validate the design.

---

## 6. PluginContext API

Full interface annotated with required capability:

```typescript
interface PluginContext {
  readonly manifest: PluginManifest;

  /** Pino child logger — prefixed [plugin:{id}] */
  readonly logger: Logger;

  /** List of capabilities the user actually approved (may be subset of manifest) */
  readonly approvedCapabilities: PluginCapability[];

  /** Check if a capability was approved */
  hasCapability(cap: PluginCapability): boolean;

  /** Register cleanup to run on unload/daemon shutdown */
  onUnload(fn: () => void): void;

  // ─── Routes — always available ────────────────────────────────────────────
  readonly router: Router;       // mounted at /api/plugins/{id}/

  // ─── Config — always available ────────────────────────────────────────────
  readonly config: PluginConfig; // key-value, stored in core settings table

  // ─── Services — always available, shaped by approved capabilities ─────────
  readonly services: {
    chats: ChatServiceAPI;
    projects: ProjectServiceAPI;
  };

  // ─── Storage — requires 'storage' ─────────────────────────────────────────
  readonly db: PluginDatabaseContext;

  // ─── Events — always available; onChatEvent requires 'chat:events' ────────
  readonly events: PluginEventBus;

  // ─── UI — requires 'ui:panels' or 'ui:notifications' ─────────────────────
  readonly ui: PluginUIContext;

  // ─── Adapters — requires 'adapters' ───────────────────────────────────────
  readonly adapters?: AdapterRegistrationAPI;
}
```

### 6.1 PluginDatabaseContext

```typescript
interface PluginDatabaseContext {
  runMigration(sql: string): void;
  prepare<T = Record<string, unknown>>(sql: string): PluginStatement<T>;
  transaction<T>(fn: () => T): T;
}
```

SQL executes against the plugin's own SQLite file. Core DB is unreachable.

### 6.2 PluginEventBus

```typescript
interface PluginEventBus {
  // Plugin-scoped pub/sub — always available
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void): void;

  // Always available — lifecycle metadata only, no message content
  // (equivalent to what's visible in the session list UI)
  onDaemonEvent(event: PublicDaemonEventName, handler: (e: PublicDaemonEvent) => void): void;

  // Requires 'chat:events' approval — full message content, real-time streaming
  onChatEvent(event: ChatEventName, handler: (e: ChatEvent) => void): void;
}

type PublicDaemonEventName =
  | 'chat.started'      // { chatId, projectId, adapterId }
  | 'chat.completed'    // { chatId, projectId, cost, durationMs }
  | 'chat.error'        // { chatId, projectId, errorMessage }
  | 'project.added'     // { projectId, path }
  | 'project.removed';  // { projectId }

// Only available with 'chat:events' approval
type ChatEventName =
  | 'message.added'     // { chatId, message: ChatMessage }
  | 'message.streaming' // { chatId, messageId, delta: string }
  | 'tool.called'       // { chatId, toolName, args }
  | 'tool.result';      // { chatId, toolUseId, content }
```

### 6.3 ChatServiceAPI

The shape of this object depends on approved capabilities. The factory builds it
once at plugin load time with only the methods the plugin is approved for.

```typescript
interface ChatServiceAPI {
  // Always available
  listChats(projectId: string): Promise<ChatSummary[]>;
  getChatById(chatId: string): Promise<ChatSummary | null>;

  // Requires 'chat:read:content'
  getMessages?(chatId: string): Promise<ChatMessage[]>;

  // Requires 'chat:create'
  createChat?(options: {
    projectId: string;
    adapterId?: string;
    model?: string;
    initialMessage?: string;
  }): Promise<{ chatId: string }>;

  // Requires 'chat:write'
  // Sends a message to ANY chat, including user-opened ones.
  // User consented to this explicitly. Plugin-sent messages are
  // flagged source:'plugin:{id}' in the DB and shown distinctly in UI.
  sendMessage?(chatId: string, message: string): Promise<void>;
}
```

### 6.4 AdapterRegistrationAPI

```typescript
// Only available when 'adapters' is approved
interface AdapterRegistrationAPI {
  register(adapter: Adapter): void;
}
```

---

## 7. Plugin Lifecycle

```
Daemon start
  ↓
PluginManager.loadAll()
  ├── Always: load builtins (claude, ...)
  ├── Scan ~/.mainframe/plugins/*/manifest.json
  └── Scan <open-projects>/.mainframe/plugins/*/manifest.json

For each discovered plugin:
  1. Validate manifest.json (Zod) → skip on error
  2. Load stored consent from settings
     a. NEW plugin (no stored consent):
        → Emit WS 'plugin.consent.required' to desktop
        → Desktop shows consent dialog
        → User approves/declines capabilities
        → Consent saved to settings
        → If declined: plugin stays on disk but is not loaded
     b. KNOWN plugin, version unchanged: use stored consent
     c. KNOWN plugin, major version bump or new capabilities: re-prompt
  3. Build PluginContext with APPROVED capabilities only
  4. require(index.js) → call activate(ctx)
  5. Plugin registers routes, migrations, panels, adapters
  6. DB migrations run synchronously
  7. Plugin live

Daemon stop / unload:
  1. Call onUnload() handlers
  2. Unmount plugin routes
  3. Unregister panels (WS event to desktop)
  4. Close plugin DB connection
```

---

## 8. Adapter Plugin Pattern

```typescript
// A hypothetical Gemini CLI adapter plugin
import type { PluginContext } from '@mainframe/types';
import { GeminiAdapter } from './gemini-adapter.js';

export function activate(ctx: PluginContext): void {
  const adapter = new GeminiAdapter(ctx.logger);
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
}
```

`GeminiAdapter` implements the `Adapter` interface (post adapter-session-refactor):

```typescript
class GeminiAdapter implements Adapter {
  id = 'gemini';
  name = 'Gemini CLI';

  async isInstalled(): Promise<boolean> { /* ... */ }
  async getVersion(): Promise<string | null> { /* ... */ }
  createSession(options: SessionOptions): AdapterSession { /* ... */ }
  killAll(): void { /* ... */ }
}
```

### 8.1 Claude as a Bundled Plugin

```
packages/core/src/plugins/builtin/claude/
  manifest.json     { "id": "claude", "capabilities": ["adapters", "process:exec"] }
  index.ts          activate(ctx) { ctx.adapters.register(new ClaudeAdapter()); }
```

Always loaded, no consent dialog, not user-removable.

---

## 9. UI Plugin Architecture

### 9.1 Panel Registration

```
Daemon → Desktop WS events:
  plugin.consent.required   { pluginId, name, version, capabilities }
  plugin.consent.stored     { pluginId, approvedCapabilities }
  plugin.panel.registered   { pluginId, panelId, label, icon, position, entryPoint }
  plugin.panel.unregistered { pluginId, panelId }
  plugin.notification       { pluginId, title, body, level }
```

### 9.2 Desktop Rendering

```tsx
const PluginPanel = ({ pluginId, entryPoint }: Props) => {
  const PanelComponent = usePluginComponent(entryPoint);
  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Suspense fallback={<PluginLoading />}>
        <PanelComponent api={buildPluginPanelAPI(pluginId)} />
      </Suspense>
    </ErrorBoundary>
  );
};
```

Plugin UI components communicate with the daemon only via `api.fetch()` (scoped to
`/api/plugins/{id}/`) and `api.onEvent()` (scoped WS events). They cannot import
from `@mainframe/core` or access the main Zustand store.

### 9.3 Consent Dialog Component (Desktop)

A new modal component `PluginConsentDialog.tsx` renders when `plugin.consent.required`
arrives over WS. It:

- Lists capabilities with their risk level icon and plain-English description
- Allows per-capability toggle for "Allow selected" flow
- Sends `POST /api/plugins/{id}/consent { approvedCapabilities }` to daemon
- Daemon stores consent and proceeds with `activate()`

---

## 10. Prerequisite Refactors

These three existing plans MUST complete before plugin system implementation begins:

### 10.1 — Unified Event Pipeline (priority 1, ~2h)
**Plan:** `docs/plans/2026-02-17-unified-event-pipeline.md`

Extract `buildToolResultBlocks` shared helper to eliminate duplicate tool_result
construction between live stream and history replay. Adds cross-path parity test.

### 10.2 — Adapter Event Handlers (priority 2, ~4h)
**Plan:** `docs/plans/2026-02-17-adapter-event-handlers-plan.md`

- `ToolCategories` type; parameterize categorization functions
- Extract `ClaudeEventHandler`; make `EventHandler` an orchestrator
- Move `extractPlanFiles()` / `extractSkillFiles()` to `Adapter` interface
- Remove all `instanceof ClaudeAdapter` from core

No longer deferred — prerequisite for adapter plugins.

### 10.3 — Adapter Session Refactor (priority 3, ~1 day)
**Plan:** `docs/plans/2026-02-17-adapter-session-refactor.md`

Split `ClaudeAdapter` into `Adapter` (provider-level) + `AdapterSession` (session-level).
Eliminates `processToChat` Map, `ChatLookup` interface, `instanceof` casts.

Elevated to required because `ctx.adapters.register(adapter)` depends on `Adapter.createSession()`.

---

## 11. File Map

### New in `@mainframe/types/src/`
```
plugin.ts     — all plugin types: manifest, capabilities, context, sub-APIs, events
```

### New in `@mainframe/core/src/plugins/`
```
manager.ts                   — PluginManager: discovery, consent flow, lifecycle
context.ts                   — buildPluginContext() with capability gating
event-bus.ts                 — ScopedEventBus (public + chat:events tiers)
db-context.ts                — isolated SQLite per plugin
ui-context.ts                — panel registration + WS emission
config-context.ts            — settings table wrapper
security/
  manifest-validator.ts      — Zod manifest schema
  consent-store.ts           — read/write consent from settings
services/
  chat-service.ts            — ChatServiceAPI (capability-shaped)
  project-service.ts         — ProjectServiceAPI
  adapter-service.ts         — AdapterRegistrationAPI
builtin/
  claude/
    manifest.json
    index.ts
```

### New in `@mainframe/core/src/server/routes/`
```
plugins.ts     — GET /api/plugins, GET /api/plugins/:id, POST /api/plugins/:id/consent
```

### New in `@mainframe/desktop/src/renderer/`
```
components/plugins/
  PluginConsentDialog.tsx   — install-time consent UI
  PluginPanel.tsx           — dynamic panel with ErrorBoundary + Suspense
  PluginError.tsx
  PluginLoading.tsx
hooks/
  usePluginComponent.ts
store/
  plugins.ts                — panel registry + pending-consent list
```

### Modified
```
packages/types/src/index.ts           — export plugin types
packages/types/src/events.ts          — add plugin WS event types
packages/core/src/index.ts            — initialize PluginManager
packages/core/src/server/http.ts      — mount plugin routes
packages/core/src/server/websocket.ts — emit plugin WS events
packages/desktop/src/renderer/
  components/Layout.tsx               — render plugin panels + consent dialog
  store/index.ts                      — add plugins store
```

---

## 12. Open Questions / Decisions Deferred

| Question | Deferred until |
|---|---|
| Plugin hot-reload without daemon restart | v2 |
| Plugin marketplace / discovery UX | After first 3rd-party plugin exists |
| Plugin signing / code integrity | When distributing from untrusted sources |
| Inter-plugin communication (A subscribes to B's events) | When a use case arises |
| Sandboxed `<webview>` for plugin UI (stronger isolation) | If in-tree loading causes issues |
| Plugin auto-update mechanism | After initial install flow |
| Revoking consent after install | After basic consent flow ships |
