/**
 * ACP content blocks and streamed chunks (todo #350), scoped to the `text`
 * and `image` variants (spec Decision 22): both have producers
 * (`LeafContent.Text`/`Image`), while `audio`/`resource`/`resource_link`
 * stay out — no producer in any adapter pipeline (spec Decision 17).
 * Mirrors `mainframe-types/src/acp/content.rs`.
 */
import { z } from 'zod';

export type MessageId = string;

/**
 * `_meta` mirrors the schema's discipline of reserving it on essentially
 * every nested struct; Mainframe uses it for the namespaced truncation
 * marker on tool-result text (`extensions.ts`'s `TruncationMarker`).
 */
export const TextContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;

/** Schema `ImageContent`: base64 `data` + `mimeType` required, `uri` optional. */
export const ImageContentBlockSchema = z
  .object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
    uri: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [TextContentBlockSchema, ImageContentBlockSchema]);
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
