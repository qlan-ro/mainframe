# Mobile Context Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline autocomplete to the mobile composer for `/commands`, `/skills`, `@files`, and `@agents` — matching desktop feature parity.

**Architecture:** A `useContextPicker` hook detects `/` and `@` triggers from the TextInput text, fetches matching items from existing daemon REST endpoints, and surfaces them via a `ContextPickerList` overlay rendered above the composer. On item selection, the trigger token is replaced in the text. On send, command metadata is attached to the WS event.

**Tech Stack:** React Native, Zustand, expo-router, existing daemon REST API

---

### Task 1: Add API Functions

**Files:**
- Modify: `packages/mobile/lib/api.ts`

**Step 1: Add the four new API functions**

```typescript
// After existing imports, add:
import type { CustomCommand, Skill, AgentConfig } from '@qlan-ro/mainframe-types';

// After existing exports, add:

export const getCommands = () => fetchJson<CustomCommand[]>('/api/commands');

export const getSkills = (adapterId: string, projectPath: string) =>
  fetchJson<Skill[]>(
    `/api/adapters/${encodeURIComponent(adapterId)}/skills?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const getAgents = (adapterId: string, projectPath: string) =>
  fetchJson<AgentConfig[]>(
    `/api/adapters/${encodeURIComponent(adapterId)}/agents?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const searchFiles = (projectId: string, query: string, limit = 20) =>
  fetchJson<{ name: string; path: string; type: string }[]>(
    `/api/projects/${projectId}/search/files?q=${encodeURIComponent(query)}&limit=${limit}`,
  );

export const addMention = (chatId: string, kind: 'file' | 'agent', name: string, path?: string) =>
  postJson(`/api/chats/${chatId}/mentions`, { kind, name, path });
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep api.ts`
Expected: No errors from api.ts

**Step 3: Commit**

```bash
git add packages/mobile/lib/api.ts
git commit -m "feat(mobile): add commands, skills, agents, file search API functions"
```

---

### Task 2: Update DaemonClient and useChatSession for Command Metadata

**Files:**
- Modify: `packages/mobile/lib/daemon-client.ts`
- Modify: `packages/mobile/hooks/useChatSession.ts`

**Step 1: Add metadata param to DaemonClient.sendMessage**

In `packages/mobile/lib/daemon-client.ts`, update `sendMessage`:

```typescript
sendMessage(
  chatId: string,
  content: string,
  attachmentIds?: string[],
  metadata?: { command?: { name: string; source: string; args?: string } },
): void {
  this.send({ type: 'message.send', chatId, content, attachmentIds, metadata });
}
```

**Step 2: Update useChatSession.sendMessage to accept and forward metadata**

In `packages/mobile/hooks/useChatSession.ts`, update the `sendMessage` callback:

```typescript
const sendMessage = useCallback(
  async (
    content: string,
    images?: SelectedImage[],
    metadata?: { command?: { name: string; source: string; args?: string } },
  ) => {
    let attachmentIds: string[] | undefined;
    if (images?.length) {
      try {
        const uploaded = await uploadAttachments(
          chatId,
          images.map((img) => ({
            name: img.name,
            mediaType: img.mediaType,
            data: img.base64,
          })),
        );
        attachmentIds = uploaded.map((a) => a.id);
      } catch (err) {
        console.warn('[useChatSession] attachment upload failed:', err);
      }
    }
    daemonClient.sendMessage(chatId, content, attachmentIds, metadata);
  },
  [chatId],
);
```

**Step 3: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep -E "(daemon-client|useChatSession)"`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/mobile/lib/daemon-client.ts packages/mobile/hooks/useChatSession.ts
git commit -m "feat(mobile): forward command metadata through sendMessage chain"
```

---

### Task 3: Create useContextPicker Hook

**Files:**
- Create: `packages/mobile/hooks/useContextPicker.ts`

**Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCommands, getSkills, getAgents, searchFiles } from '../lib/api';
import type { CustomCommand, Skill, AgentConfig } from '@qlan-ro/mainframe-types';

export type PickerItem =
  | { type: 'skill'; name: string; displayName: string; invocationName: string; description: string; scope: string; source: string }
  | { type: 'command'; name: string; description: string; source: string }
  | { type: 'file'; name: string; path: string }
  | { type: 'agent'; name: string; description: string; scope: string };

export type FilterMode = 'skills' | 'agents-files' | null;

interface UseContextPickerOptions {
  text: string;
  chatId: string;
  projectId: string | undefined;
  projectPath: string | undefined;
  adapterId: string | undefined;
}

interface UseContextPickerResult {
  isOpen: boolean;
  items: PickerItem[];
  filterMode: FilterMode;
  triggerQuery: string;
  selectItem: (item: PickerItem) => string; // returns new text with item inserted
  close: () => void;
}

export function useContextPicker({
  text,
  chatId,
  projectId,
  projectPath,
  adapterId,
}: UseContextPickerOptions): UseContextPickerResult {
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [fileResults, setFileResults] = useState<{ name: string; path: string }[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const fetchedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch commands + skills + agents once per session
  useEffect(() => {
    if (fetchedRef.current || !adapterId || !projectPath) return;
    fetchedRef.current = true;
    getCommands().then(setCommands).catch(() => {});
    getSkills(adapterId, projectPath).then(setSkills).catch(() => {});
    getAgents(adapterId, projectPath).then(setAgents).catch(() => {});
  }, [adapterId, projectPath]);

  // Detect trigger
  const slashMatch = text.match(/^\/(\S*)$/);
  const atMatch = !slashMatch ? text.match(/(?:^|\s)@(\S*)$/) : null;

  const filterMode: FilterMode = slashMatch ? 'skills' : atMatch ? 'agents-files' : null;
  const triggerQuery = slashMatch?.[1] ?? atMatch?.[1] ?? '';
  const isOpen = filterMode !== null && !dismissed;

  // Reset dismissed when trigger changes
  useEffect(() => {
    setDismissed(false);
  }, [filterMode]);

  // Debounced file search for @ trigger
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (filterMode !== 'agents-files' || !projectId || triggerQuery.length < 1) {
      setFileResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchFiles(projectId, triggerQuery, 20)
        .then(setFileResults)
        .catch(() => setFileResults([]));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filterMode, triggerQuery, projectId]);

  // Filter items
  const items = useMemo<PickerItem[]>(() => {
    const q = triggerQuery.toLowerCase();

    if (filterMode === 'skills') {
      const skillItems: PickerItem[] = skills
        .filter((s) => {
          const inv = s.invocationName ?? s.name;
          return inv.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q);
        })
        .slice(0, 10)
        .map((s) => ({
          type: 'skill',
          name: s.name,
          displayName: s.displayName,
          invocationName: s.invocationName ?? s.name,
          description: s.description,
          scope: s.scope,
          source: s.adapterId,
        }));
      const cmdItems: PickerItem[] = commands
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map((c) => ({
          type: 'command',
          name: c.name,
          description: c.description,
          source: c.source,
        }));
      return [...cmdItems, ...skillItems];
    }

    if (filterMode === 'agents-files') {
      const agentItems: PickerItem[] = agents
        .filter((a) => a.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map((a) => ({
          type: 'agent',
          name: a.name,
          description: a.description,
          scope: a.scope,
        }));
      const fileItems: PickerItem[] = fileResults.slice(0, 15).map((f) => ({
        type: 'file',
        name: f.name,
        path: f.path,
      }));
      return [...agentItems, ...fileItems];
    }

    return [];
  }, [filterMode, triggerQuery, skills, commands, agents, fileResults]);

  const selectItem = useCallback(
    (item: PickerItem): string => {
      if (filterMode === 'skills') {
        const token = item.type === 'skill' ? (item as Extract<PickerItem, { type: 'skill' }>).invocationName : item.name;
        return `/${token} `;
      }
      if (filterMode === 'agents-files') {
        const token = item.type === 'file' ? (item as Extract<PickerItem, { type: 'file' }>).path : item.name;
        // Replace the @query at end of text with @token
        const beforeTrigger = text.replace(/(?:^|\s)@\S*$/, (match) => {
          const leading = match.startsWith(' ') ? ' ' : '';
          return `${leading}@${token} `;
        });
        return beforeTrigger;
      }
      return text;
    },
    [filterMode, text],
  );

  const close = useCallback(() => setDismissed(true), []);

  return { isOpen, items, filterMode, triggerQuery, selectItem, close };
}
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep useContextPicker`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/mobile/hooks/useContextPicker.ts
git commit -m "feat(mobile): add useContextPicker hook for trigger detection and filtering"
```

---

### Task 4: Create ContextPickerList Component

**Files:**
- Create: `packages/mobile/components/chat/ContextPickerList.tsx`

**Step 1: Create the component**

```tsx
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Zap, Wrench, FileText, Bot } from 'lucide-react-native';
import type { PickerItem } from '../../hooks/useContextPicker';

interface ContextPickerListProps {
  items: PickerItem[];
  onSelect: (item: PickerItem) => void;
}

const ICON_MAP = {
  skill: { Icon: Zap, color: '#f97312' },
  command: { Icon: Wrench, color: '#a1a1aa' },
  file: { Icon: FileText, color: '#60a5fa' },
  agent: { Icon: Bot, color: '#a78bfa' },
} as const;

function PickerRow({ item, onSelect }: { item: PickerItem; onSelect: () => void }) {
  const { Icon, color } = ICON_MAP[item.type];
  const label =
    item.type === 'skill'
      ? `/${item.invocationName}`
      : item.type === 'command'
        ? `/${item.name}`
        : item.type === 'file'
          ? item.path
          : `@${item.name}`;
  const badge =
    item.type === 'skill' || item.type === 'agent' ? item.scope : item.type === 'command' ? item.source : null;
  const desc = item.type !== 'file' ? item.description : undefined;

  return (
    <TouchableOpacity
      onPress={onSelect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
      }}
      activeOpacity={0.6}
    >
      <Icon color={color} size={16} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'monospace' }} numberOfLines={1}>
            {label}
          </Text>
          {badge && (
            <View
              style={{
                backgroundColor: '#ffffff14',
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: '#ffffff60', fontSize: 10 }}>{badge}</Text>
            </View>
          )}
        </View>
        {desc ? (
          <Text style={{ color: '#ffffff50', fontSize: 12 }} numberOfLines={1}>
            {desc}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export function ContextPickerList({ items, onSelect }: ContextPickerListProps) {
  if (items.length === 0) return null;

  return (
    <View
      style={{
        maxHeight: 220,
        marginHorizontal: 16,
        marginBottom: 4,
        borderRadius: 14,
        backgroundColor: '#1e1f22',
        borderWidth: 0.5,
        borderColor: '#ffffff18',
        overflow: 'hidden',
      }}
    >
      <FlatList
        data={items}
        keyExtractor={(item, idx) => `${item.type}-${item.name}-${idx}`}
        renderItem={({ item }) => <PickerRow item={item} onSelect={() => onSelect(item)} />}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep ContextPickerList`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/mobile/components/chat/ContextPickerList.tsx
git commit -m "feat(mobile): add ContextPickerList dropdown component"
```

---

### Task 5: Integrate Context Picker into Composer

**Files:**
- Modify: `packages/mobile/components/chat/Composer.tsx`

**Step 1: Update ComposerProps and integrate the picker**

Add to imports:

```typescript
import { ContextPickerList } from './ContextPickerList';
import { useContextPicker } from '../../hooks/useContextPicker';
import type { PickerItem } from '../../hooks/useContextPicker';
```

Update props interface:

```typescript
interface ComposerProps {
  onSend: (
    text: string,
    images: SelectedImage[],
    metadata?: { command?: { name: string; source: string; args?: string } },
  ) => void;
  disabled?: boolean;
  chatId: string;
  projectId?: string;
  projectPath?: string;
  adapterId?: string;
}
```

Inside `Composer` function, add the picker hook after existing state:

```typescript
const picker = useContextPicker({
  text,
  chatId,
  projectId,
  projectPath,
  adapterId,
});

const handleSelectItem = useCallback(
  (item: PickerItem) => {
    const newText = picker.selectItem(item);
    setText(newText);
  },
  [picker],
);
```

Update `handleSend` to parse command metadata:

```typescript
const handleSend = () => {
  if (!hasContent) return;
  const trimmed = text.trim();

  // Parse /command metadata
  let metadata: { command?: { name: string; source: string; args?: string } } | undefined;
  const cmdMatch = trimmed.match(/^\/(\S+)/);
  if (cmdMatch) {
    const name = cmdMatch[1]!;
    // Check if it's a known command or skill from the picker's cached data
    const matchedItem = picker.items.find(
      (i) =>
        (i.type === 'command' && i.name === name) ||
        (i.type === 'skill' && i.invocationName === name),
    );
    if (matchedItem) {
      metadata = {
        command: {
          name,
          source: matchedItem.type === 'command' ? matchedItem.source : matchedItem.source,
          args: trimmed.slice(cmdMatch[0]!.length).trim() || undefined,
        },
      };
    }
  }

  onSend(trimmed, images, metadata);
  setText('');
  setImages([]);
};
```

Render `ContextPickerList` just above the `KeyboardAvoidingView`, inside the `<>` fragment:

```tsx
<>
  {picker.isOpen && (
    <ContextPickerList items={picker.items} onSelect={handleSelectItem} />
  )}
  <KeyboardAvoidingView ...>
    {/* existing content */}
  </KeyboardAvoidingView>
  <AttachmentSheet ... />
</>
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep Composer`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/mobile/components/chat/Composer.tsx
git commit -m "feat(mobile): integrate context picker into composer"
```

---

### Task 6: Wire Up Chat Screen with Project Context

**Files:**
- Modify: `packages/mobile/app/chat/[chatId].tsx`

**Step 1: Pass project context to Composer**

```tsx
import { useProjectsStore } from '../../store/projects';

export default function ChatDetailScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === chat?.projectId));

  const { messages, pendingPermission, sendMessage, respondToPermission, interrupt } =
    useChatSession(chatId!);

  const isWorking = chat?.processState === 'working';

  return (
    <View className="flex-1 bg-mf-app-bg">
      <ChatHeader chat={chat} isWorking={isWorking} onInterrupt={interrupt} />
      <MessageList messages={messages} chatAdapterId={chat?.adapterId} />
      {pendingPermission && (
        <PermissionCardRouter request={pendingPermission} onRespond={respondToPermission} />
      )}
      <Composer
        onSend={sendMessage}
        disabled={isWorking}
        chatId={chatId!}
        projectId={chat?.projectId}
        projectPath={project?.path}
        adapterId={chat?.adapterId}
      />
    </View>
  );
}
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep "\[chatId\]"`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/mobile/app/chat/[chatId].tsx
git commit -m "feat(mobile): pass project context to Composer for context picker"
```

---

### Task 7: Register @mentions on Send

**Files:**
- Modify: `packages/mobile/hooks/useChatSession.ts`

**Step 1: Add mention registration after send**

Update imports:

```typescript
import { uploadAttachments, addMention } from '../lib/api';
```

After `daemonClient.sendMessage(...)` in the `sendMessage` callback, add mention registration:

```typescript
// Register @mentions with the daemon
const mentionMatches = content.matchAll(/(?:^|\s)@(\S+)/g);
for (const m of mentionMatches) {
  const ref = m[1];
  if (!ref) continue;
  const cleaned = ref.replace(/[,;:!?)]+$/, '');
  if (cleaned.includes('/') || cleaned.includes('.')) {
    addMention(chatId, 'file', cleaned.split('/').pop() ?? cleaned, cleaned).catch(() => {});
  } else {
    addMention(chatId, 'agent', cleaned).catch(() => {});
  }
}
```

**Step 2: Verify types compile**

Run: `cd packages/mobile && npx tsc --noEmit 2>&1 | grep useChatSession`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/mobile/hooks/useChatSession.ts
git commit -m "feat(mobile): register @mentions on message send"
```

---

### Task 8: Final Integration Test

**Step 1: Verify full typecheck**

Run: `cd packages/mobile && npx tsc --noEmit`
Expected: Only pre-existing errors (AssistantMessage.tsx, notifications.ts), no new errors.

**Step 2: Manual testing checklist**

- [ ] Type `/` in empty composer → skills + commands appear in dropdown
- [ ] Type `/bra` → filters to brainstorming skill
- [ ] Tap a skill → inserts `/skillName ` into composer
- [ ] Type `@` → agents appear, then file results as you type more
- [ ] Type `@src/` → file search results appear
- [ ] Tap a file → inserts `@path/to/file ` into composer
- [ ] Send a `/command` message → verify `metadata.command` is attached (check daemon logs)
- [ ] Send a message with `@file.ts` → verify mention is registered (check daemon logs)
- [ ] The `+` button still opens the attachment sheet
- [ ] Attachment flow still works end-to-end

**Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(mobile): complete context picker integration"
```
