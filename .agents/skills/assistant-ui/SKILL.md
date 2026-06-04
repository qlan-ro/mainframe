---
name: assistant-ui
description: "Overview and router for assistant-ui, the React library for building AI chat interfaces from composable primitives. Use for high-level, cross-cutting, or architecture-overview questions: choosing packages, picking a runtime, or understanding the layered model (RuntimeCore, Runtime, context hooks, primitives) and message model. Covers the `@assistant-ui/react` core plus `@assistant-ui/react-ai-sdk`, `@assistant-ui/react-langgraph`, `assistant-stream`, and `assistant-cloud`; `AssistantRuntimeProvider`; the primitives `ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`; the hooks `useAui`, `useAuiState`, `useAuiEvent`; and runtime selection across `useChatRuntime`, `useExternalStoreRuntime`, `useLangGraphRuntime`, `useLocalRuntime`. For a specific area route to a focused sibling instead: setup, runtime, primitives, tools, streaming, cloud, thread-list, or update. Not for hands-on tasks already owned by those siblings."
license: MIT
---

# assistant-ui

**Always consult [assistant-ui.com/llms.txt](https://www.assistant-ui.com/llms.txt) for the latest API.**

React library for building AI chat interfaces with composable primitives.

## References

- [./references/architecture.md](./references/architecture.md) -- Core architecture and layered system
- [./references/packages.md](./references/packages.md) -- Package overview and selection guide

## When to Use

| Use Case | Best For |
|----------|----------|
| Chat UI from scratch | Full control over UX |
| Existing AI backend | Connects to any streaming backend |
| Custom message types | Tools, images, files, custom parts |
| Multi-thread apps | Built-in thread list management |
| Production apps | Cloud persistence, auth, analytics |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  UI Components (Primitives)             │
│    ThreadPrimitive, MessagePrimitive, ComposerPrimitive │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                   Context Hooks                         │
│   useAui, useAuiState, useAuiEvent │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Runtime Layer                        │
│  AssistantRuntime → ThreadRuntime → MessageRuntime      │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                   Adapters/Backend                      │
│   AI SDK · LangGraph · Custom · Cloud Persistence       │
└─────────────────────────────────────────────────────────┘
```

## Pick a Runtime

```
Using AI SDK?
├─ Yes → useChatRuntime (recommended)
└─ No
   ├─ External state (Redux/Zustand)? → useExternalStoreRuntime
   ├─ LangGraph agent? → useLangGraphRuntime
   ├─ AG-UI protocol? → useAgUiRuntime
   ├─ A2A protocol? → useA2ARuntime
   └─ Custom API → useLocalRuntime
```

## Core Packages

| Package | Purpose |
|---------|---------|
| `@assistant-ui/react` | UI primitives & hooks |
| `@assistant-ui/react-ai-sdk` | Vercel AI SDK v6 adapter |
| `@assistant-ui/react-langgraph` | LangGraph adapter |
| `@assistant-ui/react-markdown` | Markdown rendering |
| `assistant-stream` | Streaming protocol |
| `assistant-cloud` | Cloud persistence |

## Quick Start

```tsx
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

function App() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

## State Access

```tsx
import { useAui, useAuiState } from "@assistant-ui/react";

const api = useAui();
api.thread().append({ role: "user", content: [{ type: "text", text: "Hi" }] });
api.thread().cancelRun();

const messages = useAuiState(s => s.thread.messages);
const isRunning = useAuiState(s => s.thread.isRunning);
```

## Related Skills

- `/setup` - Installation and configuration
- `/primitives` - UI component customization
- `/runtime` - State management deep dive
- `/tools` - Tool registration and UI
- `/streaming` - Streaming protocols
- `/cloud` - Persistence and auth
- `/thread-list` - Multi-thread management
- `/update` - Version updates and migrations
