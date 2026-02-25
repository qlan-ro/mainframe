# Spec Alignment & UI Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align MAINFRAME-DESIGN.md with the actual codebase, then implement the missing UI features: general-purpose center panel tabs (chats + editors + diffs), left panel agents tab, shadcn/ui integration, Monaco editor, and functional right panel with navigation that opens content in center panel splits.

**Architecture:** The spec document gets updated first to reflect code reality (adapter interface body, right panel tabs, left panel tabs, status bar, EventEmitter pattern). A "Deferred Features" section captures items intentionally left for later. Then we implement the gaps in dependency order: shadcn/ui first (all subsequent components use it), then Monaco (needed by center panel editors), then center panel tab system (general-purpose: chats, editors, diffs), then left panel agents tab, then daemon APIs (file tree, git diff, session-tracked AI changes), then functional right panel as navigation that opens viewers in center panel.

**Tech Stack:** TypeScript, React 18, Electron, shadcn/ui (new), Monaco Editor (new), Tailwind CSS, Zustand, react-resizable-panels

---

## Phase 1: Spec Document Fixes

### Task 1: Update adapter interface in MAINFRAME-DESIGN.md

**Files:**
- Modify: `docs/MAINFRAME-DESIGN.md:157-188` (section 4.4)

**What's changing and why:**

The spec already uses the name `AgentAdapter` — we keep that. But the interface _body_ is wrong in three ways:
1. It uses callback-style events (`onInit`, `onMessage`, etc.) — code uses EventEmitter pattern
2. `sendMessage` takes `UserMessage` — code takes a raw `string`
3. It includes `getHistory?()` — intentionally omitted (CLI-native history via `--resume`)
4. It's missing `isInstalled()` and `getVersion()` which exist in the code

**Step 1: Replace the interface code block**

In `docs/MAINFRAME-DESIGN.md`, replace the entire section 4.4 content (lines 157-188):

```
### 4.4 Agent Adapters

Pluggable adapters for each CLI agent.

\`\`\`typescript
interface AgentAdapter {
  id: string;                    // 'claude', 'gemini', etc.
  name: string;                  // 'Claude CLI'

  // Lifecycle
  spawn(options: SpawnOptions): Promise<AgentProcess>;
  kill(process: AgentProcess): Promise<void>;

  // Communication
  sendMessage(process: AgentProcess, message: UserMessage): Promise<void>;
  respondToPermission(process: AgentProcess, response: PermissionResponse): Promise<void>;

  // Events (emitted by adapter)
  onInit: (callback: (session: SessionInfo) => void) => void;
  onMessage: (callback: (content: ContentBlock[]) => void) => void;
  onPermissionRequest: (callback: (request: PermissionRequest) => void) => void;
  onResult: (callback: (result: ResultEvent) => void) => void;
  onError: (callback: (error: Error) => void) => void;

  // History (optional - if CLI stores its own)
  getHistory?(sessionId: string): Promise<HistoryEntry[]>;
}
\`\`\`
```

With:

```
### 4.4 Agent Adapters

EventEmitter-based adapters for each CLI agent. Each adapter implements the `AgentAdapter` interface and extends `EventEmitter` to emit typed events.

\`\`\`typescript
interface AgentAdapter {
  id: string;                    // 'claude', 'gemini', etc.
  name: string;                  // 'Claude CLI'

  // Discovery
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;

  // Lifecycle
  spawn(options: SpawnOptions): Promise<AdapterProcess>;
  kill(process: AdapterProcess): Promise<void>;

  // Communication
  sendMessage(process: AdapterProcess, message: string): Promise<void>;
  respondToPermission(process: AdapterProcess, response: PermissionResponse): Promise<void>;
}

// Adapters extend EventEmitter and emit typed events:
// - init(processId, claudeSessionId, model, tools)
// - message(processId, content: MessageContent[])
// - permission(processId, request: PermissionRequest)
// - result(processId, { cost, tokensInput, tokensOutput })
// - error(processId, error: Error)
// - exit(processId, code: number | null)
\`\`\`
```

Key differences from current spec:
- Keeps `AgentAdapter` name (spec name is canonical)
- Adds `isInstalled()` and `getVersion()` discovery methods
- Changes `sendMessage` from `UserMessage` to `string` (adapter wraps it into JSON internally)
- Replaces callback-style `onInit`/`onMessage`/etc. with EventEmitter comment block
- Removes `getHistory?()` (CLI-native history, not our concern)

**Note on pluggable adapters:** The current `AgentAdapter` interface is simple enough for community implementations — any class that implements these methods + emits these events can be an adapter. However, there's no runtime plugin discovery/registration mechanism yet (loading adapters from npm packages, config-driven registration, etc.). The spec already defers the plugin system to M2. No changes needed now — the interface shape is correct for future extensibility.

**Step 2: Verify the doc reads correctly**

Read through section 4.4 to confirm the narrative flows from the interface definition into the event list naturally.

**Step 3: Commit**

```bash
git add docs/MAINFRAME-BRAINSTORM.md
git commit -m "docs: update adapter interface in spec to match EventEmitter pattern"
```

---

### Task 2: Update right panel tabs and status bar in MAINFRAME-DESIGN.md

**Files:**
- Modify: `docs/MAINFRAME-DESIGN.md:280-306` (section 6.2 layout diagram)
- Modify: `docs/MAINFRAME-DESIGN.md:326-335` (section 6.3 Right Panel)
- Modify: `docs/MAINFRAME-DESIGN.md:304` (status bar line)

**Step 1: Update the ASCII layout diagram (section 6.2)**

In the layout diagram, replace the **right panel** labels:
- `▸ Diff Viewer` → `▸ Context`
- `▸ File Preview` → `▸ Files`
- `▸ Context` → `▸ Changes`

In the layout diagram, replace the **left panel** labels (lines 296-298):
- `▸ Files` → `▸ Sessions`
- `▸ Agents` stays as-is
- `▸ Context` → remove (moved to right panel)

Replace the **status bar** line:
- `Status: Claude Sonnet • 12.4k tokens • $0.03 • Session 2m 34s`
- → `Status: ● Claude • 12.4k ████░░ • $0.03 • ⎇ main • ●`

**Step 2: Update section 6.3 Right Panel description**

Replace:
```
**Right Panel** (tabbed, splittable):
- Diff Viewer
- File Preview
- Context details
- Session Info (tokens, cost, duration)
```

With:
```
**Right Panel** (tabbed, splittable):
- Context — included files, CLAUDE.md, AGENTS.md
- Files — project file browser
- Changes — git status and diff display
```

**Step 3: Update section 6.3 Left Panel description**

The Left Panel currently has: project info, search, chats list. Files and Context have moved to the Right Panel. Update the spec to reflect this:

Replace:
```
**Left Panel** (tabbed, splittable):
- Current project info
- Search (scoped to project)
- New session button
- Files tab
- Agents tab
- Context tab
```

With:
```
**Left Panel** (tabbed, splittable):
- Current project info
- Search (scoped to project)
- Sessions tab — chat list with new session button
- Agents tab — active subagents spawned within sessions (e.g. Claude Task tool agents)
```

**Step 4: Commit**

```bash
git add docs/MAINFRAME-BRAINSTORM.md
git commit -m "docs: update panel tabs and status bar in spec to match code"
```

---

### Task 3: Add Deferred Features section to MAINFRAME-DESIGN.md

**Files:**
- Modify: `docs/MAINFRAME-DESIGN.md` (add new section before "Open Questions")

**Step 1: Add section 6.5 "Deferred Features"**

Insert before section 10 (Open Questions) a new section:

```markdown
### 6.5 Deferred UI Features

The following features are part of the design vision but are not planned for implementation in the current milestone cycle:

- **Bottom Panel** — Terminal, History Timeline, Logs (tabbed, splittable). The panel infrastructure exists in the UI store (`panelCollapsed.bottom`, `bottomPanelTab`) but is not rendered in the layout.
- **Panel Splitting** — Vertical splitting within panels and side-by-side session views. The horizontal left/center/right split is implemented; further subdivision is deferred.
- **Draggable Tabs** — Tabs draggable between panels where semantically valid.
- **macOS launchd** — Auto-start daemon as a system service. Currently daemon is started manually or by the desktop app.
- **Per-Project Layout Persistence** — Layout is persisted globally to localStorage. Per-project layout overrides are deferred.
```

**Step 2: Commit**

```bash
git add docs/MAINFRAME-BRAINSTORM.md
git commit -m "docs: add deferred features section to spec"
```

---

## Phase 2: shadcn/ui Integration

### Task 4: Initialize shadcn/ui in the desktop package

shadcn/ui generates components into your project. We already have the prerequisite stack: Tailwind CSS, `cn()` utility, `clsx`, `tailwind-merge`, `class-variance-authority`, and Radix UI primitives.

**Files:**
- Create: `packages/desktop/components.json` — shadcn config
- Create: `packages/desktop/src/renderer/components/ui/button.tsx`
- Create: `packages/desktop/src/renderer/components/ui/tabs.tsx`
- Create: `packages/desktop/src/renderer/components/ui/input.tsx`
- Create: `packages/desktop/src/renderer/components/ui/scroll-area.tsx`
- Create: `packages/desktop/src/renderer/components/ui/tooltip.tsx`
- Modify: `packages/desktop/src/renderer/index.css` — add any missing CSS vars shadcn needs

**Step 1: Create components.json config**

Create `packages/desktop/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/renderer/index.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "src/renderer/components",
    "utils": "src/renderer/lib/utils",
    "ui": "src/renderer/components/ui"
  }
}
```

**Step 2: Install shadcn components**

Run from `packages/desktop/`:
```bash
cd packages/desktop && npx shadcn@latest add button tabs input scroll-area tooltip --yes
```

If the CLI prompts fail due to electron-vite or monorepo issues, manually copy component files from the shadcn registry. Each component is a single file that imports from Radix + our `cn()` utility.

**Step 3: Verify components are generated**

Run: `ls packages/desktop/src/renderer/components/ui/`
Expected: `button.tsx`, `tabs.tsx`, `input.tsx`, `scroll-area.tsx`, `tooltip.tsx`

**Step 4: Adjust component imports for our CSS variable scheme**

shadcn uses `--background`, `--foreground`, etc. We use `--mf-*` prefixed vars. In each generated component, check if it references CSS variables directly. If it does, update to use our `mf-*` Tailwind classes or add aliases in `index.css`:

```css
:root {
  --background: var(--mf-panel-bg);
  --foreground: var(--mf-text-primary);
  --muted: var(--mf-app-bg);
  --muted-foreground: var(--mf-text-secondary);
  --border: var(--mf-divider);
  --input: var(--mf-input-bg);
  --ring: var(--mf-accent-claude);
  --accent: var(--mf-hover);
  --accent-foreground: var(--mf-text-primary);
}
```

**Step 5: Build to verify**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add packages/desktop/components.json packages/desktop/src/renderer/components/ui/ packages/desktop/src/renderer/index.css
git commit -m "feat(desktop): initialize shadcn/ui with core components"
```

---

### Task 5: Migrate existing components to use shadcn/ui primitives

Replace hand-rolled UI elements with shadcn components where they provide value. Don't force-migrate everything — only swap where the shadcn component is a clear improvement.

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx` — search input → shadcn Input
- Modify: `packages/desktop/src/renderer/components/panels/RightPanel.tsx` — tabs → shadcn Tabs
- Modify: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` — "New Chat" → shadcn Button
- Modify: `packages/desktop/src/renderer/components/chat/ChatInput.tsx` — textarea styling
- Modify: `packages/desktop/src/renderer/components/chat/PermissionCard.tsx` — buttons → shadcn Button

**Step 1: Migrate LeftPanel search input**

In `LeftPanel.tsx`, replace the raw `<input>` with:
```tsx
import { Input } from '../ui/input';

<Input
  placeholder="Search..."
  className="h-9 bg-transparent border-[#71717a] text-mf-body placeholder:text-mf-text-secondary focus-visible:ring-mf-accent-claude"
/>
```

**Step 2: Migrate RightPanel to shadcn Tabs**

In `RightPanel.tsx`, replace the manual tab implementation with:
```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

<Tabs defaultValue="context" className="h-full flex flex-col">
  <TabsList className="p-[10px] pb-2 bg-transparent justify-start gap-1">
    <TabsTrigger value="context">Context</TabsTrigger>
    <TabsTrigger value="files">Files</TabsTrigger>
    <TabsTrigger value="changes">Changes</TabsTrigger>
  </TabsList>
  <TabsContent value="context" className="flex-1 overflow-y-auto px-[10px]">
    ...existing context content...
  </TabsContent>
  <TabsContent value="files" className="flex-1 overflow-y-auto px-[10px]">
    ...existing files content...
  </TabsContent>
  <TabsContent value="changes" className="flex-1 overflow-y-auto px-[10px]">
    ...existing changes content...
  </TabsContent>
</Tabs>
```

**Step 3: Migrate ChatsPanel button**

In `ChatsPanel.tsx`, replace the "New Chat" `<button>` with:
```tsx
import { Button } from '../ui/button';

<Button
  variant="outline"
  size="sm"
  onClick={() => createChat('claude')}
  disabled={!activeProjectId}
  className="gap-[6px]"
>
  <Plus size={14} />
  New Chat
</Button>
```

**Step 4: Migrate PermissionCard buttons**

In `PermissionCard.tsx`, replace the action buttons with shadcn Button variants:
```tsx
import { Button } from '../ui/button';

<Button variant="outline" size="sm" onClick={() => onRespond(...)}>Deny</Button>
<Button variant="default" size="sm" onClick={() => onRespond(...)}>Allow Once</Button>
```

**Step 5: Build to verify**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/
git commit -m "refactor(desktop): migrate components to shadcn/ui primitives"
```

---

## Phase 3: General-Purpose Center Panel Tabs

### Task 6: Build a general-purpose center panel tab system

The center panel currently shows only a single chat badge (`ChatContainer.tsx:16-23`). It needs to become a general-purpose tabbed area that can host:
- **Chat sessions** — the current ChatContainer
- **File editors** — Monaco editor opened from the Files tab in right panel
- **Diff viewers** — Monaco diff editor opened from the Changes tab or from AI message diffs

This is like VS Code's editor area: a tab bar at the top, content area below, and the ability to open/close/switch tabs of different types.

**Files:**
- Create: `packages/desktop/src/renderer/store/tabs.ts` — tab state management
- Create: `packages/desktop/src/renderer/components/center/CenterPanel.tsx` — tab bar + content router
- Create: `packages/desktop/src/renderer/components/center/EditorTab.tsx` — Monaco file editor wrapper
- Create: `packages/desktop/src/renderer/components/center/DiffTab.tsx` — Monaco diff viewer wrapper
- Modify: `packages/desktop/src/renderer/App.tsx` — pass CenterPanel instead of ChatContainer

**Step 1: Create the tab store**

Create `packages/desktop/src/renderer/store/tabs.ts`:

```tsx
import { create } from 'zustand';

export type CenterTab =
  | { type: 'chat'; id: string; chatId: string; label: string }
  | { type: 'editor'; id: string; filePath: string; label: string }
  | { type: 'diff'; id: string; filePath: string; label: string; source: 'git' | 'session'; chatId?: string };

interface TabsState {
  tabs: CenterTab[];
  activeTabId: string | null;

  openTab: (tab: CenterTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  openChatTab: (chatId: string) => void;
  openEditorTab: (filePath: string) => void;
  openDiffTab: (filePath: string, source: 'git' | 'session', chatId?: string) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (tab) => set((state) => {
    const existing = state.tabs.find((t) => t.id === tab.id);
    if (existing) return { activeTabId: tab.id };
    return { tabs: [...state.tabs, tab], activeTabId: tab.id };
  }),

  closeTab: (id) => set((state) => {
    const newTabs = state.tabs.filter((t) => t.id !== id);
    const newActive = state.activeTabId === id
      ? (newTabs[newTabs.length - 1]?.id ?? null)
      : state.activeTabId;
    return { tabs: newTabs, activeTabId: newActive };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),

  openChatTab: (chatId) => {
    const id = `chat:${chatId}`;
    get().openTab({ type: 'chat', id, chatId, label: `Chat ${chatId.slice(0, 8)}` });
  },

  openEditorTab: (filePath) => {
    const id = `editor:${filePath}`;
    const label = filePath.split('/').pop() || filePath;
    get().openTab({ type: 'editor', id, filePath, label });
  },

  openDiffTab: (filePath, source, chatId) => {
    const id = `diff:${source}:${filePath}`;
    const label = `${filePath.split('/').pop() || filePath} (diff)`;
    get().openTab({ type: 'diff', id, filePath, label, source, chatId });
  },
}));
```

The `source` field on diff tabs distinguishes:
- `'git'` — diff against HEAD (from git status/Changes tab)
- `'session'` — diff from AI changes within a chat session (from message stream)

**Step 2: Create CenterPanel component**

Create `packages/desktop/src/renderer/components/center/CenterPanel.tsx`:

```tsx
import React from 'react';
import { X, Plus, MessageSquare, FileText, GitBranch } from 'lucide-react';
import { useTabsStore, type CenterTab } from '../../store/tabs';
import { useProjectsStore } from '../../store';
import { useProject } from '../../hooks/useDaemon';
import { ChatContainer } from '../chat/ChatContainer';
import { EditorTab } from './EditorTab';
import { DiffTab } from './DiffTab';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';

function TabIcon({ tab }: { tab: CenterTab }): React.ReactElement {
  switch (tab.type) {
    case 'chat': return <div className="w-2 h-2 rounded-full bg-mf-accent-claude" />;
    case 'editor': return <FileText size={12} className="text-mf-text-secondary" />;
    case 'diff': return <GitBranch size={12} className="text-mf-text-secondary" />;
  }
}

export function CenterPanel(): React.ReactElement {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore();
  const { activeProjectId } = useProjectsStore();
  const { createChat } = useProject(activeProjectId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="h-9 border-b border-mf-divider flex items-center">
        <ScrollArea className="flex-1">
          <div className="flex items-center gap-1 px-[10px]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'group flex items-center gap-2 px-[10px] py-[6px] rounded-mf-card text-mf-small font-medium shrink-0 transition-colors',
                  activeTabId === tab.id
                    ? 'bg-mf-app-bg border border-[#71717a99] text-mf-text-primary'
                    : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover/50'
                )}
              >
                <TabIcon tab={tab} />
                {tab.label}
                <X
                  size={12}
                  className="opacity-0 group-hover:opacity-100 hover:text-mf-text-primary transition-opacity"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                />
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <div className="px-[6px]">
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => createChat('claude')}
            disabled={!activeProjectId}
            title="New session"
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {!activeTab && (
          <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
            Open a session, file, or diff to get started
          </div>
        )}
        {activeTab?.type === 'chat' && <ChatContainer chatId={activeTab.chatId} />}
        {activeTab?.type === 'editor' && <EditorTab filePath={activeTab.filePath} />}
        {activeTab?.type === 'diff' && <DiffTab filePath={activeTab.filePath} source={activeTab.source} chatId={activeTab.chatId} />}
      </div>
    </div>
  );
}
```

**Step 3: Update ChatContainer to accept chatId as a prop**

Modify `ChatContainer.tsx` to take `chatId` as a prop instead of reading from the global store:

```tsx
interface ChatContainerProps {
  chatId: string;
}

export function ChatContainer({ chatId }: ChatContainerProps): React.ReactElement {
  const { messages, pendingPermission, sendMessage, respondToPermission } = useChat(chatId);
  // ... remove the activeChatId from store, use prop instead
  // ... remove the single badge header (tab bar is now in CenterPanel)
```

**Step 4: Create EditorTab and DiffTab stubs**

These are thin wrappers around MonacoEditor/MonacoDiffEditor that fetch file content from the daemon. Full implementation in Tasks 11-12.

`EditorTab.tsx`:
```tsx
export function EditorTab({ filePath }: { filePath: string }): React.ReactElement {
  // Fetches file content from daemon API, renders in MonacoEditor
  // Full implementation in Task 11
}
```

`DiffTab.tsx`:
```tsx
export function DiffTab({ filePath, source, chatId }: { filePath: string; source: 'git' | 'session'; chatId?: string }): React.ReactElement {
  // source='git': fetches git diff from daemon
  // source='session': fetches AI-generated changes for this chat
  // Full implementation in Task 12
}
```

**Step 5: Wire up App.tsx**

Replace `ChatContainer` with `CenterPanel` in `App.tsx`:
```tsx
import { CenterPanel } from './components/center/CenterPanel';

<Layout
  leftPanel={<LeftPanel />}
  centerPanel={<CenterPanel />}
  rightPanel={<RightPanel />}
/>
```

**Step 6: Update chats store integration**

When a new chat is created via WebSocket (`chat.created` event), auto-open a chat tab:
```tsx
// In useDaemon hook, on 'chat.created' event:
useTabsStore.getState().openChatTab(chat.id);
```

**Step 7: Build to verify**

Run: `pnpm build`
Expected: Clean build.

**Step 8: Commit**

```bash
git add packages/desktop/src/renderer/store/tabs.ts packages/desktop/src/renderer/components/center/ packages/desktop/src/renderer/components/chat/ChatContainer.tsx packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add general-purpose center panel tab system (chats, editors, diffs)"
```

---

## Phase 4: Left Panel — Agents Tab

### Task 7: Add tabbed navigation to LeftPanel with Sessions and Agents tabs

The left panel currently shows only the sessions list. Add a tab switcher for Sessions | Agents.

**Important:** "Agents" here means **subagents** spawned within a session (e.g. Claude's Task tool spawning parallel subagents), NOT the CLI adapters (Claude, Gemini, etc). This tab will eventually display active subagent tasks, their status, and output. For now it's an empty placeholder.

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`
- Create: `packages/desktop/src/renderer/components/panels/AgentsPanel.tsx`

**Step 1: Create AgentsPanel placeholder component**

Create `packages/desktop/src/renderer/components/panels/AgentsPanel.tsx`:

```tsx
import React from 'react';
import { Bot } from 'lucide-react';

export function AgentsPanel(): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center px-[10px]">
      <Bot size={24} className="text-mf-text-secondary mb-2" />
      <div className="text-mf-body text-mf-text-secondary text-center">
        No active agents
      </div>
      <div className="text-mf-label text-mf-text-secondary text-center mt-1">
        Subagents spawned during sessions will appear here
      </div>
    </div>
  );
}
```

**Step 2: Add tabbed layout to LeftPanel**

Replace `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`:

```tsx
import React from 'react';
import { useProjectsStore, useUIStore } from '../../store';
import { ChatsPanel } from './ChatsPanel';
import { AgentsPanel } from './AgentsPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Input } from '../ui/input';

export function LeftPanel(): React.ReactElement {
  const { projects, activeProjectId } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="h-full flex flex-col">
      {/* Project info header */}
      <div className="p-[10px] pb-0">
        {activeProject ? (
          <div className="space-y-[2px]">
            <div className="text-mf-body font-semibold text-mf-text-primary truncate">
              {activeProject.name}
            </div>
            <div className="text-mf-label text-mf-text-secondary truncate">
              {activeProject.path}
            </div>
          </div>
        ) : (
          <div className="text-mf-body text-mf-text-secondary">
            No project selected
          </div>
        )}
      </div>

      {/* Search */}
      <div className="px-[10px] py-2">
        <Input
          placeholder="Search..."
          className="h-9 bg-transparent border-[#71717a] text-mf-body placeholder:text-mf-text-secondary focus-visible:ring-mf-accent-claude"
        />
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="sessions" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="px-[10px] bg-transparent justify-start gap-1 shrink-0">
          <TabsTrigger value="sessions" className="text-mf-small">Sessions</TabsTrigger>
          <TabsTrigger value="agents" className="text-mf-small">Agents</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="flex-1 overflow-hidden mt-0">
          <ChatsPanel />
        </TabsContent>
        <TabsContent value="agents" className="flex-1 overflow-hidden mt-0">
          <AgentsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 3: Build to verify**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/
git commit -m "feat(desktop): add Agents tab to left panel"
```

---

## Phase 5: Monaco Editor

### Task 8: Install and configure Monaco Editor

**Files:**
- Modify: `packages/desktop/package.json` — add `@monaco-editor/react`
- Create: `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`
- Modify: `packages/desktop/electron.vite.config.ts` — configure Monaco workers if needed

**Step 1: Install Monaco**

Run from project root:
```bash
pnpm --filter @mainframe/desktop add @monaco-editor/react monaco-editor
```

**Step 2: Create MonacoEditor wrapper component**

Create `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`:

```tsx
import React from 'react';
import Editor from '@monaco-editor/react';

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string | undefined) => void;
}

export function MonacoEditor({ value, language, readOnly = true, onChange }: MonacoEditorProps): React.ReactElement {
  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      theme="mainframe-dark"
      options={{
        readOnly,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        renderWhitespace: 'none',
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        padding: { top: 8 },
      }}
      beforeMount={(monaco) => {
        monaco.editor.defineTheme('mainframe-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#191a1c',
            'editor.foreground': '#f4f4f5',
            'editorLineNumber.foreground': '#71717a',
            'editorLineNumber.activeForeground': '#a1a1aa',
            'editor.selectionBackground': '#2b2d3066',
            'editor.lineHighlightBackground': '#2b2d3044',
          },
        });
      }}
    />
  );
}
```

**Step 3: Create MonacoDiffEditor wrapper**

Create `packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx`:

```tsx
import React from 'react';
import { DiffEditor } from '@monaco-editor/react';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: string;
}

export function MonacoDiffEditor({ original, modified, language }: MonacoDiffEditorProps): React.ReactElement {
  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      theme="mainframe-dark"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        renderSideBySide: true,
        scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
      }}
      beforeMount={(monaco) => {
        monaco.editor.defineTheme('mainframe-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#191a1c',
            'editor.foreground': '#f4f4f5',
            'editorLineNumber.foreground': '#71717a',
            'editorLineNumber.activeForeground': '#a1a1aa',
            'diffEditor.insertedTextBackground': '#22c55e18',
            'diffEditor.removedTextBackground': '#ef444418',
          },
        });
      }}
    />
  );
}
```

**Step 4: Build to verify**

Run: `pnpm build`
Expected: Clean build. Monaco workers bundled by Vite automatically.

**Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/renderer/components/editor/ pnpm-lock.yaml
git commit -m "feat(desktop): add Monaco editor and diff viewer components"
```

---

## Phase 6: Functional Right Panel

### Task 9: Add file reading, diff, and session change tracking APIs to the daemon

The right panel needs file tree/content APIs, and the center panel diff tabs need to support two diff sources:
1. **Git diffs** — working tree vs HEAD (from `git diff`)
2. **Session diffs** — files modified by AI within a specific chat session

For session diffs, the daemon tracks which files are modified during a chat by watching `tool_use` events in the adapter stream that write/edit files. The `ChatManager` maintains a `modifiedFiles: Map<chatId, Set<filePath>>` to record these.

Additionally, extend the `Chat` type to include `contextFiles` so the daemon can report which context files are loaded in a session (instead of hardcoding in the UI).

**Files:**
- Modify: `packages/types/src/chat.ts` — add `contextFiles` to Chat type
- Modify: `packages/core/src/chat-manager.ts` — track modified files per chat
- Modify: `packages/core/src/server/http.ts` — add file, git, and session diff endpoints
- Modify: `packages/desktop/src/renderer/lib/client.ts` — add client methods

**Step 1: Extend Chat type**

In `packages/types/src/chat.ts`, add to the `Chat` interface:
```typescript
export interface Chat {
  // ...existing fields...
  contextFiles?: string[];  // Files included as session context (CLAUDE.md, AGENTS.md, etc.)
}
```

**Step 2: Track modified files in ChatManager**

In `packages/core/src/chat-manager.ts`, add a `modifiedFiles` map:
```typescript
private modifiedFiles = new Map<string, Set<string>>();

// In the adapter 'message' event handler, when content includes tool_use
// for file-writing tools (Write, Edit, Bash with file operations):
private trackFileModification(chatId: string, content: MessageContent[]): void {
  for (const block of content) {
    if (block.type === 'tool_use' && ['Write', 'Edit'].includes(block.name)) {
      const filePath = (block.input as Record<string, unknown>).file_path as string;
      if (filePath) {
        const files = this.modifiedFiles.get(chatId) || new Set();
        files.add(filePath);
        this.modifiedFiles.set(chatId, files);
      }
    }
  }
}

getModifiedFiles(chatId: string): string[] {
  return Array.from(this.modifiedFiles.get(chatId) || []);
}
```

**Step 3: Add all HTTP endpoints**

Add to `packages/core/src/server/http.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

// File reading — GET /api/projects/:id/files?path=relative/path
app.get('/api/projects/:id/files', (req, res) => {
  const project = deps.db.projects.getById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path query required' });

  const fullPath = path.resolve(project.path, filePath);
  if (!fullPath.startsWith(project.path)) {
    return res.status(403).json({ error: 'Path outside project' });
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ path: filePath, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// File tree — GET /api/projects/:id/tree?path=relative/dir
app.get('/api/projects/:id/tree', (req, res) => {
  const project = deps.db.projects.getById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const dirPath = (req.query.path as string) || '.';
  const fullPath = path.resolve(project.path, dirPath);
  if (!fullPath.startsWith(project.path)) {
    return res.status(403).json({ error: 'Path outside project' });
  }

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.relative(project.path, path.join(fullPath, e.name)),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json(entries);
  } catch {
    res.status(404).json({ error: 'Directory not found' });
  }
});

// Git status — GET /api/projects/:id/git/status
app.get('/api/projects/:id/git/status', (req, res) => {
  const project = deps.db.projects.getById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const status = execSync('git status --porcelain', { cwd: project.path, encoding: 'utf-8' });
    const files = status.trim().split('\n').filter(Boolean).map((line: string) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
    res.json({ files });
  } catch {
    res.json({ files: [], error: 'Not a git repository' });
  }
});

// Diff — supports both git and session sources
// GET /api/projects/:id/diff?file=path&source=git          (default: git diff vs HEAD)
// GET /api/projects/:id/diff?file=path&source=session&chatId=X  (original from git + current on disk)
app.get('/api/projects/:id/diff', (req, res) => {
  const project = deps.db.projects.getById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const file = req.query.file as string;
  const source = (req.query.source as string) || 'git';

  if (source === 'git') {
    try {
      const cmd = file ? `git diff -- "${file}"` : 'git diff';
      const diff = execSync(cmd, { cwd: project.path, encoding: 'utf-8' });
      // Also get the original content for side-by-side view
      let original = '';
      if (file) {
        try { original = execSync(`git show HEAD:"${file}"`, { cwd: project.path, encoding: 'utf-8' }); } catch { /* new file */ }
      }
      const modified = file ? fs.readFileSync(path.resolve(project.path, file), 'utf-8') : '';
      res.json({ diff, original, modified, source: 'git' });
    } catch {
      res.json({ diff: '', original: '', modified: '', source: 'git' });
    }
  } else if (source === 'session') {
    // Session-scoped: return original (from git HEAD) and modified (current disk) for files changed in this session
    const chatId = req.query.chatId as string;
    if (!file) {
      // Return list of files modified in session
      const modifiedFiles = chatId ? deps.chatManager.getModifiedFiles(chatId) : [];
      return res.json({ files: modifiedFiles, source: 'session' });
    }
    try {
      let original = '';
      try { original = execSync(`git show HEAD:"${file}"`, { cwd: project.path, encoding: 'utf-8' }); } catch { /* new file */ }
      const modified = fs.readFileSync(path.resolve(project.path, file), 'utf-8');
      res.json({ original, modified, source: 'session', file });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  } else {
    res.status(400).json({ error: 'Invalid source. Use "git" or "session".' });
  }
});

// Session changed files — GET /api/chats/:id/changes
app.get('/api/chats/:id/changes', (req, res) => {
  const files = deps.chatManager.getModifiedFiles(req.params.id);
  res.json({ files });
});
```

**Step 4: Add client methods**

Add to `packages/desktop/src/renderer/lib/client.ts`:

```typescript
async getFileTree(projectId: string, dirPath = '.'): Promise<FileEntry[]> {
  const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/tree?path=${encodeURIComponent(dirPath)}`);
  return res.json();
}

async getFileContent(projectId: string, filePath: string): Promise<{ path: string; content: string }> {
  const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`);
  return res.json();
}

async getGitStatus(projectId: string): Promise<{ files: { status: string; path: string }[] }> {
  const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/git/status`);
  return res.json();
}

async getDiff(projectId: string, file: string, source: 'git' | 'session' = 'git', chatId?: string): Promise<{ original: string; modified: string; diff: string; source: string }> {
  const params = new URLSearchParams({ file, source });
  if (chatId) params.set('chatId', chatId);
  const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/diff?${params}`);
  return res.json();
}

async getSessionChanges(chatId: string): Promise<{ files: string[] }> {
  const res = await fetch(`${this.baseUrl}/api/chats/${chatId}/changes`);
  return res.json();
}
```

**Step 5: Build to verify**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add packages/types/src/chat.ts packages/core/src/chat-manager.ts packages/core/src/server/http.ts packages/desktop/src/renderer/lib/client.ts
git commit -m "feat: add file tree, dual-source diff, and session change tracking APIs"
```

---

### Task 10: Implement functional right panel — Context tab

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/ContextTab.tsx`

**Step 1: Implement the Context tab content**

The Context tab shows configuration files relevant to the project. Default files are `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, but in the future the daemon may return session-specific context via `Chat.contextFiles`. For now, use a default list and fall back to the Chat's `contextFiles` if available:

```tsx
import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useProjectsStore, useChatsStore } from '../../store';
import { daemonClient } from '../../lib/client';
import { ScrollArea } from '../ui/scroll-area';

const DEFAULT_CONTEXT_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json'];

export function ContextTab(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const { activeChatId, chats } = useChatsStore();
  const activeChat = chats.find((c) => c.id === activeChatId);
  const [contextFiles, setContextFiles] = useState<{ path: string; content: string }[]>([]);

  // Use session-specific context files if available, otherwise defaults
  const filesToLoad = activeChat?.contextFiles?.length ? activeChat.contextFiles : DEFAULT_CONTEXT_FILES;

  useEffect(() => {
    if (!activeProjectId) return;
    Promise.all(
      filesToLoad.map(async (filePath) => {
        try {
          const result = await daemonClient.getFileContent(activeProjectId, filePath);
          return result;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      setContextFiles(results.filter((r): r is { path: string; content: string } => r !== null));
    });
  }, [activeProjectId]);

  if (contextFiles.length === 0) {
    return (
      <div className="text-mf-small text-mf-text-secondary text-center py-4">
        No context files found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contextFiles.map((file) => (
        <details key={file.path} className="group">
          <summary className="flex items-center gap-2 px-2 py-1.5 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-body text-mf-text-primary">
            <FileText size={14} className="text-mf-text-secondary shrink-0" />
            {file.path}
          </summary>
          <pre className="mt-1 p-2 rounded-mf-input bg-mf-input-bg text-mf-small text-mf-text-secondary overflow-x-auto max-h-[200px] overflow-y-auto">
            {file.content}
          </pre>
        </details>
      ))}
    </div>
  );
}
```

**Step 2: Build to verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/RightPanel.tsx
git commit -m "feat(desktop): implement functional Context tab in right panel"
```

---

### Task 11: Implement functional right panel — Files tab (navigation only, opens in center panel)

The Files tab is a **navigation panel** — it displays the project file tree but does NOT show file content inline. Clicking a file opens an **editor tab in the center panel** via `useTabsStore.openEditorTab(filePath)`.

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`
- Modify: `packages/desktop/src/renderer/components/center/EditorTab.tsx` — full implementation (was a stub from Task 6)

**Step 1: Create FilesTab component**

Create `packages/desktop/src/renderer/components/panels/FilesTab.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { useProjectsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { cn } from '../../lib/utils';
import { ScrollArea } from '../ui/scroll-area';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
}

function FileTreeNode({ entry, depth }: FileTreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const { activeProjectId } = useProjectsStore();
  const { openEditorTab } = useTabsStore();

  const handleClick = async (): Promise<void> => {
    if (entry.type === 'directory') {
      if (!expanded && children.length === 0 && activeProjectId) {
        const entries = await daemonClient.getFileTree(activeProjectId, entry.path);
        setChildren(entries);
      }
      setExpanded(!expanded);
    } else {
      // Open file in center panel as an editor tab
      openEditorTab(entry.path);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-1 py-1 px-2 text-mf-small hover:bg-mf-hover/50 rounded-mf-input text-left"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {entry.type === 'directory' ? (
          <>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Folder size={14} className="text-mf-accent-claude shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText size={14} className="text-mf-text-secondary shrink-0" />
          </>
        )}
        <span className={cn('truncate', entry.type === 'file' ? 'text-mf-text-secondary' : 'text-mf-text-primary')}>
          {entry.name}
        </span>
      </button>
      {expanded && children.map((child) => (
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function FilesTab(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!activeProjectId) return;
    daemonClient.getFileTree(activeProjectId).then(setRootEntries).catch(() => {});
  }, [activeProjectId]);

  if (rootEntries.length === 0) {
    return (
      <div className="text-mf-small text-mf-text-secondary text-center py-4">
        {activeProjectId ? 'Loading...' : 'No project selected'}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {rootEntries.map((entry) => (
          <FileTreeNode key={entry.path} entry={entry} depth={0} />
        ))}
      </div>
    </ScrollArea>
  );
}
```

Note: `FilesTab` takes no callback props — it calls `useTabsStore.openEditorTab()` directly.

**Step 2: Implement EditorTab in center panel**

Replace the stub in `packages/desktop/src/renderer/components/center/EditorTab.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { daemonClient } from '../../lib/client';
import { MonacoEditor } from '../editor/MonacoEditor';

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sh: 'shell', bash: 'shell', sql: 'sql',
  };
  return map[ext || ''] || 'plaintext';
}

export function EditorTab({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setContent(null);
    setError(null);
    daemonClient.getFileContent(activeProjectId, filePath)
      .then((result) => setContent(result.content))
      .catch(() => setError('Failed to load file'));
  }, [activeProjectId, filePath]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
        {error}
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
        Loading...
      </div>
    );
  }

  return <MonacoEditor value={content} language={inferLanguage(filePath)} readOnly />;
}
```

**Step 3: Build to verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx packages/desktop/src/renderer/components/center/EditorTab.tsx
git commit -m "feat(desktop): implement Files tab navigation and EditorTab in center panel"
```

---

### Task 12: Implement functional right panel — Changes tab (navigation only, opens diffs in center panel)

The Changes tab is a **navigation panel** — it lists files with uncommitted changes (git status) but does NOT show diffs inline. Clicking a changed file opens a **diff tab in the center panel** via `useTabsStore.openDiffTab(filePath, source)`. The source can be `'git'` (default from Changes tab) or `'session'` (from AI message diffs in the future).

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/ChangesTab.tsx`
- Modify: `packages/desktop/src/renderer/components/center/DiffTab.tsx` — full implementation (was a stub from Task 6)

**Step 1: Create ChangesTab component**

Create `packages/desktop/src/renderer/components/panels/ChangesTab.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useProjectsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

interface GitFile {
  status: string;
  path: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  M: { label: 'Modified', color: 'text-mf-warning' },
  A: { label: 'Added', color: 'text-mf-success' },
  D: { label: 'Deleted', color: 'text-mf-destructive' },
  '?': { label: 'Untracked', color: 'text-mf-text-secondary' },
  R: { label: 'Renamed', color: 'text-blue-400' },
};

export function ChangesTab(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const { openDiffTab } = useTabsStore();
  const [files, setFiles] = useState<GitFile[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const result = await daemonClient.getGitStatus(activeProjectId);
      setFiles(result.files);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [activeProjectId]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-mf-label text-mf-text-secondary">
          {files.length} changed file{files.length !== 1 ? 's' : ''}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refresh} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {files.length === 0 ? (
          <div className="text-mf-small text-mf-text-secondary text-center py-4">
            No uncommitted changes
          </div>
        ) : (
          <div className="space-y-0.5 px-1">
            {files.map((file) => {
              const info = statusLabels[file.status] || { label: file.status, color: 'text-mf-text-secondary' };
              return (
                <button
                  key={file.path}
                  onClick={() => openDiffTab(file.path, 'git')}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-mf-input hover:bg-mf-hover/50 text-left"
                >
                  <FileText size={14} className="text-mf-text-secondary shrink-0" />
                  <span className="flex-1 text-mf-small text-mf-text-primary truncate">
                    {file.path}
                  </span>
                  <span className={cn('text-mf-status font-medium shrink-0', info.color)}>
                    {info.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
```

Note: `ChangesTab` takes no callback props — it calls `useTabsStore.openDiffTab(filePath, 'git')` directly.

**Step 2: Implement DiffTab in center panel**

Replace the stub in `packages/desktop/src/renderer/components/center/DiffTab.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { daemonClient } from '../../lib/client';
import { MonacoDiffEditor } from '../editor/MonacoDiffEditor';

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sh: 'shell', bash: 'shell', sql: 'sql',
  };
  return map[ext || ''] || 'plaintext';
}

interface DiffTabProps {
  filePath: string;
  source: 'git' | 'session';
  chatId?: string;
}

export function DiffTab({ filePath, source, chatId }: DiffTabProps): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const [original, setOriginal] = useState<string | null>(null);
  const [modified, setModified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setOriginal(null);
    setModified(null);
    setError(null);

    daemonClient.getDiff(activeProjectId, filePath, source, chatId)
      .then((result) => {
        setOriginal(result.original);
        setModified(result.modified);
      })
      .catch(() => setError('Failed to load diff'));
  }, [activeProjectId, filePath, source, chatId]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
        {error}
      </div>
    );
  }

  if (original === null || modified === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
        Loading diff...
      </div>
    );
  }

  return (
    <MonacoDiffEditor
      original={original}
      modified={modified}
      language={inferLanguage(filePath)}
    />
  );
}
```

The `source` prop determines which API endpoint to hit:
- `'git'` — `GET /api/projects/:id/diff?file=path&source=git` returns original (HEAD) + modified (disk)
- `'session'` — `GET /api/projects/:id/diff?file=path&source=session&chatId=X` returns original (HEAD) + modified (disk) for files the AI changed in that session

**Step 3: Build to verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ChangesTab.tsx packages/desktop/src/renderer/components/center/DiffTab.tsx
git commit -m "feat(desktop): implement Changes tab navigation and DiffTab in center panel"
```

---

### Task 13: Assemble the final RightPanel as navigation-only panel

The right panel is **navigation-only** — it contains three tabs (Context, Files, Changes) that list items and open content in the center panel. There are NO inline Monaco previews or content viewers in the right panel itself.

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/RightPanel.tsx`

**Step 1: Rewrite RightPanel to compose all navigation tabs**

```tsx
import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ContextTab } from './ContextTab';
import { FilesTab } from './FilesTab';
import { ChangesTab } from './ChangesTab';

export function RightPanel(): React.ReactElement {
  return (
    <Tabs defaultValue="context" className="h-full flex flex-col">
      <TabsList className="p-[10px] pb-2 bg-transparent justify-start gap-1 shrink-0">
        <TabsTrigger value="context" className="text-mf-small">Context</TabsTrigger>
        <TabsTrigger value="files" className="text-mf-small">Files</TabsTrigger>
        <TabsTrigger value="changes" className="text-mf-small">Changes</TabsTrigger>
      </TabsList>

      <TabsContent value="context" className="flex-1 overflow-y-auto px-[10px] mt-0">
        <ContextTab />
      </TabsContent>

      <TabsContent value="files" className="flex-1 overflow-hidden mt-0 px-[10px]">
        <FilesTab />
      </TabsContent>

      <TabsContent value="changes" className="flex-1 overflow-hidden mt-0">
        <ChangesTab />
      </TabsContent>
    </Tabs>
  );
}
```

Note how clean this is: `RightPanel` has no state, no preview logic, no Monaco imports. Each tab component (`FilesTab`, `ChangesTab`) calls `useTabsStore` directly to open editor/diff tabs in the center panel. `ContextTab` shows context file summaries inline (expandable `<details>` blocks) — it doesn't need to open center panel tabs since its content is small metadata.

**Step 2: Build to verify**

Run: `pnpm build`

**Step 3: Visual verification**

Run: `pnpm --filter @mainframe/desktop dev`
- Verify all three tabs render in the right panel
- Verify Context tab loads project context files with expandable previews
- Verify Files tab shows directory tree with expand/collapse; clicking a file opens an editor tab in the center panel
- Verify Changes tab shows git status; clicking a changed file opens a diff tab in the center panel
- Verify center panel tab bar shows open tabs and allows switching/closing

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/RightPanel.tsx
git commit -m "feat(desktop): assemble navigation-only right panel with Context, Files, and Changes tabs"
```

---

## Task Dependency Graph

```
Task 1 ─┐
Task 2 ─┤ (spec fixes, independent of each other)
Task 3 ─┘
         │
Task 4 ──┤ (shadcn init)
         │
Task 5 ──┤ (migrate existing to shadcn, depends on Task 4)
         │
Task 6 ──┤ (center panel tab system, depends on Task 5 for Button/ScrollArea)
Task 7 ──┤ (left panel agents, depends on Task 5 for Tabs)
         │
Task 8 ──┤ (Monaco install, independent of Tasks 5-7)
         │
Task 9 ──┤ (daemon APIs, independent of Tasks 5-8)
         │
Task 10 ─┤ (Context tab, depends on Task 9)
Task 11 ─┤ (Files tab → opens EditorTab in center panel, depends on Tasks 6 + 8 + 9)
Task 12 ─┤ (Changes tab → opens DiffTab in center panel, depends on Tasks 6 + 8 + 9)
Task 13 ─┘ (assemble navigation-only right panel, depends on Tasks 10-12)
```

Tasks 1-3 can run in parallel. Tasks 6-7 can run in parallel. Task 8 and Task 9 can run in parallel. Tasks 10-12 can run in parallel after their deps. Task 11 and 12 both depend on Task 6 (center panel tab system) because they call `useTabsStore.openEditorTab()` and `useTabsStore.openDiffTab()` respectively.
