import { useEffect, useState } from 'react';
import { getEffectiveModel } from './api/adapters';
import { supportsCliModel } from './cli-model';

const pending = new Map<string, Promise<string | null>>();

export function useCliModel(
  port: number | null,
  adapterId: string | undefined,
  projectId?: string,
  chatId?: string,
  refresh = '',
): string | null {
  const key = JSON.stringify([port, adapterId, projectId, chatId, refresh]);
  const [result, setResult] = useState<{ key: string; model: string | null }>();
  useEffect(() => {
    if (port == null || !adapterId || !supportsCliModel(adapterId)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      let request = pending.get(key);
      if (!request) {
        request = getEffectiveModel(port, adapterId, projectId, chatId).catch((error: unknown) => {
          console.warn('[model/useCliModel] resolution failed', error);
          return null;
        });
        pending.set(key, request);
        void request.finally(() => pending.delete(key));
      }
      const model = await request;
      if (!active) return;
      setResult({ key, model });
      if (chatId) timer = setTimeout(() => void read(), 5000);
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, port, adapterId, projectId, chatId]);
  return result?.key === key ? result.model : null;
}
