# App Preview Panel (Sandbox) — Design

> Feature design for the Mainframe embedded web preview with element inspector and agent context capture.

## Problem

Agents need visual and structural context about the UI they are building. Today, users must switch to a separate browser, manually take screenshots, and describe element locations in text — a slow, error-prone workflow. This feature embeds a live web preview directly in Mainframe and lets users attach element-level screenshots and CSS selectors to agent messages in one click.

## Scope

- Bottom panel with embedded `<webview>` for live app preview
- `launch.json` config in `project/.mainframe/` to define dev server processes
- Daemon-managed process lifecycle (start, stop, log streaming)
- Element inspector (eyedropper) and full-page screenshot capture
- Capture stack that auto-attaches to the next chat message

---

## launch.json Schema

Location: `{project}/.mainframe/launch.json`

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "Dev Server",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000,
      "url": null,
      "preview": true
    },
    {
      "name": "API",
      "runtimeExecutable": "node",
      "runtimeArgs": ["server.js"],
      "port": 4000,
      "url": null,
      "preview": false
    }
  ]
}
```

- **`port`**: Used to construct the preview URL as `http://localhost:{port}`. Null if not a web server.
- **`url`**: Direct URL override (for proxies, remote servers, or non-standard addresses). Takes precedence over `port`.
- **`preview: true`**: Marks the configuration whose URL the webview auto-loads. Only one config should have `preview: true`.

---

## Architecture

### UI Layout

A new **bottom panel** sits below the existing left/center/right panel row and spans the full window width. It is:

- Hidden by default, toggled via a toolbar button (or keyboard shortcut)
- Resizable via a draggable top edge
- Contains two tabs: **Preview** and **Logs**

**Preview tab:**
- Address bar (shows current URL, read-only by default, clickable to edit)
- Toolbar: Reload | Eyedropper (element inspector toggle) | Full Screenshot
- Pending capture chips: `[screenshot ×] [div.card > h2 ×] ...`
- `<webview>` filling remaining space

**Logs tab:**
- Process list from `launch.json` with per-process Start/Stop buttons and status indicator
- "Start All" / "Stop All" shortcut buttons
- Scrollable stdout/stderr output per process (selectable by process name)

### Daemon — Process Management

New routes under `@mainframe/core`:

| Route | Purpose |
|-------|---------|
| `GET /api/projects/:id/launch` | Read `launch.json` for a project |
| `POST /api/projects/:id/launch/:name/start` | Start a configuration by name |
| `POST /api/projects/:id/launch/:name/stop` | Stop a configuration by name |

Process lifecycle per configuration:

```
stopped → starting → running
                   ↘ failed
```

- Spawned via `execFile(runtimeExecutable, runtimeArgs, { cwd: project.path })`
- stdout/stderr streamed as `DaemonEvent: launch.output { projectId, name, data, stream }`
- State changes broadcast as `DaemonEvent: launch.status { projectId, name, status }`
- All processes killed on daemon shutdown or project close

### Desktop — Webview & Inspector

The `<webview>` tag is rendered in the React tree inside the bottom panel component. `webviewTag: true` must be set in `BrowserWindow` options.

**Element inspector flow:**

1. User clicks the eyedropper button → inspect mode activated
2. Renderer sends IPC message `sandbox:inspect-start` with the webview's `nodeIntegration` partition
3. Main process calls `webContents.executeJavaScript(inspectionScript)` on the webview's webContents
4. Injection script listens for `mousemove` (draws highlight overlay) and `click` (captures element info)
5. On click: script collects `{ selector, tagName, boundingRect }`, posts via `ipcRenderer` back to main
6. Main receives `sandbox:element-selected`, calls `webContents.capturePage({ rect: boundingRect })`
7. PNG buffer sent to renderer as `sandbox:capture-ready { type: 'element', selector, imageDataUrl }`
8. Renderer adds to capture stack in Zustand store

**Full screenshot flow:**

1. User clicks the camera button
2. Renderer sends `sandbox:screenshot`
3. Main calls `webContents.capturePage()` (full viewport)
4. PNG sent back as `sandbox:capture-ready { type: 'screenshot', imageDataUrl }`
5. Renderer adds to capture stack

### Capture Stack → Agent Message

Captures accumulate in a `pendingCaptures: Capture[]` array in Zustand (per active chat).

Each `Capture`:
```typescript
interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;  // PNG data URL
  selector?: string;     // CSS selector, only for type=element
}
```

On message send:
1. Each capture image is uploaded via the existing `AttachmentStore` → returns `attachmentId`
2. A text preamble is prepended to the message:
   ```
   [Preview captures: element `div.card > h2`, element `button.submit`, screenshot]
   ```
3. `attachmentIds` are included in `message.send` payload
4. Capture stack is cleared after send

---

## New Types (packages/types)

```typescript
// launch.ts
interface LaunchConfig {
  version: string;
  configurations: LaunchConfiguration[];
}

interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
}

type LaunchProcessStatus = 'stopped' | 'starting' | 'running' | 'failed';

// DaemonEvent extensions
{ type: 'launch.output'; projectId: string; name: string; data: string; stream: 'stdout' | 'stderr' }
{ type: 'launch.status'; projectId: string; name: string; status: LaunchProcessStatus }
```

---

## New Files

| Package | Path | Purpose |
|---------|------|---------|
| `@mainframe/core` | `src/launch/launch-manager.ts` | Spawn, track, stream launch processes |
| `@mainframe/core` | `src/launch/launch-config.ts` | Read/validate `launch.json` |
| `@mainframe/core` | `src/server/routes/launch.ts` | Express routes for launch API |
| `@mainframe/types` | `src/launch.ts` | Shared launch types |
| `@mainframe/desktop` | `src/main/sandbox.ts` | IPC handlers: inject, screenshot, capture |
| `@mainframe/desktop` | `src/renderer/components/sandbox/` | BottomPanel, PreviewTab, LogsTab |
| `@mainframe/desktop` | `src/renderer/store/sandbox.ts` | Capture stack Zustand store |

---

## Key Constraints

- **No `execSync`** in launch-manager. Use async `spawn` with stream piping.
- **Validate `launch.json`** with Zod before spawning anything.
- **Sanitize `runtimeExecutable`** — must be an absolute path or a known executable name (`pnpm`, `npm`, `node`, `yarn`). Reject shell operators.
- **`<webview>` in browser mode (`dev:web`)**: `<webview>` is Electron-only. Gracefully fall back to `<iframe>` with a banner "Element inspector unavailable in browser mode."
- **Process isolation**: Launch processes inherit `PATH` from the daemon but nothing else. No shell interpolation.
- **Max one `preview: true`** per `launch.json` — enforce with Zod `.refine()`.

---

## Out of Scope

- Network isolation or containerization (true sandboxing)
- Remote devtools protocol (CDP) integration
- Multiple simultaneous preview URLs / tabs
- Mobile/responsive viewport simulation
