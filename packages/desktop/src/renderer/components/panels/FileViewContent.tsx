import React, { Suspense } from 'react';
import { useTabsStore } from '../../store/tabs';

const EditorTab = React.lazy(() => import('../center/EditorTab').then((m) => ({ default: m.EditorTab })));
const DiffTab = React.lazy(() => import('../center/DiffTab').then((m) => ({ default: m.DiffTab })));
const SkillEditorTab = React.lazy(() =>
  import('../center/SkillEditorTab').then((m) => ({ default: m.SkillEditorTab })),
);

function EditorFallback(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading editor...</div>
  );
}

export function FileViewContent(): React.ReactElement | null {
  const fileView = useTabsStore((s) => s.fileView);
  if (!fileView) return null;

  return (
    <Suspense fallback={<EditorFallback />}>
      {fileView.type === 'editor' && <EditorTab filePath={fileView.filePath} />}
      {fileView.type === 'diff' && (
        <DiffTab
          filePath={fileView.filePath}
          source={fileView.source}
          chatId={fileView.chatId}
          oldPath={fileView.oldPath}
          original={fileView.original}
          modified={fileView.modified}
          startLine={fileView.startLine}
        />
      )}
      {fileView.type === 'skill-editor' && <SkillEditorTab skillId={fileView.skillId} adapterId={fileView.adapterId} />}
    </Suspense>
  );
}
