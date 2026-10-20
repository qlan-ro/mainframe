import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTranscriptScroll } from './transcript-scroll-context';
import { useChatExtrasSelector } from '../runtime/chat-extras';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import type { ActivitySource } from '@/features/session-panel/activity-model';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { seekingComponents, useScrollSeek } from './use-scroll-seek';
import { useFindInChatStore } from '../find/find-in-chat-store';
import { waitForMessage } from '../find/daemon-highlights';

type MessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components'];
const FIRST_INDEX = 1_000_000_000;

function useMessageWindow(ids: string[]) {
  const [window, setWindow] = useState({ first: ids[0], index: FIRST_INDEX, generation: 0 });
  if (window.first !== ids[0]) {
    const prepended = window.first ? ids.indexOf(window.first) : -1;
    setWindow({
      first: ids[0],
      index: prepended >= 0 ? window.index - prepended : FIRST_INDEX,
      generation: window.generation + (prepended < 0 ? 1 : 0),
    });
  }
  return window;
}

const DEFAULT_OVERSCAN = { top: 400, bottom: 400 };
function useSelectionOverscan(viewport: HTMLElement | null) {
  const [overscan, setOverscan] = useState(DEFAULT_OVERSCAN);
  useEffect(() => {
    const change = () => {
      const selection = document.getSelection();
      let next = DEFAULT_OVERSCAN;
      if (viewport && selection && !selection.isCollapsed && viewport.contains(selection.anchorNode)) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const box = viewport.getBoundingClientRect();
        const scale = box.height ? viewport.clientHeight / box.height : 1;
        next = {
          top: Math.max(400, (box.top - rect.top) * scale),
          bottom: Math.max(400, (rect.bottom - box.bottom) * scale),
        };
      }
      setOverscan((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
    };
    document.addEventListener('selectionchange', change);
    viewport?.addEventListener('scroll', change, true);
    return () => {
      document.removeEventListener('selectionchange', change);
      viewport?.removeEventListener('scroll', change, true);
    };
  }, [viewport]);
  return overscan;
}

function useVirtualMessageState() {
  const serialized = useAuiState((s) => s.thread.messages.map((message) => message.id).join('\0'));
  const ids = useMemo(() => (serialized ? serialized.split('\0') : []), [serialized]);
  const userCount = useAuiState((s) => s.thread.messages.filter((message) => message.role === 'user').length);
  const chatId = useChatExtrasSelector((extras) => extras?.state.chatId);
  const scroll = useTranscriptScroll();
  const viewport = scroll?.viewport ?? null;
  const list = useRef<VirtuosoHandle>(null);
  const [target, setTarget] = useState<string | null>(null);
  const interaction = useRef<(() => void) | null>(null);
  const range = useMessageWindow(ids);
  const overscan = useSelectionOverscan(viewport);
  useEffect(() => {
    const jump = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId: string; source: ActivitySource }>).detail;
      if (detail.chatId !== chatId) return;
      interaction.current?.();
      const release = scroll?.beginInteraction() ?? (() => undefined);
      interaction.current = release;
      setTarget(detail.source.messageId);
      void waitForMessage(detail.chatId, detail.source.messageId).then(() =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (interaction.current !== release) return;
            release();
            interaction.current = null;
          }),
        ),
      );
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, jump);
    return () => {
      window.removeEventListener(ACTIVITY_JUMP_EVENT, jump);
      interaction.current?.();
      interaction.current = null;
    };
  }, [chatId, scroll]);
  useLayoutEffect(() => {
    const index = target ? ids.indexOf(target) : -1;
    if (index < 0 || !list.current) return;
    list.current.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    setTarget(null);
  }, [ids, target, viewport]);
  return { ids, userCount, scroll, viewport, list, range, overscan };
}

function VirtualMessage({ id, components }: { id: string; components: MessageComponents }) {
  const index = useAuiState((state) => state.thread.messages.findIndex((message) => message.id === id));
  return index < 0 ? null : <ThreadPrimitive.MessageByIndex index={index} components={components} />;
}

export function VirtualMessages({ components }: { components: MessageComponents }) {
  const { ids, userCount, scroll, viewport, list, range, overscan } = useVirtualMessageState();
  const scrollSeek = useScrollSeek(scroll, viewport);
  const [ready, setReady] = useState(-1);
  const legacyFind = useFindInChatStore((s) => s.isOpen && !s.daemon);
  return (
    <DisclosureStateProvider>
      <div
        data-testid="chat-message-list"
        data-loaded-count={ids.length}
        data-loaded-user-count={userCount}
        data-virtualized={Boolean(viewport)}
        style={viewport && ready !== range.generation ? { visibility: 'hidden' } : undefined}
      >
        {!viewport && scroll?.viewport === null ? null : viewport && ids.length > 0 ? (
          <Virtuoso
            key={range.generation}
            ref={list}
            data={ids}
            customScrollParent={viewport}
            firstItemIndex={range.index}
            defaultItemHeight={220}
            components={seekingComponents}
            scrollSeekConfiguration={scrollSeek}
            itemsRendered={(items) => {
              if (items.some((item) => item.data === ids[ids.length - 1]) || !scroll?.isFollowing())
                setReady(range.generation);
            }}
            computeItemKey={(_index, id) => id}
            increaseViewportBy={legacyFind ? { top: 1e9, bottom: 1e9 } : overscan}
            itemContent={(_index, id) => <VirtualMessage id={id} components={components} />}
          />
        ) : (
          ids.map((id) => <VirtualMessage key={id} id={id} components={components} />)
        )}
      </div>
    </DisclosureStateProvider>
  );
}
