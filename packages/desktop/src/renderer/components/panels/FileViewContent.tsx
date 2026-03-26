import React, { Suspense } from 'react';
import { useTabsStore } from '../../store/tabs';
import { getFileViewerType } from '../../lib/file-types';

const EditorTab = React.lazy(() => import('../center/EditorTab').then((m) => ({ default: m.EditorTab })));
const DiffTab = React.lazy(() => import('../center/DiffTab').then((m) => ({ default: m.DiffTab })));
const SkillEditorTab = React.lazy(() =>
  import('../center/SkillEditorTab').then((m) => ({ default: m.SkillEditorTab })),
);
const ImageViewer = React.lazy(() => import('../viewers/ImageViewer').then((m) => ({ default: m.ImageViewer })));
const SvgViewer = React.lazy(() => import('../viewers/SvgViewer').then((m) => ({ default: m.SvgViewer })));
const PdfViewer = React.lazy(() => import('../viewers/PdfViewer').then((m) => ({ default: m.PdfViewer })));
const CsvViewer = React.lazy(() => import('../viewers/CsvViewer').then((m) => ({ default: m.CsvViewer })));

function EditorFallback(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading editor...</div>
  );
}

function renderEditorView(
  filePath: string,
  content?: string,
  line?: number,
  column?: number,
  viewState?: unknown,
): React.ReactElement {
  const viewerType = getFileViewerType(filePath);
  switch (viewerType) {
    case 'image':
      return <ImageViewer filePath={filePath} />;
    case 'svg':
      return <SvgViewer filePath={filePath} />;
    case 'pdf':
      return <PdfViewer filePath={filePath} />;
    case 'csv':
      return <CsvViewer filePath={filePath} />;
    case 'monaco':
      return <EditorTab filePath={filePath} content={content} line={line} column={column} viewState={viewState} />;
  }
}

export function FileViewContent(): React.ReactElement | null {
  const fileView = useTabsStore((s) => s.fileView);
  if (!fileView) return null;

  return (
    <Suspense fallback={<EditorFallback />}>
      {fileView.type === 'editor' &&
        renderEditorView(fileView.filePath, fileView.content, fileView.line, fileView.column, fileView.viewState)}
      {fileView.type === 'diff' && (
        <DiffTab
          filePath={fileView.filePath}
          source={fileView.source}
          chatId={fileView.chatId}
          oldPath={fileView.oldPath}
          original={fileView.original}
          modified={fileView.modified}
          startLine={fileView.startLine}
          base={fileView.base}
        />
      )}
      {fileView.type === 'skill-editor' && <SkillEditorTab skillId={fileView.skillId} adapterId={fileView.adapterId} />}
    </Suspense>
  );
}
