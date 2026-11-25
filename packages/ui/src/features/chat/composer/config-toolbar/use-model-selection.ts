import { useCallback, useRef, useState } from 'react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';

type ModelTarget = Pick<Chat, 'adapterId'> & { model: string };
type ModelSettings = Pick<Chat, 'effort' | 'fast' | 'adaptiveThinking' | 'ultracode'>;

interface Selection {
  scope: string;
  target: ModelTarget;
  result: Promise<Chat | null>;
  accepted?: ModelSettings;
}

function modelSettings(chat: Chat): ModelSettings {
  const { effort, fast, adaptiveThinking, ultracode } = chat;
  return { effort, fast, adaptiveThinking, ultracode };
}

function matches(chat: Chat, target: ModelTarget): boolean {
  return chat.adapterId === target.adapterId && (chat.model || 'default') === target.model;
}

export function useModelSelection(chat: Chat | null, port: number | null) {
  const scope = JSON.stringify([getActiveDaemon().id, port, chat?.id]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const tails = useRef(new Map<string, Promise<unknown>>());
  const pending = selection?.scope === scope ? selection : null;
  const acknowledged = chat && pending?.accepted && matches(chat, pending.target);
  if (selection && (!pending || acknowledged)) setSelection(null);
  const active = acknowledged ? null : pending;

  const enqueue = useCallback(
    <T>(run: () => Promise<T>) => {
      const previous = tails.current.get(scope);
      const result = previous ? previous.then(run) : run();
      const done = result.catch(() => undefined);
      tails.current.set(scope, done);
      void done.then(() => {
        if (tails.current.get(scope) === done) tails.current.delete(scope);
      });
      return result;
    },
    [scope],
  );

  const select = useCallback(
    (target: ModelTarget, run: () => Promise<Chat | null>, requireProvider = false) => {
      const dependency = requireProvider && active?.target.adapterId !== chat?.adapterId ? active?.result : null;
      const result = enqueue(
        dependency ? async () => ((await dependency)?.adapterId === target.adapterId ? run() : null) : run,
      );
      setSelection({ scope, target, result });
      void result.then((confirmed) => {
        setSelection((current) =>
          current?.result === result
            ? confirmed && matches(confirmed, target)
              ? { ...current, accepted: modelSettings(confirmed) }
              : null
            : current,
        );
      });
    },
    [active, chat?.adapterId, enqueue, scope],
  );

  const tune = useCallback(
    (run: () => Promise<unknown>) => {
      if (!active) return enqueue(run);
      // A rejected model pick must never apply its tuning to the previous model.
      return enqueue(async () => {
        const confirmed = await active.result;
        if (confirmed && matches(confirmed, active.target)) return run();
      });
    },
    [active, enqueue],
  );

  const settings =
    active?.accepted ??
    (chat?.adapterId !== active?.target.adapterId
      ? { effort: undefined, fast: undefined, adaptiveThinking: undefined, ultracode: undefined }
      : undefined);
  return {
    chat: chat && active ? { ...chat, ...active.target, ...settings } : chat,
    select,
    tune,
  };
}
