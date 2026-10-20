import type { AcpChatController } from '../../chat/controller/acp-chat-controller';

type Controller = Pick<AcpChatController, 'hasRemoteId' | 'subscribeLive' | 'holdActive'>;
interface ThreadSource {
  getState(): { mainThreadId: string };
  subscribe(listener: () => void): () => void;
}

function holdController(controller: Controller) {
  const stopLive = controller.subscribeLive();
  const stopActive = controller.holdActive();
  return () => {
    stopLive();
    stopActive();
  };
}

export function subscribeSelectedChat(source: ThreadSource, find: (id: string) => Controller | undefined) {
  let current: Controller | undefined;
  let release: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  const sync = () => {
    if (disposed) return;
    const candidate = find(source.getState().mainThreadId);
    const next = candidate?.hasRemoteId() ? candidate : undefined;
    if (next === current) return;
    const version = ++generation;
    current = next;
    const previousRelease = release;
    release = undefined;
    previousRelease?.();
    if (!next || version !== generation) return;
    const stop = holdController(next);
    if (version !== generation) stop();
    else release = stop;
  };
  const unsubscribe = source.subscribe(sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    generation++;
    unsubscribe();
    const stop = release;
    release = undefined;
    current = undefined;
    stop?.();
  };
}
