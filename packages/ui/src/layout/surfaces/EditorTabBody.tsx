/**
 * EditorTabBody — dispatches a file-backed workspace tab (code/diff/skill/viewer)
 * to its body component.
 *
 * The three bodies are lazy: CodeMirror, the merge view and the viewer family are
 * the heaviest modules in the app, and the workspace surface mounts on nearly
 * every session — a terminal-only workspace must not pay for the editor.
 *
 * data-testid: delegated to each body component.
 */
import { lazy, Suspense } from 'react';
import type { RunTab } from '@/store/run-pane';

const EditorTab = lazy(() => import('@/features/editor/EditorTab').then((m) => ({ default: m.EditorTab })));
const DiffTab = lazy(() => import('@/features/editor/DiffTab').then((m) => ({ default: m.DiffTab })));
const ViewerRouter = lazy(() => import('@/features/viewers/viewer-router').then((m) => ({ default: m.ViewerRouter })));

function BodyFallback({ label }: { label: string }) {
  return <div className="grid h-full place-items-center text-caption text-muted-foreground">{label}</div>;
}

export function EditorTabBody({ tab }: { tab: RunTab }) {
  // A file tab always carries a path; a corrupt persisted tab without one says so
  // rather than mounting an editor on `undefined`.
  if (!tab.path) return <BodyFallback label={`${tab.title} — no file path`} />;

  return (
    <Suspense fallback={<BodyFallback label="Loading…" />}>
      {tab.kind === 'diff' ? (
        <DiffTab path={tab.path} original={tab.original} modified={tab.modified} />
      ) : tab.kind === 'viewer' ? (
        <ViewerRouter path={tab.path} />
      ) : (
        // code / skill — a skill file is a markdown file at a different path, so
        // it opens through the normal editor (no dedicated skill tab).
        <EditorTab tabId={tab.id} path={tab.path} />
      )}
    </Suspense>
  );
}
