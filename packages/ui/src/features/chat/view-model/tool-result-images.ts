/**
 * Image-entry extraction for tool-call results (todo #363). Split out of
 * `convert-acp-item.ts` to keep that file under the repo's file-size cap.
 *
 * A `tool_result`'s image blocks are collected separately from the text
 * join so a result's base64 data never lands in the text the
 * `JSON.stringify` fallback (`tools/shared/result.ts`) could otherwise
 * serialize.
 */
import type { ToolResultImage } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';

type ToolCallContentList = Extract<AccumulatedItem, { kind: 'tool-call' }>['content'];

/** Image entries in source order. */
export function resultImageBlocks(content: ToolCallContentList): ToolResultImage[] {
  return content.flatMap((entry) =>
    entry.type === 'content' && entry.content.type === 'image'
      ? [{ mediaType: entry.content.mimeType, data: entry.content.data }]
      : [],
  );
}

/** Adds an `images` field to `shape` only when there is at least one image. */
export function withResultImages<T extends object>(
  shape: T,
  images: ToolResultImage[],
): T | (T & { images: ToolResultImage[] }) {
  return images.length > 0 ? { ...shape, images } : shape;
}
