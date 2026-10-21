import type { ToolResultImage } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';
import { subscribeActiveDaemon } from '../daemon/active-daemon';

const IMAGE_REFERENCE = /^\/api\/chats\/[\w-]+\/tool-result\/[\w-]+\/images\/\d+\?v=[a-f0-9]{16}$/;
const MAX_CACHE_CHARS = 16 * 1024 * 1024;
const cache = new Map<string, { pending: Promise<ToolResultImage>; chars: number }>();
subscribeActiveDaemon(() => cache.clear());

export async function getToolImage(uri: string): Promise<ToolResultImage> {
  if (!IMAGE_REFERENCE.test(uri)) throw new Error('Invalid tool image reference');
  const found = cache.get(uri);
  if (found) {
    cache.delete(uri);
    cache.set(uri, found);
    return found.pending;
  }
  const entry = { pending: fetchToolImage(uri), chars: 0 };
  cache.set(uri, entry);
  try {
    const image = await entry.pending;
    if (cache.get(uri) === entry) {
      entry.chars = image.data.length;
      trimCache();
    }
    return image;
  } catch (error) {
    if (cache.get(uri) === entry) cache.delete(uri);
    throw error;
  }
}

async function fetchToolImage(uri: string): Promise<ToolResultImage> {
  const image = await request<ToolResultImage>('GET', `${apiBase()}${uri}`);
  if (
    typeof image?.data !== 'string' ||
    !image.data ||
    typeof image.mediaType !== 'string' ||
    !image.mediaType.startsWith('image/')
  )
    throw new Error('Tool image not available');
  return image;
}

function trimCache() {
  let chars = [...cache.values()].reduce((total, entry) => total + entry.chars, 0);
  for (const [uri, entry] of cache) {
    if (chars <= MAX_CACHE_CHARS) break;
    if (!entry.chars) continue;
    cache.delete(uri);
    chars -= entry.chars;
  }
}
