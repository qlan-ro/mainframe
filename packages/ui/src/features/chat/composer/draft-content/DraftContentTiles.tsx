'use client';

/** A draft's preview captures and code annotations, as tiles beside its files (C14). */
import { useAui } from '@assistant-ui/react';
import { readLiveComposerState } from '../read-live-composer-state';
import { useComposerSegments } from '../segments/segment-store';
import { Button } from '@/components/ui/button';
import { useDraftTarget } from './use-draft-target';
import { partitionDraftItems, targetKey } from './draft-target';
import type { DraftItem } from './draft-content-store';
import { captureLabels } from '@/features/run/format-captures';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useDraftContent, useDraftItems, type DraftCapture, type DraftCodeNote } from './draft-content-store';
import { DraftTile, ExtensionLead, RemoveTileButton, ThumbLead } from './DraftTile';
import { NoteTile } from './NoteTile';

interface TileActions {
  setNote: (note: string) => void;
  remove: () => void;
}

function captureDetail(capture: DraftCapture, label: string): string {
  if (capture.selector) return `${label} · ${capture.selector}`;
  if (capture.region) return `${label} · Region ${Math.round(capture.region.w)}×${Math.round(capture.region.h)}`;
  return label;
}

function CaptureTile({ capture, label, ...actions }: { capture: DraftCapture; label: string } & TileActions) {
  const detail = captureDetail(capture, label);
  return (
    <NoteTile
      testId="composer-capture-tile"
      lead={<ThumbLead src={capture.imageDataUrl} />}
      subject={label}
      detail={detail}
      where={detail}
      note={capture.note}
      {...actions}
    />
  );
}

function CodeTile({ annotation, ...actions }: { annotation: DraftCodeNote } & TileActions) {
  const { filePath, startLine, endLine, note } = annotation;
  const file = filePath.split(/[\\/]/).pop() ?? filePath;
  const lines = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  return (
    <NoteTile
      testId="composer-code-tile"
      lead={<ExtensionLead name={file} />}
      subject={`${file}:${lines}`}
      detail={`${file}:${lines}`}
      where={`${filePath}:${lines}`}
      note={note}
      {...actions}
    />
  );
}

function draftItemLabel(item: DraftItem): string {
  if (item.kind === 'capture') return item.selector || 'Preview capture';
  if (item.kind === 'mention') return item.label;
  return item.filePath.split(/[\\/]/).pop() ?? item.filePath;
}

function SetAsideTile({ item, include, remove }: { item: DraftItem; include: () => void; remove: () => void }) {
  const label = draftItemLabel(item);
  const detail = `from ${item.origin?.projectName ?? item.origin?.projectId ?? 'another workspace'}`;
  const lead = item.kind === 'capture' ? <ThumbLead src={item.imageDataUrl} /> : <ExtensionLead name={label} />;
  return (
    <DraftTile
      testId="composer-set-aside-tile"
      lead={<span className="opacity-60">{lead}</span>}
      title={<span className="truncate text-xs text-muted-foreground">{label}</span>}
      detail={detail}
      full={`${label} · ${detail}`}
      actions={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1 text-xs"
          aria-label={`Include ${label}`}
          onClick={include}
        >
          Include
        </Button>
      }
      remove={<RemoveTileButton label={`Remove ${label}`} onClick={remove} />}
    />
  );
}

export function DraftContentTiles() {
  const threadId = useActiveThreadId();
  const items = useDraftItems(threadId);
  const target = useDraftTarget();
  const { active, setAside: inactive } = partitionDraftItems(items, target);
  const setAside = inactive.filter((item) => item.kind !== 'mention' || !item.removed);
  const aui = useAui();
  const setNote = useDraftContent((s) => s.setNote);
  const remove = useDraftContent((s) => s.remove);
  const include = useDraftContent((s) => s.include);
  const removeBinding = useDraftContent((s) => s.removeBinding);
  if (threadId == null) return null;

  const includeItems = (chosen: readonly DraftItem[]) => {
    include(
      threadId,
      chosen.map(({ id }) => id),
      target,
    );
    const composer = aui.composer;
    const text = readLiveComposerState(composer).text;
    const committed = useComposerSegments.getState().byThread[threadId]?.committed ?? [];
    const tokens = chosen.flatMap((item) => {
      if (item.kind !== 'mention' || text.includes(item.token) || committed.some((s) => s.text.includes(item.token)))
        return [];
      return [item.token];
    });
    if (tokens.length) composer.setText([text.trimEnd(), ...new Set(tokens)].filter(Boolean).join(' '));
  };
  const captures = active.filter((item): item is DraftCapture => item.kind === 'capture');
  const labels = new Map(captureLabels(captures).map((label, index) => [captures[index]!.id, label]));
  return (
    <>
      {active.map((item) => {
        const actions = {
          setNote: (note: string) => setNote(threadId, item.id, note),
          remove: () => remove(threadId, item.id),
        };
        if (item.kind === 'capture')
          return <CaptureTile key={item.id} capture={item} label={labels.get(item.id)!} {...actions} />;
        if (item.kind === 'code') return <CodeTile key={item.id} annotation={item} {...actions} />;
        if (item.includedFor?.includes(targetKey(target)))
          return (
            <span key={item.id} className="self-center text-xs text-muted-foreground">
              {item.label}
            </span>
          );
        return null;
      })}
      {setAside.length > 0 && (
        <div role="group" aria-label="Set-aside draft items" className="flex flex-wrap items-center gap-2">
          {setAside.map((item) => (
            <SetAsideTile
              key={item.id}
              item={item}
              include={() => includeItems([item])}
              remove={() => (item.kind === 'mention' ? removeBinding(threadId, item.id) : remove(threadId, item.id))}
            />
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => includeItems(setAside)}>
            Include all
          </Button>
        </div>
      )}
    </>
  );
}
