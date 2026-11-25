'use client';

/** A draft's preview captures and code annotations, as tiles beside its files (C14). */
import { captureLabels } from '@/features/run/format-captures';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useDraftContent, useDraftItems, type DraftCapture, type DraftCodeNote } from './draft-content-store';
import { ExtensionLead, ThumbLead } from './DraftTile';
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

export function DraftContentTiles() {
  const threadId = useActiveThreadId();
  const items = useDraftItems(threadId);
  const setNote = useDraftContent((s) => s.setNote);
  const remove = useDraftContent((s) => s.remove);
  if (threadId == null) return null;

  const captures = items.filter((item): item is DraftCapture => item.kind === 'capture');
  const labels = new Map(captureLabels(captures).map((label, index) => [captures[index]!.id, label]));
  return items.map((item) => {
    const actions = {
      setNote: (note: string) => setNote(threadId, item.id, note),
      remove: () => remove(threadId, item.id),
    };
    return item.kind === 'capture' ? (
      <CaptureTile key={item.id} capture={item} label={labels.get(item.id)!} {...actions} />
    ) : (
      <CodeTile key={item.id} annotation={item} {...actions} />
    );
  });
}
