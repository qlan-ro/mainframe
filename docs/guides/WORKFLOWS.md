# Workflows

Workflows are durable YAML automations that run on a schedule, in response to daemon events, or when triggered manually. They survive process restarts: the engine checkpoints every step to SQLite and replays on resume.

## File locations

The daemon scans two directories at startup and on `POST /api/workflows/rescan`:

| Location | Scope |
|---|---|
| `~/.mainframe/workflows/*.yml` | Global — runs regardless of the active project |
| `<project-root>/.mainframe/workflows/*.yml` | Project-scoped — available when the project is registered |

File names must match `^[a-zA-Z0-9_-]+\.yml$`. The `name:` field inside the file sets the display name; it must match the file stem.

## Full example

The daily kid health log collects a check-in form, then writes the answers to two files in parallel.

```yaml
version: 1
name: health-log
description: Daily kid health check-in

triggers:
  - schedule:
      cron: "0 8 * * *"
      on_missed: run_once  # or: skip

steps:
  - id: ask
    question:
      title: "Daily check-in"
      fields:
        - key: mood
          type: choice
          options: [great, okay, rough]
          required: true
        - key: temp
          type: number
          label: "Temperature (°C)"
          required: true
        - key: notes
          type: textarea
          required: false

  - id: record
    parallel:
      symptoms:
        - id: log
          connector: files.append
          with:
            path: "~/health/mood.log"
            content: "${ $now() } mood=${ ask.output.mood }\n"
      temperatures:
        - id: log
          connector: files.append
          with:
            path: "~/health/temp.log"
            content: "${ $now() } temp=${ ask.output.temp }\n"

outputs:
  mood: ${ ask.output.mood }
  temp: ${ ask.output.temp }
```

## JSONata expressions

Steps use `${ ... }` expressions for dynamic values, powered by [JSONata](https://jsonata.org).

**Whole-expression strings keep their type:**
```yaml
content: ${ ask.output.temp }   # returns a number, not a string
```

**Mixed strings interpolate to text:**
```yaml
content: "temp=${ ask.output.temp }°C\n"
```

**Null-coalesce with `??`:**
```yaml
content: "${ ask.output.notes ?? 'no notes' }"
```

**Scoping rules:**
- A step can reference any *earlier sibling* step by its `id` via `<id>.output.<field>`.
- Inner step ids do not leak outside their block (`choose`, `foreach`, `parallel`).
- Reserved namespaces: `inputs`, `vars`, `trigger`, `run`.
- Forward references are rejected at load time.

## Step kinds

| Kind | Key | Purpose |
|---|---|---|
| Connector | `connector: <id>.<action>` | Call a built-in service (files, bash, http) |
| Agent | `agent: { prompt, adapterId?, model? }` | Start a chat session; waits for completion |
| Question | `question: { title, fields }` | Pause and ask the user for input |
| Set | `set: { key: expr }` | Compute values into a named output |
| Choose | `choose: [{ when: expr, steps: [...] }]` | N-way conditional; runs the first matching arm |
| Foreach | `foreach: expr; as: item; steps: [...]` | Iterate over an array |
| Parallel | `parallel: { lane1: [...], lane2: [...] }` | Run named lanes concurrently |
| Call | `call: <workflow-name>; with: { ... }` | Invoke another workflow as a sub-flow |

All steps accept `id` (required), `name`, `retry`, `on_failure`, and `output`.

## Triggers

```yaml
triggers:
  - schedule:
      cron: "0 8 * * 1-5"   # weekdays at 08:00
      on_missed: run_once    # fire once after a resume; use 'skip' to drop missed fires
  - event:
      on: chat.updated       # any daemon event type
```

`on_missed` controls what happens when the daemon was offline and a cron fire was missed:
- `skip` — drop the missed fire and wait for the next scheduled time.
- `run_once` — fire once immediately on restart to catch up, then resume the schedule.

Manual trigger: `POST /api/workflows/:id/runs` (see REST API below).

## Question fields

Each field in `fields:` is an object:

| Property | Type | Description |
|---|---|---|
| `key` | string | Answer key in `<step>.output` |
| `type` | `text \| number \| choice \| multi \| textarea` | Input type |
| `label` | string | UI label (optional) |
| `options` | string[] | Enum values for `choice` and `multi` |
| `required` | boolean | Defaults to `true` |
| `when` | `{ key, equals }` | Show this field only when another field equals a value |

## Failure handling

```yaml
steps:
  - id: upload
    connector: http.post
    with: { url: "...", body: ${ data } }
    retry:
      attempts: 3
      backoff: exponential
      initialDelayMs: 5000
    on_failure: continue   # or: fail (default)
```

- `retry.attempts` counts total tries (first attempt + retries).
- `on_failure: continue` marks the step as `ambiguous` and proceeds; `fail` (default) stops the run.
- If a run becomes unrecoverable, the run status is `failed`.

## Connectors

Built-in connectors in v1:

| Connector | Actions | Notes |
|---|---|---|
| `files` | `append`, `write`, `read` | Local filesystem; paths support `~` expansion |
| `bash` | `run` | Runs a command; `cwd` and `timeout` supported |
| `http` | `get`, `post`, `put`, `delete` | Generic HTTP; use credentials for auth tokens |

Credentials are stored in `~/.mainframe/workflow-credentials.json` (mode 0600). To set a credential:

```
PUT /api/workflow-credentials/:label
{ "token": "Bearer sk-..." }
```

Then reference it in a step:
```yaml
connector: http.post
credential: my-api-token
```

## REST API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workflows` | List loaded workflows |
| `POST` | `/api/workflows/rescan` | Reload YAML files from disk |
| `POST` | `/api/workflows/:id/runs` | Start a run (`{ inputs?, payload? }`) |
| `GET` | `/api/workflows/:id/runs` | List runs for a workflow |
| `GET` | `/api/workflow-runs/:runId` | Run detail with step tree |
| `POST` | `/api/workflow-runs/:runId/cancel` | Cancel a running or waiting run |
| `GET` | `/api/workflow-interactions` | List pending question interactions |
| `POST` | `/api/workflow-interactions/:id/respond` | Submit form answers (`{ response: { ... } }`) |
| `GET` | `/api/workflow-connectors` | Catalog of registered connectors |
| `GET` | `/api/workflow-credentials` | List credential labels (not values) |
| `PUT` | `/api/workflow-credentials/:label` | Store a credential token |
| `DELETE` | `/api/workflow-credentials/:label` | Delete a credential |
| `POST` | `/api/workflows/validate` | Validate YAML without saving (`{ yaml }`) |
| `PUT` | `/api/workflows/:id` | Save (or overwrite) a workflow file then rescan |
| `DELETE` | `/api/workflows/:id` | Delete a workflow file then rescan |

WebSocket events emitted during a run: `workflow.run.updated`, `workflow.interaction.created`, `workflow.interaction.resolved`, `workflow.completed`.
