# Launch Config Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh the launch config dropdown when the agent writes `.mainframe/launch.json`, without requiring CMD+R.

**Architecture:** Add `refreshKey` state to `useLaunchConfig` hook, triggered by `context.updated` WS events (debounced 500ms) and window `focus` events. Mirrors the existing `FilesTab` pattern.

**Tech Stack:** React hooks, Zustand store, WebSocket events via `daemonClient`

**Spec:** `docs/superpowers/specs/2026-03-16-launch-config-auto-refresh-design.md`

---

## Chunk 1: Implementation

### Task 1: Write the failing test

**Files:**
- Create: `packages/desktop/src/__tests__/hooks/useLaunchConfig.test.ts`

- [ ] **Step 1: Write test file**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock daemonClient before importing the hook
const mockOnEvent = vi.fn().mockReturnValue(() => {});
vi.mock('../../renderer/lib/client.js', () => ({
  daemonClient: { onEvent: mockOnEvent },
}));

// Mock window.mainframe.readFile
const mockReadFile = vi.fn();
Object.defineProperty(window, 'mainframe', {
  value: { readFile: mockReadFile },
  writable: true,
});

// Mock stores — activeChatId is mutable so individual tests can override
let mockActiveChatId: string | null = 'chat-1';
vi.mock('../../renderer/store/projects.js', () => ({
  useProjectsStore: vi.fn((selector: any) =>
    selector({
      activeProjectId: 'proj-1',
      projects: [{ id: 'proj-1', path: '/tmp/test-project' }],
    }),
  ),
}));

vi.mock('../../renderer/store/chats.js', () => ({
  useChatsStore: vi.fn((selector: any) =>
    selector({ activeChatId: mockActiveChatId }),
  ),
}));

import { useLaunchConfig } from '../../renderer/hooks/useLaunchConfig.js';

const VALID_CONFIG = JSON.stringify({
  version: 1,
  configurations: [{ name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 3000, url: 'http://localhost:3000' }],
});

describe('useLaunchConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(null);
    mockOnEvent.mockReturnValue(() => {});
    mockActiveChatId = 'chat-1';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads launch.json when context.updated fires', async () => {
    mockReadFile.mockResolvedValue(null);
    const { result } = renderHook(() => useLaunchConfig());
    await waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();

    // Capture the event listener callback
    const eventCallback = mockOnEvent.mock.calls[0]?.[0] as (event: any) => void;
    expect(eventCallback).toBeDefined();

    // Now simulate the file being created, then context.updated firing
    mockReadFile.mockResolvedValue(VALID_CONFIG);
    act(() => {
      eventCallback({ type: 'context.updated', chatId: 'chat-1' });
    });

    // Advance past the 500ms debounce
    await act(async () => { vi.advanceTimersByTime(600); });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.configurations[0]?.name).toBe('dev');
  });

  it('re-reads launch.json on window focus', async () => {
    mockReadFile.mockResolvedValue(null);
    const { result } = renderHook(() => useLaunchConfig());
    await waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1));

    mockReadFile.mockResolvedValue(VALID_CONFIG);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.configurations[0]?.name).toBe('dev');
  });

  it('ignores context.updated for different chatId', async () => {
    mockReadFile.mockResolvedValue(null);
    renderHook(() => useLaunchConfig());
    await waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1));

    const eventCallback = mockOnEvent.mock.calls[0]?.[0] as (event: any) => void;
    mockReadFile.mockResolvedValue(VALID_CONFIG);
    act(() => {
      eventCallback({ type: 'context.updated', chatId: 'other-chat' });
    });

    // Advance past debounce — should NOT trigger a re-read
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe to WS events when activeChatId is null', async () => {
    mockActiveChatId = null;
    mockReadFile.mockResolvedValue(null);
    renderHook(() => useLaunchConfig());
    await waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1));

    // onEvent should not have been called (no subscription)
    expect(mockOnEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/__tests__/hooks/useLaunchConfig.test.ts`
Expected: FAIL — `useLaunchConfig` does not subscribe to events or focus yet.

### Task 2: Implement the hook changes

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useLaunchConfig.ts`

- [ ] **Step 3: Update useLaunchConfig with refresh triggers**

Replace the entire hook with:

```ts
import { useEffect, useRef, useState } from 'react';
import type { LaunchConfig } from '@qlan-ro/mainframe-types';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { daemonClient } from '../lib/client';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:launch-config');

export function useLaunchConfig(): LaunchConfig | null {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setConfig(null);
      return;
    }
    void window.mainframe
      ?.readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) {
          setConfig(null);
          return;
        }
        setConfig(JSON.parse(content) as LaunchConfig);
      })
      .catch((err) => {
        log.warn('failed to read launch.json', { err: String(err) });
        setConfig(null);
      });
  }, [activeProject?.id, refreshKey]);

  useEffect(() => {
    if (!activeChatId) return;
    const unsub = daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 500);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeChatId]);

  useEffect(() => {
    const onFocus = (): void => setRefreshKey((k) => k + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/__tests__/hooks/useLaunchConfig.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useLaunchConfig.ts packages/desktop/src/__tests__/hooks/useLaunchConfig.test.ts
git commit -m "feat: auto-refresh launch config dropdown on agent writes and window focus"
```
