/**
 * The transcript's message list, mounted from the tail up.
 *
 * `ThreadPrimitive.Messages` mounts every message in one commit. A first
 * visit to a long chat publishes its whole replay in a single
 * `transcript.updated`, so the thread stayed blank until hundreds of markdown
 * bodies, code blocks and tool cards had all been built — the "click a
 * session, wait" stall. This renders the newest `INITIAL_WINDOW` messages
 * synchronously (what the bottom-pinned viewport shows) and reveals the
 * older ones in deferred batches of `REVEAL_STEP`, each inside a transition
 * so input stays responsive while they mount above the fold. Once fully
 * revealed nothing is ever held back again: new messages append at the
 * tail, and a bulk publish only re-engages the window when it lands on an
 * empty thread (a staged replay's single publish).
 *
 * Messages render through `ThreadPrimitive.MessageByIndex`, keyed by index
 * exactly as `ThreadPrimitive.Messages` keys them, so the already-mounted
 * tail keeps its instances while earlier indices are prepended. Mount this
 * keyed by thread id: a thread switch must restart from the new thread's
 * tail, not inherit the previous thread's window.
 */
import { startTransition, useEffect, useState, type ComponentProps } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';

type MessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components'];

/** Newest messages mounted in the first commit — comfortably more than a tall viewport shows. */
export const INITIAL_WINDOW = 40;
/** Older messages revealed per deferred batch. */
export const REVEAL_STEP = 80;

/** Runs `reveal` once the browser is idle (bounded, so a busy stream can't starve it), or on the next macrotask where idle callbacks don't exist. */
function scheduleReveal(reveal: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(reveal, { timeout: 100 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(reveal, 0);
  return () => clearTimeout(id);
}

function heldFor(count: number): number {
  return Math.max(0, count - INITIAL_WINDOW);
}

export function ProgressiveMessages({ components }: { components: MessageComponents }) {
  const count = useAuiState((s) => s.thread.messages.length);
  // `held` = how many of the OLDEST messages are not mounted yet. It only ever
  // shrinks, except when a bulk publish lands on an empty thread.
  const [held, setHeld] = useState(() => heldFor(count));
  const [seen, setSeen] = useState(count);
  if (seen !== count) {
    setSeen(count);
    if (seen === 0) setHeld(heldFor(count));
  }

  useEffect(() => {
    if (held === 0) return;
    return scheduleReveal(() => {
      startTransition(() => setHeld((current) => Math.max(0, current - REVEAL_STEP)));
    });
  }, [held]);

  const start = Math.min(held, count);
  const items = [];
  for (let index = start; index < count; index++) {
    items.push(<ThreadPrimitive.MessageByIndex key={index} index={index} components={components} />);
  }
  return <>{items}</>;
}
