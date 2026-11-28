import { useEffect, useSyncExternalStore } from 'react';
import { ComposerPrimitive, useAui } from '@assistant-ui/react';
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
  useEffect(() => {
    controls.setDraft = (text: string) => aui.thread.composer().setText(text);
  }, [aui]);
  return (
    <ComposerPrimitive.Root className="rounded-xl border border-border bg-card p-3">
      <ComposerPrimitive.Input
        data-rig-input
        rows={1}
        submitMode="enter"
        unstable_focusOnRunStart={false}
        unstable_focusOnScrollToBottom={false}
        unstable_focusOnThreadSwitched={false}
        className="block w-full resize-none overflow-hidden bg-transparent px-1 pt-0.5 pb-2 text-sm outline-none"
      />
      <div className="h-8" />
    </ComposerPrimitive.Root>
  );
}

/** A composer-sized footer: the real composer needs a daemon, and only its height matters here (it grows with the draft's lines). */
export function ComposerStub() {
  const lines = useSyncExternalStore(store.subscribe, () => store.get().composerLines);
  return (
    <div className="mx-auto flex w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-col px-5 pb-4">
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
