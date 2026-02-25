# Workflows Feature Design

**Date:** 2026-02-18
**Status:** Approved
**Scope:** Plugin system (OSS) + Workflows premium plugin

---

## Overview

A workflow is a DAG of tasks that can be triggered manually, by webhook, on a cron schedule, or in response to daemon events. Each task is one of: a prompt sent to an AI agent, a tool invocation (bash, curl, fetch, file ops), a sub-workflow, or a human approval gate. Workflows are backed by Temporal.io for durable execution, retries, and cron scheduling.

The feature ships as two layers:

1. **Plugin system** — added to the OSS core. Lets any directory-based plugin extend the daemon with new routes, events, DB tables, and UI panels.
2. **Workflows plugin** — a premium plugin (license-key gated) that implements the workflow engine on top of the plugin system.

---

## 1. Workflow Definition (YAML DSL)

Workflows live in `.mainframe/workflows/` inside a project directory, or `~/.mainframe/workflows/` for global workflows. YAML is the source of truth; the visual editor generates and reads it.

### Example

```yaml
name: bug-report
description: Take a bug screenshot, produce a report, run tests, create a PR
version: "1.0"

triggers:
  - type: manual
  - type: webhook
    path: /webhooks/bug-report
    method: POST
  - type: cron
    schedule: "0 9 * * 1"
  - type: event
    on: workflow.completed
    workflow: nightly-tests

variables:
  TICKET_ID: ""
  SEVERITY: "medium"

steps:
  - id: capture-report
    name: "Generate bug report"
    type: prompt
    agent:
      adapterId: claude
      agentConfig: bug-analyst
      model: claude-opus-4-6
      permissionMode: plan
    prompt: |
      Analyse the attached image and produce a structured bug report.
      Ticket: {{ TICKET_ID }}
    inputs:
      - name: screenshot
        type: file
        required: true
    outputs:
      schema:
        type: object
        properties:
          title: { type: string }
          severity: { type: string, enum: [low, medium, high, critical] }
          steps_to_reproduce: { type: array, items: { type: string } }
        required: [title, severity, steps_to_reproduce]

  - id: run-tests
    name: "Run test suite"
    type: tool
    tool: bash
    command: "pnpm test"
    workdir: "{{ project.path }}"
    outputs:
      schema:
        type: object
        properties:
          exit_code: { type: integer }
          stdout: { type: string }

  - id: fix-bug
    name: "Fix identified bug"
    type: prompt
    depends_on: [capture-report, run-tests]
    condition: "{{ steps['run-tests'].outputs.exit_code != 0 }}"
    on_failure: continue
    agent:
      adapterId: claude
      permissionMode: acceptEdits
    prompt: |
      Bug report: {{ steps['capture-report'].outputs | json }}
      Test failures: {{ steps['run-tests'].outputs.stdout }}
      Fix the failing tests.

  - id: approve-pr
    name: "Approve PR creation"
    type: human_approval
    depends_on: [fix-bug]
    message: "PR ready. Branch: fix/{{ TICKET_ID }}. Approve?"
    timeout: 48h
    on_timeout: fail

  - id: create-pr
    name: "Create PR"
    type: workflow
    depends_on: [approve-pr]
    workflow: create-pull-request
    inputs:
      title: "Fix: {{ steps['capture-report'].outputs.title }}"
      branch: "fix/{{ TICKET_ID }}"
```

### Step Types

| Type | Description | Backed by |
|------|-------------|-----------|
| `prompt` | Send a prompt to an AI agent and wait for completion | `PromptStepHandler` → `ChatServiceAPI.createChat()` |
| `tool` | Run a shell command, HTTP request, or external service | `ToolActivity` → `StepHandlerRegistry.get(tool)` |
| `workflow` | Invoke another workflow as a sub-workflow | `SubworkflowStepHandler` → `SubworkflowActivity` |
| `human_approval` | Pause and wait for user approval | `HumanApprovalStepHandler` → Temporal Signal |

### Tool Types (for `type: tool`)

Each tool type is a `WorkflowStepHandler` registered in the plugin's internal
`StepHandlerRegistry` at `activate()` time. See § 3.2 for the handler interface.

| Tool | Handler class | Capability used |
|------|---------------|-----------------|
| `bash` | `BashStepHandler` | `process:exec` (runs via Temporal worker subprocess) |
| `http` / `fetch` | `HttpStepHandler` | `http:outbound` |
| `slack` | `SlackStepHandler` | `http:outbound` (Slack Web API) |
| `file_read` | `FileReadStepHandler` | — (local FS, no extra capability) |
| `file_write` | `FileWriteStepHandler` | — (local FS, no extra capability) |

### Interpolation

`{{ ... }}` is Mustache-style interpolation available in `prompt`, `command`, `message`, `condition`, and input mapping fields. Available variables:

- `{{ VARIABLE_NAME }}` — workflow-level variables
- `{{ steps['step-id'].outputs.field }}` — prior step outputs
- `{{ project.path }}` — active project path
- `{{ trigger.payload }}` — webhook/event trigger payload

### Failure Handling (per step)

```yaml
on_failure: continue | fail | retry | trigger
on_failure_trigger: other-step-id   # used when on_failure: trigger
```

---

## 2. Plugin System (OSS Core)

### Plugin Loading

The daemon scans `~/.mainframe/plugins/*/manifest.json` at startup. For each plugin:

1. Read `manifest.json` (id, name, version)
2. Build a `PluginContext` for the plugin
3. `require(plugin/index.js)` and call `activate(ctx)`
4. Plugin registers routes, events, DB migrations, UI panels
5. DB migrations run synchronously at startup via `better-sqlite3`

### PluginContext API

```typescript
interface PluginContext {
  router: PluginRouter;        // registers routes under /api/plugins/:pluginId/
  events: PluginEventBus;      // emit() and on() scoped to this plugin
  db: PluginDatabaseContext;   // runMigration(), query(), transaction()
  ui: PluginUIContext;         // addPanel(), addNotification()
  config: PluginConfig;        // get(key), set(key, value) — stored in settings table
  services: {
    chats: ChatServiceAPI;     // read chats, create chats
    projects: ProjectServiceAPI;
  };
  logger: Logger;              // pino child logger
  onUnload(fn: () => void): void;
}
```

Permissive model: plugins receive the full `PluginContext` with no permission gating. To be hardened in a future iteration if needed.

### New Files in `@mainframe/core`

```
src/plugins/
  plugin-manager.ts      # discovers, loads, unloads plugins
  plugin-context.ts      # builds PluginContext per plugin
  plugin-router.ts       # scoped Express router wrapper
  plugin-event-bus.ts    # scoped EventEmitter wrapper
  plugin-db-context.ts   # migration + query API
  plugin-ui-context.ts   # collects UI contributions, sends via IPC
```

### Plugin Manifest

```json
{
  "id": "workflows",
  "name": "Workflows",
  "version": "1.0.0"
}
```

---

## 3. Workflows Plugin Architecture

### Plugin Directory

```
~/.mainframe/plugins/workflows/
  manifest.json
  index.js               # activate(ctx) entry point
  worker.js              # Temporal worker + activities
  ui.js                  # React component bundle
  node_modules/          # @temporalio/client, @temporalio/worker, etc.
```

### Source Structure (in monorepo before bundling)

```
packages/plugin-workflows/
  src/
    activate.ts                 # registers step handlers, starts worker, mounts routes
    license.ts                  # license key validation
    workflow-loader.ts          # discovers YAML files in projects
    workflow-registry.ts        # in-memory + DB cache
    workflow-manager.ts         # trigger, cancel, query runs
    steps/
      handler.ts                # WorkflowStepHandler interface + StepExecutionContext
      registry.ts               # StepHandlerRegistry
      prompt-step.ts            # PromptStepHandler  (chat:create + chat:read:content)
      bash-step.ts              # BashStepHandler    (process:exec via worker)
      http-step.ts              # HttpStepHandler    (http:outbound)
      slack-step.ts             # SlackStepHandler   (http:outbound + Slack Web API)
      file-read-step.ts         # FileReadStepHandler
      file-write-step.ts        # FileWriteStepHandler
      subworkflow-step.ts       # SubworkflowStepHandler
      human-approval-step.ts    # HumanApprovalStepHandler (Temporal Signal)
    temporal/
      worker.ts                 # starts Temporal Worker, passes registry to activities
      runner.ts                 # mainframe-workflow-runner generic workflow
      activities/
        tool-activity.ts        # delegates to StepHandlerRegistry.get(step.tool).execute()
        human-input-activity.ts # parks workflow, waits for Temporal Signal
    routes/
      workflows.ts              # GET /workflows, workflow CRUD
      runs.ts                   # GET/POST /runs, cancel, signal
      webhooks.ts               # POST /webhooks/:workflowId
      integrations.ts           # GET/PUT /integrations/:id (config per integration)
    ui/
      WorkflowsPanel.tsx        # left-panel sidebar
      WorkflowEditor.tsx        # React Flow canvas + palette + config panel
      WorkflowRunView.tsx       # read-only graph with live status
      WorkflowRunList.tsx       # recent runs list
      IntegrationSettings.tsx   # config UI for Slack token etc.
      nodes/                    # custom React Flow node components per step type
        PromptNode.tsx
        ToolNode.tsx
        WorkflowNode.tsx
        ApprovalNode.tsx
        SlackNode.tsx
```

### 3.2 Step Handler Registry

Step type handlers are an **internal registry** inside the workflows plugin — they are
not mainframe-level plugins and do not go through the mainframe consent flow. They share
the workflows plugin's declared capabilities (`http:outbound`, `process:exec`, etc.).
New integrations are added by registering a new handler class; no manifest or plugin
infrastructure changes are needed.

#### WorkflowStepHandler interface

```typescript
// packages/plugin-workflows/src/steps/handler.ts

export interface StepExecutionContext {
  runId: string;
  stepId: string;
  projectPath: string;
  variables: Record<string, unknown>;
  config: PluginConfig;          // ctx.config — for integration credentials
  chatService: ChatServiceAPI;   // for prompt steps
  logger: Logger;
}

export interface StepValidationResult {
  valid: boolean;
  errors: string[];
}

export interface WorkflowStepHandler {
  /** Matches the 'tool' field in the YAML step definition */
  readonly type: string;

  /** Validates step definition at workflow-load time (before execution) */
  validate(step: StepDefinition): StepValidationResult;

  /**
   * JSON Schema for the step's configuration fields.
   * Consumed by the visual editor's config panel to render the right form fields.
   */
  configSchema(): Record<string, unknown>;

  /** Executes the step inside a Temporal activity */
  execute(step: StepDefinition, ctx: StepExecutionContext): Promise<StepOutput>;
}
```

#### StepHandlerRegistry

```typescript
// packages/plugin-workflows/src/steps/registry.ts

export class StepHandlerRegistry {
  private handlers = new Map<string, WorkflowStepHandler>();

  register(handler: WorkflowStepHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): WorkflowStepHandler {
    const h = this.handlers.get(type);
    if (!h) throw new ValidationError(`Unknown step type: '${type}'`);
    return h;
  }

  allTypes(): string[] {
    return [...this.handlers.keys()];
  }

  allSchemas(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.handlers.entries()].map(([t, h]) => [t, h.configSchema()]),
    );
  }
}
```

#### Registration at activate time

```typescript
// packages/plugin-workflows/src/activate.ts

export function activate(ctx: PluginContext): void {
  const registry = new StepHandlerRegistry();

  registry.register(new PromptStepHandler(ctx.services.chats, ctx.logger));
  registry.register(new BashStepHandler(ctx.logger));
  registry.register(new HttpStepHandler(ctx.logger));
  registry.register(new SlackStepHandler(ctx.config, ctx.logger));
  registry.register(new FileReadStepHandler());
  registry.register(new FileWriteStepHandler());
  registry.register(new SubworkflowStepHandler());
  registry.register(new HumanApprovalStepHandler());

  // ToolActivity receives the registry and delegates to it:
  //   registry.get(step.tool).execute(step, stepCtx)
  startTemporalWorker(ctx, registry);
  mountRoutes(ctx, registry);
}
```

`ToolActivity` in the Temporal worker calls `registry.get(step.tool).execute(step, ctx)`.
Adding a new integration is: write a class, register it here, add a YAML step example
to docs. No plugin infrastructure changes required.

#### Integration configuration

Each integration that needs credentials (e.g. Slack API token) reads from `ctx.config`,
which is scoped to the workflows plugin in the core settings table:

```typescript
// SlackStepHandler.execute()
const token = ctx.config.get('integrations.slack.token');
if (!token) {
  throw new ValidationError(
    'Slack token not configured. Add it in Workflows → Settings → Integrations.'
  );
}
```

Config is set via the `IntegrationSettings` UI panel, which calls
`PUT /api/plugins/workflows/integrations/slack { token }`. The route stores the value
via `ctx.config.set('integrations.slack.token', token)`. Stored in core settings table
under `plugin:workflows:integrations.slack.token` — never in the YAML workflow definition.

#### Manifest capabilities

The workflows plugin declares capabilities that cover all its internal integrations:

```json
{
  "id": "workflows",
  "capabilities": [
    "storage",
    "ui:panels",
    "ui:notifications",
    "chat:read:content",
    "chat:create",
    "http:outbound",
    "process:exec"
  ]
}
```

`http:outbound` covers: Slack tasks, HTTP/fetch tasks, webhook triggers, license
validation. `process:exec` covers: bash tasks (run via Temporal worker subprocess).
The user consents once to the workflows plugin; no per-integration consent dialogs.

---

### New SQLite Tables

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,          -- "{projectId}:{name}"
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  definition JSON NOT NULL,
  file_path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  temporal_run_id TEXT,
  status TEXT NOT NULL,         -- pending|running|waiting_human|completed|failed|cancelled
  trigger_type TEXT NOT NULL,   -- manual|webhook|cron|event
  trigger_payload JSON,
  inputs JSON,
  outputs JSON,
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE workflow_step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- pending|running|completed|failed|skipped
  chat_id TEXT,
  inputs JSON,
  outputs JSON,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0
);
```

### Temporal Integration

- **Workflow engine**: Single generic `mainframe-workflow-runner` Temporal workflow that reads the YAML definition and executes steps as activities
- **Cron triggers**: Temporal Schedule API (no custom cron loop)
- **Webhook triggers**: Express route `POST /api/plugins/workflows/webhooks/:id` → `temporalClient.start()`
- **Event triggers**: `ctx.events.on('workflow.completed', ...)` → `temporalClient.start()`
- **Human input**: Temporal Signal — workflow parks at `HumanInputActivity`, resumes on `POST /runs/:id/signal`

### Activity Retry Policies

```typescript
const PROMPT_ACTIVITY_OPTIONS = {
  startToCloseTimeout: '30m',
  scheduleToCloseTimeout: '2h',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'LicenseError'],
  },
};

const TOOL_ACTIVITY_OPTIONS = {
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 3, initialInterval: '5s' },
};
```

Output validation failures (`ValidationError`) are non-retryable — bad AI output is rarely fixed by retrying the same prompt.

---

## 4. Licensing

The plugin uses license key + server validation on `activate()`:

1. Read license key from `ctx.config.get('workflows.licenseKey')`
2. Call Mainframe license server with key + machine fingerprint
3. Cache validated result locally for 7-day offline grace period
4. If invalid: log error and exit `activate()` — plugin is inert
5. Keys can be remotely revoked; server tracks (key, machineId, activationCount)

The license key is set via a settings field in the Workflows panel UI, stored in the `settings` table.

---

## 5. UI Design

### Layout

The Workflows tab in the left sidebar opens a split workspace:

- **Left**: workflow list sidebar — lists all workflows in the active project, with a recent runs section below
- **Right**: main view area — switches between **editor** (authoring) and **run view** (live status)

### Visual Editor

Built with `@xyflow/react` (React Flow). The graph is the source of truth during editing; on save it is serialized to YAML and written to `.mainframe/workflows/<name>.yml`.

**Three-panel layout:**
- **Palette** (left strip): drag-to-canvas node types (Prompt, Tool, Workflow, Approval)
- **Canvas** (center): React Flow graph — drag nodes, draw edges, zoom/pan
- **Config panel** (right): type-specific form for the selected node

**Interactions:**
- Drag a node type from palette → new step appears on canvas
- Draw edge from node output → node input → sets `depends_on`
- Edges can carry condition labels (`if exit_code != 0`)
- Click node → config panel opens
- Right-click node → context menu (Delete, Duplicate)
- [Save] → `graphToWorkflowDefinition()` → write YAML file
- [▶ Run] → variable input form → `POST /api/plugins/workflows/runs`

**Config panel fields by step type:**

| Type | Fields |
|------|--------|
| `prompt` | adapter, agentConfig, model, permissionMode, prompt textarea, output schema |
| `tool` | tool type, command/url, workdir, output schema |
| `workflow` | workflow selector, input mappings |
| `human_approval` | message text, timeout duration, on_timeout action |

### Run View

Same canvas, non-editable. Nodes show live status badges (⏳ ✅ ❌ ⏸). The config panel becomes a step log panel showing inputs/outputs for the selected node, with a link to open the associated chat session for `prompt` steps.

Live updates via WebSocket events: `workflow.step.completed`, `workflow.step.failed`, `workflow.step.waiting_human`.

### Human Approval Card

When a `human_approval` step is waiting, a notification toast appears: **"Workflow 'bug-report' is waiting for your input."** Clicking it navigates to the run view where the waiting node shows an inline approval card:

```
┌─────────────────────────────────────────────┐
│ ⏸ Workflow paused: bug-report               │
│ Step: approve-pr                            │
│ "PR ready. Branch: fix/TKT-42. Approve?"   │
│          [Reject]        [Approve →]        │
└─────────────────────────────────────────────┘
```

Approve/Reject calls `POST /api/plugins/workflows/runs/:id/signal`.

---

## 6. Event Flow Summary

```
Trigger (manual/webhook/cron/event)
  → WorkflowManager.triggerRun()
  → temporalClient.start('mainframe-workflow-runner', { definition, inputs, runId })
  → Temporal executes DAG:
      PromptActivity → ChatManager.createChat() → wait for chat.completed
      ToolActivity   → exec bash/curl/fetch → capture JSON output
      SubworkflowActivity → recursive temporalClient.start()
      HumanInputActivity → emit plugin event → wait for Temporal Signal
  → Each step: DB update (workflow_step_runs) + ctx.events.emit('workflow.step.*')
  → WebSocket fan-out → UI updates graph live
```

---

## 7. Open Questions / Future Work

- Visual editor: how to handle cycles/invalid DAGs gracefully in the UI
- Workflow versioning: what happens to in-flight runs when a workflow YAML is edited
- Managed Temporal: offer a hosted Temporal cloud as the long-term moat for the paid tier
- Plugin marketplace: discovery and installation UX for future third-party plugins
- Plugin permissions: harden the permissive model with declared capabilities if abuse occurs
