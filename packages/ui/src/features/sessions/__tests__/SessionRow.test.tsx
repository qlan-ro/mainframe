// @vitest-environment jsdom

/**
 * SessionRow — the two things the row's resolver owns, over a REAL thread list.
 *
 * Both were container-shaped before the aui migration and are invisible to
 * `tsc` after it:
 *
 *  1. The presence guard. Resolving an id the list no longer holds throws
 *     synchronously — reachable during an optimistic archive — so the row must
 *     render nothing for an unknown id. The guard reads the store scope's
 *     `threadItems` ARRAY, where it used to read a Record keyed by id; an
 *     `in`-style check against an array is silently always false, which would
 *     blank the whole sidebar.
 *  2. `ThreadListItemPrimitive.Root`/`.Trigger` inside `SessionRowItemScope`.
 *     The primitives resolve `threadListItem` through the store scope the row
 *     now provides, so a row that renders can still be selected and still
 *     paints `data-active` when it is the main thread. Nothing else in the
 *     suite mounts the primitives under that scope.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import {
  AssistantRuntimeProvider,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { DaemonPortProvider } from '../runtime/daemon-port-context';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { SessionRow } from '../SessionRow';

const PORT = 31415;

const THREADS = [
  { status: 'regular' as const, remoteId: 'chat-a', title: 'Alpha' },
  { status: 'regular' as const, remoteId: 'chat-b', title: 'Beta' },
];

const adapter: RemoteThreadListAdapter = {
  list: async () => ({ threads: THREADS }),
  fetch: async (threadId: string) => THREADS.find((t) => t.remoteId === threadId) ?? THREADS[0]!,
  rename: async () => {},
  archive: async () => {},
  unarchive: async () => {},
  delete: async () => {},
  initialize: async (threadId: string) => ({ remoteId: threadId, externalId: undefined }),
  generateTitle: () => Promise.resolve(new ReadableStream()),
};

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

function makeItem(id: string, title: string): SessionItem {
  return {
    id,
    remoteId: id,
    title,
    status: 'regular',
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      temporary: false,
      noProject: false,
      transcriptMissing: false,
      updatedAt: Date.now(),
    },
  };
}

/**
 * One row per listed thread — plus a row for an id the list never held, which
 * is the guard's case. The main thread aui boots with is not in `THREADS`, so
 * rows are looked up by title rather than by position.
 */
const Rows: FC<{ main: { id: string | null } }> = ({ main }) => {
  const threadItems = useAuiState((s) => s.threads.threadItems);
  main.id = useAuiState((s) => s.threads.mainThreadId);
  return (
    <>
      {threadItems.map((t) => (
        <SessionRow key={t.id} item={makeItem(t.id, t.title ?? 'untitled')} />
      ))}
      <SessionRow item={makeItem('vanished-id', 'Ghost')} />
    </>
  );
};

const Harness: FC<{ main: { id: string | null } }> = ({ main }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <DaemonPortProvider port={PORT}>
      <SidebarProvider>
        <AssistantRuntimeProvider runtime={runtime}>
          <Rows main={main} />
        </AssistantRuntimeProvider>
      </SidebarProvider>
    </DaemonPortProvider>
  );
};

interface MountedRows {
  rowFor: (title: string) => HTMLElement | undefined;
  mainThreadId: () => string | null;
}

async function mountRows(): Promise<MountedRows> {
  const main: { id: string | null } = { id: null };
  render(<Harness main={main} />);
  await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

  const rowOf = (title: string) =>
    screen
      .queryAllByTestId('sessions-row')
      .find((row) => row.querySelector('[data-testid="sessions-row-title"]')?.textContent === title);

  return { rowFor: rowOf, mainThreadId: () => main.id };
}

/** The row's one interactive surface — `ThreadListItemPrimitive.Trigger`. */
function triggerOf(row: HTMLElement): HTMLElement {
  const button = row.querySelector('button');
  if (button == null) throw new Error('row has no trigger button');
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionRow — the presence guard', () => {
  it('renders nothing for an id the thread list no longer holds', async () => {
    await mountRows();

    expect(screen.queryByText('Ghost')).toBeNull();
    expect(document.querySelector('[data-chat-id="vanished-id"]')).toBeNull();
  });

  it('renders a row for every id the thread list does hold', async () => {
    const { rowFor } = await mountRows();

    expect(rowFor('Alpha')).toBeTruthy();
    expect(rowFor('Beta')).toBeTruthy();
  });
});

describe('SessionRow — the thread-list-item primitives resolve through the row scope', () => {
  it('switches the main thread to the row that was clicked', async () => {
    const { rowFor, mainThreadId } = await mountRows();
    const beta = rowFor('Beta')!;
    expect(beta.dataset.chatId).not.toBe(mainThreadId());

    triggerOf(beta).click();

    await waitFor(() => expect(mainThreadId()).toBe(beta.dataset.chatId));
  });

  it('marks only the main thread’s row active', async () => {
    const { rowFor, mainThreadId } = await mountRows();
    const beta = rowFor('Beta')!;

    triggerOf(beta).click();
    await waitFor(() => expect(mainThreadId()).toBe(beta.dataset.chatId));

    expect(rowFor('Beta')!.dataset.active).toBe('true');
    expect(rowFor('Alpha')!.dataset.active).toBeUndefined();
  });
});

describe('SessionRow — Rename from the context menu', () => {
  it('leaves focus in the rename input with the whole title selected', async () => {
    const user = userEvent.setup();
    const { rowFor } = await mountRows();

    await user.pointer({ keys: '[MouseRight]', target: rowFor('Alpha')! });
    await user.click(await screen.findByTestId('sessions-ctx-rename'));

    const input = (await screen.findByTestId('sessions-rename-input')) as HTMLInputElement;
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTestId('sessions-rename-input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Alpha'.length);
  });

  it('keeps focus on the input when the menu unmounts after its exit animation', async () => {
    // jsdom runs no CSS animations, so fake one on the menu: Presence then keeps
    // it mounted until `animationend`, as in the app (duration-100). Focus
    // another element first; the delayed FocusScope restore would send focus
    // back to it and blur (so cancel) the input unless it is prevented.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const realGcs = window.getComputedStyle.bind(window);
    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = realGcs(el, pseudo);
      // Presence caches this live style object at mount, so key off the
      // element's state at read time rather than when the object is built.
      if (el instanceof HTMLElement && el.dataset.slot === 'context-menu-content') {
        return new Proxy(style, {
          get: (t, k) =>
            k === 'animationName' ? (el.dataset.state === 'closed' ? 'exit' : 'none') : Reflect.get(t, k),
        });
      }
      return style;
    });
    try {
      const user = userEvent.setup();
      const { rowFor } = await mountRows();

      outside.focus();
      await user.pointer({ keys: '[MouseRight]', target: rowFor('Alpha')! });
      const rename = await screen.findByTestId('sessions-ctx-rename');
      const menu = rename.closest('[data-slot="context-menu-content"]')!;
      await user.click(rename);
      await new Promise((r) => setTimeout(r, 100));
      expect(menu.isConnected).toBe(true);
      // The input must not mount while the menu's focus scope is alive: its
      // trap and delayed restore would blur the input and cancel the rename.
      expect(screen.queryByTestId('sessions-rename-input')).toBeNull();
      act(() => {
        const end = new Event('animationend', { bubbles: true });
        Object.defineProperty(end, 'animationName', { value: 'exit' });
        menu.dispatchEvent(end);
      });

      const input = (await screen.findByTestId('sessions-rename-input')) as HTMLInputElement;
      await new Promise((r) => setTimeout(r, 100));

      expect(menu.isConnected).toBe(false);
      expect(screen.getByTestId('sessions-rename-input')).toBe(input);
      expect(document.activeElement).toBe(input);
    } finally {
      gcs.mockRestore();
      outside.remove();
    }
  });
});
