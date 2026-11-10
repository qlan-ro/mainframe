/**
 * Local image sources in assistant Markdown: classify a `src` as a host
 * filesystem path, and load its bytes from the daemon as a data URI.
 */
import { getExternalFile } from '@/lib/api/files';
import { apiBase } from '@/lib/api/http';
import { parseFileHref } from './file-href';
import { fileUriToPath } from './file-uri';

const ABSOLUTE_RE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
const MAX_CACHE_ENTRIES = 32;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Absolute host path of a local image source (`file://` or absolute path), else `null`. */
export function localImagePath(src: string): string | null {
  // A drive letter parses as a URL scheme, so Windows paths bypass parseFileHref.
  if (/^([A-Za-z]:[\\/]|\\\\)/.test(src)) return src;
  const target = parseFileHref(src);
  if (!target) return null;
  const path = src.toLowerCase().startsWith('file:') ? fileUriToPath(target.path) : target.path;
  return ABSOLUTE_RE.test(path) ? path : null;
}

export function imageMimeForPath(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}

const cache = new Map<string, Promise<string>>();

/** Loads the image as a data URI. In-flight and settled results (rejections too) are cached, bounded. */
export function loadLocalImage(path: string): Promise<string> {
  const key = apiBase() + path;
  const hit = cache.get(key);
  if (hit) return hit;
  const mime = imageMimeForPath(path);
  const promise = mime
    ? getExternalFile(0, path, 'base64').then((b64) => `data:${mime};base64,${b64}`)
    : Promise.reject(new Error('not an image'));
  cache.set(key, promise);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return promise;
}

/** Test-only. */
export function resetLocalImageCache(): void {
  cache.clear();
}
