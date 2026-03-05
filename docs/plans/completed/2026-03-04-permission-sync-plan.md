# Permission Sync & Mobile Permission UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-client permission sync (so resolving on one client clears the other) and build full-parity mobile permission cards (AskUserQuestion, PlanApproval, enhanced ToolPermission).

**Architecture:** New `permission.resolved` daemon event broadcast after response processing. requestId guard prevents double-response race. Three mobile card components matching desktop patterns, routed by `toolName`.

**Tech Stack:** TypeScript, Zustand, React Native, Vitest

---

### Task 1: Add `permission.resolved` event type

**Files:**
- Modify: `packages/types/src/events.ts:19`

**Step 1: Add the type to DaemonEvent union**

In `packages/types/src/events.ts`, add after the `permission.requested` line (line 19):

```typescript
| { type: 'permission.resolved'; chatId: string; requestId: string }
```

**Step 2: Build types package**

Run: `pnpm --filter @mainframe/types build`
Expected: clean build

**Step 3: Commit**

```
feat(types): add permission.resolved event type
```

---

### Task 2: Add requestId guard + emit `permission.resolved` in daemon

**Files:**
- Modify: `packages/core/src/chat/permission-manager.ts:15-18`
- Modify: `packages/core/src/chat/permission-handler.ts:27-56,107-120`
- Test: `packages/core/src/__tests__/permission-flow.test.ts`

**Step 1: Add `matchesPending` to PermissionManager**

In `packages/core/src/chat/permission-manager.ts`, add after `hasPending` (line 24):

```typescript
matchesPending(chatId: string, requestId: string): boolean {
  const front = this.pendingPermissions.get(chatId)?.[0];
  return front !== undefined && front.requestId === requestId;
}
```

**Step 2: Add requestId guard in permission-handler.ts**

In `packages/core/src/chat/permission-handler.ts`, at the top of `respondToPermission` (after getting `active`, around line 28), add guard before the no-session check:

```typescript
async respondToPermission(chatId: string, response: ControlResponse): Promise<void> {
  const active = this.deps.getActiveChat(chatId);

  // Guard: reject stale/duplicate responses
  if (active?.session?.isSpawned && !this.deps.permissions.matchesPending(chatId, response.requestId)) {
    log.warn(
      { chatId, requestId: response.requestId },
      'respondToPermission: requestId does not match pending, ignoring stale response',
    );
    return;
  }

  // ... rest of existing method unchanged
```

Note: Only guard when session is spawned — the no-session path (line 30-36) handles daemon-restart scenarios where requestId may be empty.

**Step 3: Emit `permission.resolved` in handleNormalPermission**

In `packages/core/src/chat/permission-handler.ts`, in `handleNormalPermission` (line 107), after `respondToPermission` and before `shift`:

```typescript
private async handleNormalPermission(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
  if (!active.session) throw new Error(`No session for chat ${chatId}`);

  await active.session.respondToPermission(response);

  // Notify all clients this permission was resolved
  this.deps.emitEvent({ type: 'permission.resolved', chatId, requestId: response.requestId });

  const nextRequest = this.deps.permissions.shift(chatId);
  if (nextRequest) {
    this.deps.emitEvent({ type: 'permission.requested', chatId, request: nextRequest });
  }

  if (response.behavior === 'allow' && response.toolName === 'ExitPlanMode') {
    await this.deps.planMode.handleEscalation(chatId, active, response);
  }
}
```

**Step 4: Write tests for requestId guard and permission.resolved**

Add to `packages/core/src/__tests__/permission-flow.test.ts`:

```typescript
it('emits permission.resolved when permission is answered', async () => {
  const adapter = new MockAdapter();
  const { httpServer } = createStack(adapter, 'default');
  server = httpServer;
  const port = await startServer(server);
  ws = await connectWs(port);
  ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
  await sleep(100);

  const resolvedEvents: DaemonEvent[] = [];
  ws.on('message', (data) => {
    const e = JSON.parse(data.toString()) as DaemonEvent;
    if (e.type === 'permission.resolved') resolvedEvents.push(e);
  });

  adapter.currentSession!.simulatePermission(
    makePermissionRequest('Bash', { requestId: 'req-99', toolUseId: 'tu-99' }),
  );
  await sleep(50);

  ws!.send(
    JSON.stringify({
      type: 'permission.respond',
      chatId: 'test-chat',
      response: { requestId: 'req-99', toolUseId: 'tu-99', toolName: 'Bash', behavior: 'allow' },
    }),
  );
  await sleep(50);

  expect(resolvedEvents).toHaveLength(1);
  expect((resolvedEvents[0] as any).requestId).toBe('req-99');
}, 10_000);

it('rejects stale permission response with mismatched requestId', async () => {
  const adapter = new MockAdapter();
  const { httpServer } = createStack(adapter, 'default');
  server = httpServer;
  const port = await startServer(server);
  ws = await connectWs(port);
  ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
  await sleep(100);

  adapter.currentSession!.simulatePermission(
    makePermissionRequest('Bash', { requestId: 'req-current', toolUseId: 'tu-1' }),
  );
  await sleep(50);

  // Send response with wrong requestId
  ws!.send(
    JSON.stringify({
      type: 'permission.respond',
      chatId: 'test-chat',
      response: { requestId: 'req-stale', toolUseId: 'tu-old', toolName: 'Bash', behavior: 'allow' },
    }),
  );
  await sleep(50);

  // Should NOT have forwarded to adapter
  expect(adapter.respondToPermissionSpy).not.toHaveBeenCalled();
}, 10_000);
```

**Step 5: Run tests**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/permission-flow.test.ts`
Expected: all tests pass

**Step 6: Commit**

```
feat(core): requestId guard + permission.resolved event

Prevent double-response race when multiple clients respond to the same
permission simultaneously. Emit permission.resolved so other clients
can clear stale permission cards.
```

---

### Task 3: Handle `permission.resolved` in desktop event router

**Files:**
- Modify: `packages/desktop/src/renderer/lib/ws-event-router.ts:49-56`

**Step 1: Add handler after `permission.requested` case**

In `packages/desktop/src/renderer/lib/ws-event-router.ts`, add after the `permission.requested` case (line 56):

```typescript
case 'permission.resolved': {
  log.info('event:permission.resolved', { chatId: event.chatId, requestId: event.requestId });
  const current = chats.pendingPermissions.get(event.chatId);
  if (current?.requestId === event.requestId) {
    chats.removePendingPermission(event.chatId);
  }
  break;
}
```

**Step 2: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`
Expected: clean build

**Step 3: Commit**

```
feat(desktop): handle permission.resolved for cross-client sync
```

---

### Task 4: Handle `permission.resolved` in mobile event router

**Files:**
- Modify: `packages/mobile/lib/event-router.ts:36-38`

**Step 1: Add handler after `permission.requested` case**

In `packages/mobile/lib/event-router.ts`, add after the `permission.requested` case (line 38):

```typescript
case 'permission.resolved': {
  const store = useChatsStore.getState();
  const current = store.pendingPermissions.get(event.chatId);
  if (current?.requestId === event.requestId) {
    store.removePendingPermission(event.chatId);
  }
  break;
}
```

**Step 2: Commit**

```
feat(mobile): handle permission.resolved for cross-client sync
```

---

### Task 5: Enhance mobile `respondToPermission` callback

**Files:**
- Modify: `packages/mobile/hooks/useChatSession.ts:43-53`

**Step 1: Expand the callback signature**

Replace the `respondToPermission` callback in `packages/mobile/hooks/useChatSession.ts`:

```typescript
const respondToPermission = useCallback(
  (
    behavior: 'allow' | 'deny',
    alwaysAllow?: import('@mainframe/types').ControlUpdate[],
    overrideInput?: Record<string, unknown>,
    message?: string,
    executionMode?: string,
    clearContext?: boolean,
  ) => {
    if (!pendingPermission) return;
    daemonClient.send({
      type: 'permission.respond',
      chatId,
      response: {
        requestId: pendingPermission.requestId,
        toolUseId: pendingPermission.toolUseId,
        toolName: pendingPermission.toolName,
        behavior,
        updatedInput: overrideInput ?? pendingPermission.input,
        updatedPermissions: alwaysAllow,
        message,
        executionMode: executionMode as 'default' | 'acceptEdits' | 'yolo' | undefined,
        clearContext,
      },
    });
    useChatsStore.getState().removePendingPermission(chatId);
  },
  [chatId, pendingPermission],
);
```

**Step 2: Update the return type**

The hook return type changes. Update the `ControlResponse` import to also import `ControlUpdate`:

```typescript
import type { ControlResponse, ControlUpdate, DisplayMessage } from '@mainframe/types';
```

Remove `ControlResponse` from the import if it's no longer used directly (the callback now takes individual params instead of a full `ControlResponse` object).

**Step 3: Commit**

```
feat(mobile): expand respondToPermission to full desktop-parity signature
```

---

### Task 6: Enhance mobile ToolPermissionCard

**Files:**
- Modify: `packages/mobile/components/chat/PermissionCard.tsx`

**Step 1: Rewrite PermissionCard with expanded functionality**

Replace the contents of `packages/mobile/components/chat/PermissionCard.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable } from 'react-native';
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { ControlRequest, ControlUpdate } from '@mainframe/types';

interface PermissionCardProps {
  request: ControlRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: ControlUpdate[],
    overrideInput?: Record<string, unknown>,
  ) => void;
}

export function PermissionCard({ request, onRespond }: PermissionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const toolDisplay = request.toolName ?? 'unknown tool';
  const hasSuggestions = request.suggestions && request.suggestions.length > 0;

  const inputEntries = request.input ? Object.entries(request.input) : [];

  const respond = (behavior: 'allow' | 'deny', alwaysAllow?: ControlUpdate[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRespond(behavior, alwaysAllow);
  };

  return (
    <View className="mx-4 my-2 bg-mf-panel-bg border border-mf-accent/30 rounded-mf-panel overflow-hidden">
      <View className="flex-row items-center p-4 pb-0">
        <ShieldAlert color="#f97312" size={18} />
        <Text className="text-mf-accent font-semibold text-sm ml-2 flex-1">
          Permission Required
        </Text>
      </View>

      <View className="px-4 pt-2 pb-3">
        <Text className="text-mf-text-primary text-sm mb-1">
          Agent wants to run: <Text style={{ fontFamily: 'monospace' }}>{toolDisplay}</Text>
        </Text>

        {inputEntries.length > 0 && (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            className="flex-row items-center mt-1 mb-2"
          >
            <Text className="text-mf-text-secondary text-xs mr-1">
              {expanded ? 'Hide details' : 'Show details'}
            </Text>
            {expanded ? (
              <ChevronUp color="#a1a1aa" size={12} />
            ) : (
              <ChevronDown color="#a1a1aa" size={12} />
            )}
          </Pressable>
        )}

        {expanded && (
          <View className="bg-mf-app-bg rounded-lg p-2 mb-2">
            {inputEntries.map(([key, value]) => (
              <Text
                key={key}
                className="text-mf-text-secondary text-xs font-mono"
                numberOfLines={4}
              >
                {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
              </Text>
            ))}
          </View>
        )}

        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 bg-mf-accent py-2.5 rounded-mf-card items-center"
            onPress={() => respond('allow')}
          >
            <Text className="text-white font-semibold text-sm">Allow</Text>
          </TouchableOpacity>
          {hasSuggestions && (
            <TouchableOpacity
              className="flex-1 bg-mf-accent/80 py-2.5 rounded-mf-card items-center"
              onPress={() => respond('allow', request.suggestions)}
            >
              <Text className="text-white font-semibold text-sm">Always</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="flex-1 bg-mf-hover py-2.5 rounded-mf-card items-center"
            onPress={() => respond('deny')}
          >
            <Text className="text-mf-text-secondary font-semibold text-sm">Deny</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```
feat(mobile): enhance PermissionCard with collapsible details and Always Allow
```

---

### Task 7: Build mobile AskUserQuestionCard

**Files:**
- Create: `packages/mobile/components/chat/AskUserQuestionCard.tsx`

**Step 1: Create the component**

Create `packages/mobile/components/chat/AskUserQuestionCard.tsx`:

```typescript
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Pressable } from 'react-native';
import { HelpCircle, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { ControlRequest } from '@mainframe/types';

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskUserQuestionCardProps {
  request: ControlRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: undefined,
    overrideInput?: Record<string, unknown>,
  ) => void;
}

export function AskUserQuestionCard({ request, onRespond }: AskUserQuestionCardProps) {
  const questions: Question[] = (request.input.questions as Question[]) || [];
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [currentIndex, setCurrentIndex] = useState(0);

  const activeQuestion = questions[currentIndex];
  const activeSelection = selections.get(currentIndex) || new Set<string>();
  const hasSelection = activeSelection.size > 0;
  const isLast = currentIndex === questions.length - 1;
  const title = activeQuestion?.header || 'Question';

  const toggleOption = useCallback(
    (label: string) => {
      const multi = activeQuestion?.multiSelect ?? false;
      setSelections((prev) => {
        const next = new Map(prev);
        const current = new Set(prev.get(currentIndex) || []);
        if (current.has(label)) {
          current.delete(label);
        } else {
          if (!multi) current.clear();
          current.add(label);
        }
        next.set(currentIndex, current);
        return next;
      });
    },
    [currentIndex, activeQuestion?.multiSelect],
  );

  const handleSubmit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const answers: Record<string, string | string[]> = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      const selected = selections.get(i) || new Set<string>();
      const labels = [...selected]
        .map((s) => (s === '__other__' ? otherTexts.get(i) || '' : s))
        .filter(Boolean);
      answers[q.question] = q.multiSelect ? labels : labels[0] || '';
    }
    onRespond('allow', undefined, { ...request.input, answers });
  }, [questions, selections, otherTexts, onRespond, request.input]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRespond('deny');
  }, [onRespond]);

  if (!activeQuestion) return null;

  return (
    <View className="mx-4 my-2 bg-mf-panel-bg border border-mf-accent/30 rounded-mf-panel overflow-hidden">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2.5 bg-mf-accent/10">
        <View className="flex-row items-center">
          <HelpCircle color="#f97312" size={16} />
          <Text className="text-mf-text-primary font-semibold text-sm ml-2">{title}</Text>
        </View>
        {questions.length > 1 && (
          <Text className="text-mf-text-secondary text-xs">
            {currentIndex + 1} / {questions.length}
          </Text>
        )}
      </View>

      <View className="px-4 py-3">
        <Text className="text-mf-text-primary text-sm mb-3">{activeQuestion.question}</Text>

        <ScrollView style={{ maxHeight: 260 }}>
          {/* Options */}
          {activeQuestion.options.map((opt) => (
            <Pressable
              key={opt.label}
              onPress={() => toggleOption(opt.label)}
              className={`flex-row items-start gap-3 rounded-lg border p-3 mb-2 ${
                activeSelection.has(opt.label)
                  ? 'border-mf-accent bg-mf-accent/10'
                  : 'border-mf-divider'
              }`}
            >
              <View
                className={`w-5 h-5 mt-0.5 items-center justify-center border ${
                  activeQuestion.multiSelect ? 'rounded' : 'rounded-full'
                } ${
                  activeSelection.has(opt.label)
                    ? 'border-mf-accent bg-mf-accent'
                    : 'border-mf-divider'
                }`}
              >
                {activeSelection.has(opt.label) && <Check color="#fff" size={14} />}
              </View>
              <View className="flex-1">
                <Text className="text-mf-text-primary text-sm">{opt.label}</Text>
                {opt.description && (
                  <Text className="text-mf-text-secondary text-xs mt-0.5">{opt.description}</Text>
                )}
              </View>
            </Pressable>
          ))}

          {/* Other option */}
          <Pressable
            onPress={() => toggleOption('__other__')}
            className={`flex-row items-start gap-3 rounded-lg border p-3 mb-2 ${
              activeSelection.has('__other__')
                ? 'border-mf-accent bg-mf-accent/10'
                : 'border-mf-divider'
            }`}
          >
            <View
              className={`w-5 h-5 mt-0.5 items-center justify-center border ${
                activeQuestion.multiSelect ? 'rounded' : 'rounded-full'
              } ${
                activeSelection.has('__other__')
                  ? 'border-mf-accent bg-mf-accent'
                  : 'border-mf-divider'
              }`}
            >
              {activeSelection.has('__other__') && <Check color="#fff" size={14} />}
            </View>
            <Text className="text-mf-text-primary text-sm">Other</Text>
          </Pressable>

          {activeSelection.has('__other__') && (
            <TextInput
              autoFocus
              placeholder="Type your answer..."
              placeholderTextColor="#a1a1aa"
              value={otherTexts.get(currentIndex) || ''}
              onChangeText={(text) =>
                setOtherTexts((prev) => {
                  const next = new Map(prev);
                  next.set(currentIndex, text);
                  return next;
                })
              }
              className="bg-mf-input-bg text-mf-text-primary rounded-lg px-3 py-2 text-sm mb-2 border border-mf-divider"
            />
          )}
        </ScrollView>

        {/* Actions */}
        <View className="flex-row items-center justify-between mt-3">
          <View>
            {currentIndex > 0 && (
              <TouchableOpacity onPress={() => setCurrentIndex((i) => i - 1)}>
                <Text className="text-mf-text-secondary text-sm">Back</Text>
              </TouchableOpacity>
            )}
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="bg-mf-hover px-4 py-2 rounded-mf-card"
              onPress={handleSkip}
            >
              <Text className="text-mf-text-secondary font-semibold text-sm">Skip</Text>
            </TouchableOpacity>
            {isLast ? (
              <TouchableOpacity
                className={`px-4 py-2 rounded-mf-card ${hasSelection ? 'bg-mf-accent' : 'bg-mf-hover'}`}
                onPress={handleSubmit}
                disabled={!hasSelection}
              >
                <Text className={`font-semibold text-sm ${hasSelection ? 'text-white' : 'text-mf-text-secondary'}`}>
                  Submit
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                className={`px-4 py-2 rounded-mf-card ${hasSelection ? 'bg-mf-accent' : 'bg-mf-hover'}`}
                onPress={() => setCurrentIndex((i) => i + 1)}
                disabled={!hasSelection}
              >
                <Text className={`font-semibold text-sm ${hasSelection ? 'text-white' : 'text-mf-text-secondary'}`}>
                  Next
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```
feat(mobile): add AskUserQuestionCard component
```

---

### Task 8: Build mobile PlanApprovalCard

**Files:**
- Create: `packages/mobile/components/chat/PlanApprovalCard.tsx`

**Step 1: Create the component**

Create `packages/mobile/components/chat/PlanApprovalCard.tsx`:

```typescript
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { ControlRequest } from '@mainframe/types';
import { MarkdownText } from './MarkdownText';

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

interface PlanApprovalCardProps {
  request: ControlRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: undefined,
    overrideInput?: undefined,
    message?: string,
    executionMode?: string,
    clearContext?: boolean,
  ) => void;
}

export function PlanApprovalCard({ request, onRespond }: PlanApprovalCardProps) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const plan = request.input.plan as string | undefined;
  const allowedPrompts = request.input.allowedPrompts as AllowedPrompt[] | undefined;

  const handleApprove = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRespond('allow');
  }, [onRespond]);

  const handleReject = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRespond('deny');
  }, [onRespond]);

  const handleSendFeedback = useCallback(() => {
    if (!feedback.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRespond('deny', undefined, undefined, feedback.trim());
  }, [feedback, onRespond]);

  return (
    <View className="mx-4 my-2 bg-mf-panel-bg border border-mf-accent/30 rounded-mf-panel overflow-hidden">
      {/* Header */}
      <View className="flex-row items-center px-4 py-2.5 bg-mf-accent/10">
        <ClipboardList color="#f97312" size={16} />
        <Text className="text-mf-text-primary font-semibold text-sm ml-2">
          Plan Ready for Review
        </Text>
      </View>

      <View className="px-4 py-3">
        {/* Plan preview */}
        {plan && (
          <ScrollView
            style={{ maxHeight: 300 }}
            className="bg-mf-app-bg rounded-lg p-3 mb-3"
          >
            <MarkdownText text={plan} />
          </ScrollView>
        )}

        {/* Allowed prompts */}
        {allowedPrompts && allowedPrompts.length > 0 && (
          <View className="mb-3">
            <Text className="text-mf-text-secondary text-xs mb-1">Requested permissions:</Text>
            {allowedPrompts.map((ap, i) => (
              <Text key={i} className="text-mf-text-secondary text-xs ml-2">
                • {ap.prompt}
              </Text>
            ))}
          </View>
        )}

        {/* Revise textarea */}
        {revising && (
          <TextInput
            autoFocus
            multiline
            numberOfLines={3}
            placeholder="What should be changed..."
            placeholderTextColor="#a1a1aa"
            value={feedback}
            onChangeText={setFeedback}
            className="bg-mf-input-bg text-mf-text-primary rounded-lg px-3 py-2 text-sm mb-3 border border-mf-divider"
            style={{ minHeight: 72, textAlignVertical: 'top' }}
          />
        )}

        {/* Actions */}
        {revising ? (
          <View className="flex-row justify-end gap-2">
            <TouchableOpacity
              className="bg-mf-hover px-4 py-2 rounded-mf-card"
              onPress={() => {
                setRevising(false);
                setFeedback('');
              }}
            >
              <Text className="text-mf-text-secondary font-semibold text-sm">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`px-4 py-2 rounded-mf-card ${feedback.trim() ? 'bg-mf-accent' : 'bg-mf-hover'}`}
              onPress={handleSendFeedback}
              disabled={!feedback.trim()}
            >
              <Text
                className={`font-semibold text-sm ${feedback.trim() ? 'text-white' : 'text-mf-text-secondary'}`}
              >
                Send Feedback
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-row justify-end gap-2">
            <TouchableOpacity
              className="bg-mf-hover px-4 py-2 rounded-mf-card"
              onPress={handleReject}
            >
              <Text className="text-mf-text-secondary font-semibold text-sm">Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="bg-mf-hover px-4 py-2 rounded-mf-card border border-mf-divider"
              onPress={() => setRevising(true)}
            >
              <Text className="text-mf-text-primary font-semibold text-sm">Revise</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="bg-mf-accent px-4 py-2 rounded-mf-card"
              onPress={handleApprove}
            >
              <Text className="text-white font-semibold text-sm">Approve</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}
```

Note: Intentionally omits execution mode picker and clear context toggle for mobile v1 — the desktop defaults are fine when approving from mobile. These can be added later.

**Step 2: Commit**

```
feat(mobile): add PlanApprovalCard component
```

---

### Task 9: Route permission cards by toolName in MessageList

**Files:**
- Modify: `packages/mobile/components/chat/MessageList.tsx:6,30-34`

**Step 1: Update imports and routing**

In `packages/mobile/components/chat/MessageList.tsx`:

Update imports (line 6):
```typescript
import { PermissionCard } from './PermissionCard';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { PlanApprovalCard } from './PlanApprovalCard';
```

Update the `onRespondToPermission` prop type in `MessageListProps` to match the expanded signature:

```typescript
interface MessageListProps {
  messages: DisplayMessage[];
  pendingPermission: ControlRequest | null;
  onRespondToPermission: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: import('@mainframe/types').ControlUpdate[],
    overrideInput?: Record<string, unknown>,
    message?: string,
    executionMode?: string,
    clearContext?: boolean,
  ) => void;
  chatAdapterId?: string;
}
```

Replace the `ListHeaderComponent` (lines 30-34):

```typescript
ListHeaderComponent={
  pendingPermission ? (
    <PermissionCardRouter
      request={pendingPermission}
      onRespond={onRespondToPermission}
    />
  ) : null
}
```

Add the router component at the bottom of the file:

```typescript
function PermissionCardRouter({
  request,
  onRespond,
}: {
  request: ControlRequest;
  onRespond: MessageListProps['onRespondToPermission'];
}) {
  switch (request.toolName) {
    case 'AskUserQuestion':
      return <AskUserQuestionCard request={request} onRespond={onRespond} />;
    case 'ExitPlanMode':
      return <PlanApprovalCard request={request} onRespond={onRespond} />;
    default:
      return <PermissionCard request={request} onRespond={onRespond} />;
  }
}
```

**Step 2: Update chat screen**

In `packages/mobile/app/chat/[chatId].tsx`, the `respondToPermission` from `useChatSession` now matches the expanded signature — no changes needed since the prop is passed through.

**Step 3: Typecheck**

Run: `npx tsc --noEmit -p packages/mobile/tsconfig.json`
Expected: no new errors

**Step 4: Commit**

```
feat(mobile): route permission cards by toolName

AskUserQuestion → AskUserQuestionCard, ExitPlanMode → PlanApprovalCard,
all other tools → PermissionCard with collapsible details.
```

---

### Task 10: Final integration test

**Step 1: Build all packages**

Run: `pnpm build`
Expected: clean build

**Step 2: Run core tests**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/permission-flow.test.ts`
Expected: all pass including new guard + resolved tests

**Step 3: Commit all together if any fixes needed**

```
fix: address integration issues from permission sync
```
