'use client';

/**
 * Markdown `img` override. Local sources (absolute path or `file://`) load
 * their bytes from the daemon and render through `ZoomableImage`; everything
 * else is a plain `<img>`. Every element is phrasing content because
 * react-markdown places images inside `<p>`. Must not use `useDaemonPort()`:
 * this renders on surfaces without the provider.
 *
 * Both kinds sit in a frame of fixed height from the first render, so loading,
 * loading finished and decoding never change the transcript's height: a reader
 * scrolled up stays put and the bottom pin has nothing to catch up on. Markdown
 * carries no image dimensions, so the frame is fixed rather than sized to the
 * image; a larger image scales down into it, a smaller one keeps its size.
 *
 * A load that has not finished after `IMAGE_LOAD_TIMEOUT_MS` (a request that
 * hangs) gives up and shows the same fallback as a failed load.
 */
import { useEffect, useState, type ComponentProps } from 'react';
import { parseFileHref } from '@/lib/files/file-href';
import { cn } from '@/lib/utils';
import { imageMimeForPath, loadLocalImage, localImagePath } from '@/lib/files/local-image';
import { FileRefLink } from './FileRefLink';
import { ZoomableImage } from './ZoomableImage';

type State = { status: 'loading' } | { status: 'loaded'; dataUri: string } | { status: 'error' };

/** The reserved box: the same height while loading and once loaded. */
const FRAME = 'inline-flex h-60 max-w-full items-center align-top';
const LOADING = 'w-64 animate-pulse rounded-md bg-muted ring-1 ring-border';
const IMAGE = 'max-h-60 max-w-full rounded-md border border-border object-contain';

/** How long the skeleton may show before the image counts as unavailable. */
export const IMAGE_LOAD_TIMEOUT_MS = 15_000;

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function LocalMarkdownImage({ src, alt, path }: { src: string; alt?: string; path: string }) {
  const [state, setState] = useState<State>(() =>
    imageMimeForPath(path) ? { status: 'loading' } : { status: 'error' },
  );

  useEffect(() => {
    if (!imageMimeForPath(path)) {
      setState({ status: 'error' });
      return;
    }
    let settled = false;
    const settle = (next: State) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setState(next);
    };
    setState({ status: 'loading' });
    const timeout = setTimeout(() => settle({ status: 'error' }), IMAGE_LOAD_TIMEOUT_MS);
    loadLocalImage(path).then(
      (dataUri) => settle({ status: 'loaded', dataUri }),
      () => settle({ status: 'error' }),
    );
    return () => {
      settled = true;
      clearTimeout(timeout);
    };
  }, [path]);

  if (state.status === 'loading') {
    return <span data-testid="chat-markdown-image-skeleton" data-image-frame className={cn(FRAME, LOADING)} />;
  }
  if (state.status === 'loaded') {
    return (
      <span data-image-frame className={FRAME}>
        <ZoomableImage src={state.dataUri} alt={alt} className={IMAGE} onError={() => setState({ status: 'error' })} />
      </span>
    );
  }
  const fileTarget = parseFileHref(src);
  return (
    <span data-testid="chat-markdown-image-unavailable">
      {fileTarget ? (
        <FileRefLink href={src} fileTarget={fileTarget}>
          {alt || baseName(path)}
        </FileRefLink>
      ) : (
        alt || baseName(path)
      )}
      <span className="text-muted-foreground"> (image unavailable)</span>
    </span>
  );
}

function RemoteMarkdownImage({ className, ...props }: ComponentProps<'img'>) {
  const [status, setStatus] = useState<State['status']>('loading');
  const src = typeof props.src === 'string' ? props.src : '';
  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = setTimeout(() => setStatus('error'), IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status]);
  if (status === 'error') {
    return (
      <span data-testid="chat-markdown-image-unavailable">
        {props.alt || baseName(src)}
        <span className="text-muted-foreground"> (image unavailable)</span>
      </span>
    );
  }
  return (
    <span data-image-frame className={cn(FRAME, status === 'loading' && LOADING)}>
      <img
        {...props}
        className={cn(IMAGE, className)}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </span>
  );
}

export function MarkdownImage({ node: _node, ...props }: ComponentProps<'img'> & { node?: unknown }) {
  const src = typeof props.src === 'string' ? props.src : '';
  const path = src ? localImagePath(src) : null;
  if (path === null) return <RemoteMarkdownImage key={src} {...props} />;
  return <LocalMarkdownImage src={src} alt={props.alt} path={path} />;
}
