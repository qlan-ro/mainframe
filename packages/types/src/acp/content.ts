/**
 * ACP content blocks and streamed chunks (todo #350), scoped to the `text`
 * variant — the only block kind the chat facade's text/thought streaming
 * needs. Mirrors `mainframe-types/src/acp/content.rs`; see that file for why
 * `image`/`audio`/`resource`/`resource_link` are deferred.
 */
import { z } from 'zod';

export type MessageId = string;

export const ContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
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
