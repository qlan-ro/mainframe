import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { QueuedRows } from '@/features/chat/composer/queue/QueuedRows';
import { ComposerField, useChipFieldBridge } from '@/features/chat/composer/composer-field';
import { controls } from '../controls';
import { params } from '../params';
import { store } from '../store';

/**
 * `composer=real`: assistant-ui's own input (the app's composer field is `ComposerPrimitive.Input`, an autosizing
 * textarea that reads layout in a layout effect whenever its text changes). Enter sends through the runtime's
 * `onNew` (`runtime.tsx`), as the app's composer does.
 */
function RealComposer() {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  useEffect(() => {
    controls.setDraft = (text: string) => aui.thread.composer().setText(text);
  }, [aui]);
  // Mid-run Enter, as the app's `Composer.tsx` takes it: assistant-ui's input ignores Enter while a run is on, so the
  // key appends (→ `onNew`) and then resets the composer, the order of `use-submit-composition.ts`.
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isRunning || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const composer = aui.thread.composer();
    aui.thread.append({ role: 'user', content: [{ type: 'text', text: composer.getState().text }] });
    composer.reset();
    const after = controls.afterSend;
    controls.afterSend = null;
    // Queued after React's flush of the reset: the snapshot is a later commit, as a daemon round trip is.
    if (after) queueMicrotask(after);
  };
  return (
    <ComposerPrimitive.Root className="rounded-xl border border-border bg-card p-3">
      {params.queue && <QueuedRows />}
      {params.chips && <ChipField />}
      <ComposerPrimitive.Input
        hidden={params.chips}
        data-rig-input
        rows={1}
        submitMode="enter"
        onKeyDown={onKeyDown}
        unstable_focusOnRunStart={false}
        unstable_focusOnScrollToBottom={false}
        unstable_focusOnThreadSwitched={false}
        className="block w-full resize-none overflow-hidden bg-transparent px-1 pt-0.5 pb-2 text-sm outline-none"
      />
      <div className="h-8" />
    </ComposerPrimitive.Root>
  );
}

/** `chips=1`: the app's chip field (Lexical), as the composer mounts it with Settings › Chat › chips on. */
function ChipField() {
  const bridge = useChipFieldBridge();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noop = () => undefined;
  return (
    <ComposerField
      bridge={bridge}
      textareaRef={textareaRef}
      placeholder="Queue a message for when the agent finishes…"
      onKeyDown={noop}
      onEnter={noop}
      onShiftTab={noop}
    />
  );
}

/** A composer-sized footer: the real composer needs a daemon, and only its height matters here (it grows with the draft's lines). */
export function ComposerStub() {
  const lines = useSyncExternalStore(store.subscribe, () => store.get().composerLines);
  const strip = useSyncExternalStore(store.subscribe, () => store.get().strip);
  return (
    <div
      data-rig-footer
      className="mx-auto flex w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-col px-5 pb-4"
    >
      {/* `queue=1`: the activity strip above the card; only its height matters here. */}
      {params.queue && strip > 0 && <div data-rig-strip style={{ height: strip }} className="rounded-t-xl bg-card" />}
      {params.realComposer ? (
        <RealComposer />
      ) : (
        <div
          data-rig-composer
          style={{ height: 96 + (lines - 1) * 20 }}
          className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground"
        >
          Composer
        </div>
      )}
    </div>
  );
}
