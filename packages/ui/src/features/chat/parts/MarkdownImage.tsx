'use client';

/**
 * Markdown `img` override. Local sources (absolute path or `file://`) load
 * their bytes from the daemon and render through `ZoomableImage`; everything
 * else is a plain `<img>`. Every element is phrasing content because
 * react-markdown places images inside `<p>`. Must not use `useDaemonPort()`:
 * this renders on surfaces without the provider.
 */
import { useEffect, useState, type ComponentProps } from 'react';
import { parseFileHref } from '@/lib/files/file-href';
import { imageMimeForPath, loadLocalImage, localImagePath } from '@/lib/files/local-image';
import { FileRefLink } from './FileRefLink';
import { ZoomableImage } from './ZoomableImage';

type State = { status: 'loading' } | { status: 'loaded'; dataUri: string } | { status: 'error' };

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
    return (
      <span
        data-testid="chat-markdown-image-skeleton"
        className="inline-block h-40 w-64 animate-pulse rounded-md bg-muted ring-1 ring-border"
      />
    );
  }
  if (state.status === 'loaded') {
    return (
      <ZoomableImage
        src={state.dataUri}
        alt={alt}
        className="max-h-80 max-w-full rounded-md border border-border object-contain"
        onError={() => setState({ status: 'error' })}
      />
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

export function MarkdownImage({ node: _node, ...props }: ComponentProps<'img'> & { node?: unknown }) {
  const src = typeof props.src === 'string' ? props.src : '';
  const path = src ? localImagePath(src) : null;
  if (path === null) return <img {...props} />;
  return <LocalMarkdownImage src={src} alt={props.alt} path={path} />;
}
