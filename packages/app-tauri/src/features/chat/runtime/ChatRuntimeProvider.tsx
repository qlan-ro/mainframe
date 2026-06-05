/**
 * ChatRuntimeProvider — Phase 2A controller/reducer wiring.
 *
 * Creates one ChatThreadController per chatId (via a per-provider registry),
 * wires it to assistant-ui via useChatThreadRuntime, and disposes on switch.
 *
 * The controller registry is keyed by chatId so React StrictMode double-invoke
 * doesn't re-create controllers on every render — the same controller is
 * returned on the second mount. A real dispose only happens when this
 * provider unmounts (key={chatId} in the parent ensures that on chat switch).
 *
 * Outbound actions flow through the controller:
 *  - onNew      → controller.sendMessage (optimistic + WS fire)
 *  - onCancel   → controller.cancel (POST /interrupt)
 *  - permission → controller.replyToPermission (WS permission.respond)
 */
import { useEffect, useMemo, useRef } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { ChatThreadController } from '../controller/chat-thread-controller';
import { useChatThreadRuntime } from './use-chat-thread-runtime';
import { daemonWs } from '../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Controller registry (per provider instance)
// ---------------------------------------------------------------------------

interface ControllerRegistry {
  getOrCreate(chatId: string, port: number): ChatThreadController;
  dispose(): void;
}

function createControllerRegistry(): ControllerRegistry {
  const controllers = new Map<string, ChatThreadController>();

  return {
    getOrCreate(chatId: string, port: number): ChatThreadController {
      const existing = controllers.get(chatId);
      if (existing) return existing;

      const controller = new ChatThreadController(chatId, port, daemonWs);
      controllers.set(chatId, controller);
      return controller;
    },
    dispose() {
      for (const controller of controllers.values()) {
        controller.dispose();
      }
      controllers.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Inner wiring — runs at the correct hook call-site
// ---------------------------------------------------------------------------

interface RuntimeWiringProps {
  chatId: string;
  port: number;
  registry: ControllerRegistry;
  children: React.ReactNode;
}

function RuntimeWiring({ chatId, port, registry, children }: RuntimeWiringProps) {
  const controller = registry.getOrCreate(chatId, port);
  const runtime = useChatThreadRuntime(controller, port);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

// ---------------------------------------------------------------------------
// Public provider
// ---------------------------------------------------------------------------

export interface ChatRuntimeProviderProps {
  chatId: string;
  daemonPort: number;
  children: React.ReactNode;
}

export function ChatRuntimeProvider({ chatId, daemonPort, children }: ChatRuntimeProviderProps) {
  const registryRef = useRef<ControllerRegistry | null>(null);

  if (registryRef.current === null) {
    registryRef.current = createControllerRegistry();
  }

  const registry = registryRef.current;

  // Memoize the port so the registry lookup is stable within a chatId epoch.
  const port = useMemo(() => daemonPort, [daemonPort]);

  // Dispose all controllers when this provider unmounts.
  // parent mounts with key={chatId} so unmount === chat switch.
  useEffect(() => {
    return () => {
      registry.dispose();
    };
  }, [registry]);

  return (
    <RuntimeWiring chatId={chatId} port={port} registry={registry}>
      {children}
    </RuntimeWiring>
  );
}

// ---------------------------------------------------------------------------
// Re-export convenience hooks so callers don't need to know the file paths.
// ---------------------------------------------------------------------------
export {
  useChatExtras,
  useChatPermissions,
  useChatPermissionFront,
  usePendingGate,
  useChatQuestions,
  useChatQueuedMessages,
} from './use-chat-thread-runtime';
