/**
 * Item shapes, options and the `apply()` outcome type for
 * `AcpItemAccumulator`, split out to keep that file under the 300-line cap.
 * See that file's module doc for the accumulator's overall contract, and
 * `parse-item-meta.ts` for how an item's `meta` is later interpreted.
 */
import {
  ITEM_CREATED_META_KEY,
  type ContentBlock,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from '@qlan-ro/mainframe-types';

export type AccumulatedItemRole = 'user' | 'agent';

/** Where an item's creation frame landed: the live stream, or a resume/full replay (D4 staging). Unset in legacy mode. */
export type AccumulatorItemOrigin = 'live' | 'replay';

export interface AccumulatedMessageItem {
  kind: 'message';
  id: string;
  role: AccumulatedItemRole;
  content: ContentBlock[];
  meta?: Record<string, unknown>;
  origin?: AccumulatorItemOrigin;
}

export interface AccumulatedThoughtItem {
  kind: 'thought';
  id: string;
  content: ContentBlock[];
  meta?: Record<string, unknown>;
  origin?: AccumulatorItemOrigin;
}

export interface AccumulatedToolCallItem {
  kind: 'tool-call';
  id: string;
  title?: string;
  toolKind?: ToolKind;
  status?: ToolCallStatus;
  content: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  meta?: Record<string, unknown>;
  origin?: AccumulatorItemOrigin;
}

export type AccumulatedItem = AccumulatedMessageItem | AccumulatedThoughtItem | AccumulatedToolCallItem;

export interface AcpItemAccumulatorOptions {
  /** True once the daemon advertises `itemCreationMarkers` (`MainframeCapabilities`). */
  strictCreation?: boolean;
}

/**
 * `apply()`'s result. `kind: 'needs-replay'` means the frame referenced an
 * unknown id without a creation marker and was NOT applied — the caller
 * (the session plane, U2) routes this to a bounded resync. `'ignored'`
 * means the frame was a no-op by wire grammar (a clear for an id the
 * accumulator never held). `created` is true only when this call made a
 * brand-new item (used by the staged replay to cross-check `itemCount`).
 */
export interface ApplyOutcome {
  kind: 'applied' | 'ignored' | 'needs-replay';
  created: boolean;
}

export const APPLIED: ApplyOutcome = { kind: 'applied', created: false };
export const APPLIED_CREATED: ApplyOutcome = { kind: 'applied', created: true };
export const IGNORED: ApplyOutcome = { kind: 'ignored', created: false };
export const NEEDS_REPLAY: ApplyOutcome = { kind: 'needs-replay', created: false };

const MAINFRAME_NS = '_mainframe.dev';

/** True only for the frame shape `create_update` (daemon `session_state/updates.rs`) stamps — nothing else sets this key. */
export function isCreationFrame(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  const ns = meta[MAINFRAME_NS];
  if (typeof ns !== 'object' || ns === null) return false;
  return (ns as Record<string, unknown>)[ITEM_CREATED_META_KEY] === true;
}

/** Append a chunk's block, coalescing text into a trailing text block. */
export function appendBlock(blocks: ContentBlock[], incoming: ContentBlock): ContentBlock[] {
  const tail = blocks[blocks.length - 1];
  if (incoming.type === 'text' && tail?.type === 'text') {
    return [...blocks.slice(0, -1), { ...tail, text: tail.text + incoming.text }];
  }
  return [...blocks, incoming];
}

/** `undefined` = leave unchanged, `null` = clear, value = replace — the wire patch grammar, applied generically. */
export function patchField<T>(current: T | undefined, incoming: T | null | undefined): T | undefined {
  if (incoming === undefined) return current;
  return incoming === null ? undefined : incoming;
}
