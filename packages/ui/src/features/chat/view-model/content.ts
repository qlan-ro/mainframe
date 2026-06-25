/**
 * Shared view-model primitives for the DisplayMessage → ThreadMessageLike
 * projection. One home for the content-part alias, the ≥1-part guard, and the
 * SINGLE `as`-cast site for synthetic/tool args (so the unsafe cast lives in
 * exactly one place instead of being sprinkled across the projection).
 */
import type { ThreadMessageLike } from '@assistant-ui/react';

export type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];
type ReadonlyJSONObject = import('assistant-stream/utils').ReadonlyJSONObject;

/** Guarantees ≥1 content part so assistant-ui never receives an empty array. */
export function ensureNonEmpty(parts: ContentPart[]): ContentPart[] {
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

/**
 * The one place a typed args object is widened to the native part's
 * `ReadonlyJSONObject`. The daemon payload is structurally JSON; the cast is
 * unavoidable at the assistant-ui boundary, but it is confined here.
 */
export function toJsonArgs<T extends object>(args: T): ReadonlyJSONObject {
  return args as unknown as ReadonlyJSONObject;
}
