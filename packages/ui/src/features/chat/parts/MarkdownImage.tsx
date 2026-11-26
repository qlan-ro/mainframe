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
    let cancelled = false;
    setState({ status: 'loading' });
    loadLocalImage(path).then(
      (dataUri) => !cancelled && setState({ status: 'loaded', dataUri }),
      () => !cancelled && setState({ status: 'error' }),
    );
    return () => {
      cancelled = true;
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
