import type { ItemMeta, PresentationSource, TranscriptPresentation } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';

export interface NativePartSource {
  readonly sourceMessageId: string;
  readonly sourceBlockIndex: number;
  readonly presentation: TranscriptPresentation;
  readonly streaming?: boolean;
  readonly startUtf16?: number;
  readonly endUtf16?: number;
}
export type PartSources = Readonly<Record<number, readonly NativePartSource[]>>;
type Parsed = { readonly item: AccumulatedItem; readonly meta: ItemMeta };
type Target = { index: number; source: NativePartSource; text?: string };

function boundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  const before = text.charCodeAt(offset - 1),
    after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function target(item: AccumulatedItem, source: PresentationSource, offset: number): Target | undefined {
  const { target: location, ...identity } = source;
  if (item.kind === 'tool-call')
    return location.type === 'block' && location.contentBlockIndex === 0
      ? { index: offset, source: identity }
      : undefined;
  const block = item.content[location.contentBlockIndex];
  if (!block) return undefined;
  if (location.type === 'block')
    return item.kind === 'message' && block.type === 'image'
      ? { index: offset + location.contentBlockIndex, source: identity }
      : undefined;
  if (
    block.type !== 'text' ||
    !boundary(block.text, location.startUtf16) ||
    !boundary(block.text, location.endUtf16) ||
    location.endUtf16 <= location.startUtf16
  )
    return undefined;
  const prefix =
    item.kind === 'thought'
      ? item.content
          .slice(0, location.contentBlockIndex)
          .reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)
      : 0;
  return {
    index: offset + (item.kind === 'thought' ? 0 : location.contentBlockIndex),
    text:
      item.kind === 'thought'
        ? item.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
        : block.text,
    source: { ...identity, startUtf16: prefix + location.startUtf16, endUtf16: prefix + location.endUtf16 },
  };
}
function covered(targets: Target[]): boolean {
  if (targets[0]?.text === undefined) return targets.length === 1;
  const identities = new Set<string>();
  let end = 0;
  for (const { source } of targets) {
    const identity = JSON.stringify([source.sourceMessageId, source.sourceBlockIndex]);
    if (source.startUtf16 !== end || identities.has(identity) || !boundary(targets[0].text, source.endUtf16!))
      return false;
    identities.add(identity);
    end = source.endUtf16!;
  }
  return end === targets[0].text.length;
}
function mapItem(parsed: Parsed, offset: number): PartSources {
  const entries = parsed.meta.presentationSources?.sources ?? [];
  const mapped = entries.map((entry) => target(parsed.item, entry, offset));
  if (mapped.some((entry) => !entry)) return {};
  const buckets = new Map<number, Target[]>();
  for (const entry of mapped) {
    const values = buckets.get(entry!.index) ?? [];
    values.push(entry!);
    buckets.set(entry!.index, values);
  }
  const result: Record<number, NativePartSource[]> = {};
  for (const [index, values] of buckets) {
    values.sort((a, b) => (a.source.startUtf16 ?? 0) - (b.source.startUtf16 ?? 0));
    if (covered(values)) result[index] = values.map(({ source }) => source);
  }
  return result;
}
export function mapPresentationSources(items: readonly Parsed[]): PartSources | undefined {
  const result: Record<number, readonly NativePartSource[]> = {};
  let offset = 0;
  for (const parsed of items) {
    Object.assign(result, mapItem(parsed, offset));
    offset += parsed.item.kind === 'message' ? parsed.item.content.length : 1;
  }
  return Object.keys(result).length ? result : undefined;
}
export function sourceIdentity(source: NativePartSource): string {
  return JSON.stringify([
    source.presentation.provider,
    source.presentation.turnId,
    source.presentation.parentToolUseId,
    source.sourceMessageId,
    source.sourceBlockIndex,
  ]);
}
