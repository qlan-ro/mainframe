# Quick Todos Design

Quick-create tasks from anywhere in the app via `Cmd+T`, without opening the full kanban view.

## Context

The todo plugin currently requires navigating to the full-view kanban board to create tasks. This adds friction for capturing quick ideas or bugs. The ticket (#27) requires that logic live in the plugin, not as custom desktop-side code.

## Design

### Plugin Action API

A new plugin UI concept: **actions**. An action is a keyboard-triggered command a plugin registers through its context.

**Type** (in `@qlan-ro/mainframe-types`):

```ts
interface PluginAction {
  id: string;        // e.g. 'quick-create'
  pluginId: string;  // set by the system, not the plugin
  label: string;     // e.g. 'New Task'
  shortcut: string;  // e.g. 'mod+t' (mod = Cmd on mac, Ctrl elsewhere)
  icon?: string;     // lucide icon name
}
```

**Plugin context additions** (on `ctx.ui`, gated by existing `ui:panels` capability):

- `addAction(action)` — registers the action, emits `plugin.action.registered` daemon event
- `removeAction(id)` — cleanup on unload

**Shortcut priority rule:** App-level shortcuts (maintained in an `APP_SHORTCUTS` set in the desktop) always take precedence. If a keypress matches an app shortcut, the plugin action is ignored. The app does not need to know what plugins registered — it just claims its own keys first.

### Quick-Create Dialog

Owned entirely by the todos plugin UI code. `PluginView` currently renders `TodosPanel` for the todos plugin only when the fullview is active. The `QuickTodoDialog` needs to be mounted regardless of fullview state. To achieve this, `PluginView` will gain a second registry — `BUILTIN_GLOBAL_COMPONENTS` — for components that are always mounted. The todos plugin registers `QuickTodoDialog` there. These global components render at the app root level, outside the layout panels.

**Trigger flow:**

1. User presses `Cmd+T`
2. Global keydown listener checks `APP_SHORTCUTS` — no match
3. Checks plugin actions — matches `todos:quick-create`
4. Sets `triggeredAction: { pluginId: 'todos', actionId: 'quick-create' }` in `usePluginLayoutStore`
5. `QuickTodoDialog` reads the store, opens when its action fires, clears the trigger

**Dialog fields:**

| Field | Control | Default | Required |
|-------|---------|---------|----------|
| Type | Two pill-toggle buttons: `Bug` / `Feature` | Feature | Yes |
| Title | Single-line text input, autofocused | — | Yes |
| Description | 2-row textarea | — | No |
| Priority | Three pill-toggle buttons: `Low` / `Medium` / `High` | Medium | Yes |
| Labels | Comma-separated text input | — | No |

**Layout:** Centered overlay (`fixed inset-0 z-50`), card `max-w-md`, same backdrop and styling patterns as existing modals (`bg-mf-panel-bg rounded-mf-panel border border-mf-border shadow-xl`).

**Behavior:**

- Created against the currently active project from `useProjectStore`
- Submit via `Cmd+Enter` or clicking the Create button
- On success: calls `toast.success('Task #N created')`, dialog closes
- Escape or backdrop click dismisses without creating
- If the kanban full-view is open, it picks up the new todo on its next data fetch

### Daemon Events

Two new event types:

- `plugin.action.registered` — emitted when a plugin calls `addAction()`. Payload: the `PluginAction` object. Sent to all connected WebSocket clients, and replayed on new connections (same pattern as `plugin.panel.registered`).
- `plugin.action.unregistered` — emitted on `removeAction()`. Payload: `{ pluginId, actionId }`.

No `plugin.action.triggered` event is needed — the trigger is handled entirely on the desktop side (store state change).

### Desktop Store Changes

`usePluginLayoutStore` gains:

- `actions: PluginAction[]` — populated from `plugin.action.registered` events
- `triggeredAction: { pluginId: string; actionId: string } | null` — set by the keydown listener, cleared by the consuming component
- `triggerAction(pluginId, actionId)` — setter
- `clearTriggeredAction()` — clearer

### Registration in the Todos Plugin

The plugin's `activate()` function adds:

```ts
ctx.ui.addAction({
  id: 'quick-create',
  label: 'New Task',
  shortcut: 'mod+t',
  icon: 'plus',
});
ctx.onUnload(() => ctx.ui.removeAction('quick-create'));
```

No new capabilities needed — `ui:panels` already covers UI surface registration.

## Out of Scope

- Image/paste support in the description field (future, after image support is added)
- "Start Session" from the quick-create dialog (use the full kanban view for that)
- Multiple todo creation in sequence (dialog closes after each create)
- Custom shortcut configuration
