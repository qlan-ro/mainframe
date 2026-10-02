/**
 * `toolCallResult` — split out of `convert-acp-item.ts` to keep that file
 * under the 300-line cap once D6 (streaming status) landed there.
 */
import { MAINFRAME_META_NAMESPACE, StructuredDiffSchema, TruncationMarkerSchema } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';
import { resultImageBlocks, withResultImages } from './tool-result-images';

/**
 * Rebuild the legacy `mapToolResult` shape from the item's content entries:
 * `content` blocks join into the result text; a text block's namespaced meta
 * restores the `truncated`/`fullBytes` pair (spec Decision 20) and the
 * AskUserQuestion answers; a `diff` entry's fidelity payload (spec Decision
 * 15) contributes the structured hunks and before/after file text the
 * Edit/Write cards consume; an `image` entry's data survives on `images` in
 * source order, on whichever shape below is returned (todo #363).
 */
export function toolCallResult(item: Extract<AccumulatedItem, { kind: 'tool-call' }>): unknown {
  if (item.content.length === 0) return item.status === 'completed' || item.status === 'failed' ? '' : undefined;
  const textBlocks = item.content.flatMap((entry) =>
    entry.type === 'content' && entry.content.type === 'text' ? [entry.content] : [],
  );
  const text = textBlocks.map((block) => block.text).join('');
  const blockMetas = textBlocks.map((block) => block._meta?.[MAINFRAME_META_NAMESPACE]);
  const truncation = blockMetas.flatMap((meta) => {
    const parsed = TruncationMarkerSchema.safeParse(meta);
    return parsed.success && parsed.data.truncated ? [parsed.data] : [];
  })[0];
  const askUserQuestion = blockMetas.flatMap((meta) => {
    const answers = (meta as { askUserQuestion?: unknown } | undefined)?.askUserQuestion;
    return Array.isArray(answers) ? [answers] : [];
  })[0];
  const diff = item.content.find((entry) => entry.type === 'diff');
  const fidelity = diff ? StructuredDiffSchema.safeParse(diff._meta?.[MAINFRAME_META_NAMESPACE]) : undefined;
  const images = resultImageBlocks(item.content);
  if (fidelity?.success) {
    return withResultImages(
      {
        content: text,
        structuredPatch: fidelity.data.structuredPatch,
        originalFile: fidelity.data.originalFile,
        modifiedFile: fidelity.data.modifiedFile,
        ...(truncation ? { truncated: true, fullBytes: truncation.fullBytes } : {}),
      },
      images,
    );
  }
  if (truncation)
    return withResultImages({ content: text, truncated: true as const, fullBytes: truncation.fullBytes }, images);
  if (askUserQuestion) return withResultImages({ content: text, askUserQuestion }, images);
  if (images.length > 0) return withResultImages({ content: text }, images);
  return text;
}
