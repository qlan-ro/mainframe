/**
 * ACP content blocks and streamed chunks (todo #350), scoped to the `text`
 * variant — an explicit deviation (spec Decision 17): `image` is blocked on
 * the delta engine's single-text-block chunk grammar, and `audio`/`resource`/
 * `resource_link` have no producer in any adapter pipeline. Mirrors
 * `mainframe-types/src/acp/content.rs`.
 */
import { z } from 'zod';

export type MessageId = string;

/**
 * `_meta` mirrors the schema's discipline of reserving it on essentially
 * every nested struct; Mainframe uses it for the namespaced truncation
 * marker on tool-result text (`extensions.ts`'s `TruncationMarker`).
 */
export const ContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** One streamed item of message content — the `*_chunk` `session/update` payload. */
export const ContentChunkSchema = z
  .object({
    messageId: z.string(),
    content: ContentBlockSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ContentChunk = z.infer<typeof ContentChunkSchema>;
