import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolResultImage } from '@qlan-ro/mainframe-types';
import { getToolImage } from '@/lib/api/tool-images';

export function toolImageDataUrl(image: ToolResultImage): string | undefined {
  return image.data ? `data:${image.mediaType};base64,${image.data}` : undefined;
}

export interface ResolvedToolImage {
  src?: string;
  error?: boolean;
}

type OnResolve = (uri: string, value: ResolvedToolImage) => void;

function observeVisible(element: HTMLElement, load: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    load();
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    },
    { rootMargin: '200px' },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

export function useToolImage(image: ToolResultImage, active: boolean, onResolve: OnResolve) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<ResolvedToolImage & { uri?: string }>({});
  const inline = toolImageDataUrl(image);
  const uri = image.uri;
  useEffect(() => {
    if (inline || !uri || !ref.current || resolved.uri === uri) return;
    let cancelled = false;
    const publish = (value: ResolvedToolImage) => {
      if (cancelled) return;
      setResolved({ uri, ...value });
      onResolve(uri, value);
    };
    const load = () => {
      void getToolImage(uri).then(
        (loaded) => publish({ src: toolImageDataUrl(loaded) }),
        () => publish({ error: true }),
      );
    };
    const stop = active ? (load(), () => {}) : observeVisible(ref.current, load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [inline, uri, active, onResolve, resolved.uri]);
  return {
    ref,
    src: inline ?? (resolved.uri === uri ? resolved.src : undefined),
    error: resolved.uri === uri && resolved.error,
  };
}

export function useImageResolution(images: ToolResultImage[]) {
  const [resolved, setResolved] = useState<Record<string, ResolvedToolImage>>({});
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const onResolve = useCallback((uri: string, value: ResolvedToolImage) => {
    setResolved((current) => ({ ...current, [uri]: value }));
  }, []);
  const retry = (index: number) => {
    const uri = images[index]?.uri;
    if (uri) setResolved((current) => ({ ...current, [uri]: {} }));
    setAttempts((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }));
  };
  return { resolved, attempts, onResolve, retry };
}
