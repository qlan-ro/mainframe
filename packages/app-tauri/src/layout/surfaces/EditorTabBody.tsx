/**
 * EditorTabBody — dispatches to the correct tab body component based on tab.kind.
 *
 * Centralises the kind → component routing so FilesSurface stays under 30 lines.
 *
 * data-testid: delegated to each body component.
 */
import type { EditorTabModel, DiffTabModel } from '@/store/tabs';
import { EditorTab } from '@/features/editor/EditorTab';
import { DiffTab } from '@/features/editor/DiffTab';
import { SkillEditorTab } from '@/features/editor/SkillEditorTab';
import { ViewerRouter } from '@/features/viewers/viewer-router';

interface EditorTabBodyProps {
  tab: EditorTabModel;
}

export function EditorTabBody({ tab }: EditorTabBodyProps) {
  if (tab.kind === 'diff') {
    const diffTab = tab as DiffTabModel;
    return <DiffTab path={tab.path} original={diffTab.original} modified={diffTab.modified} />;
  }

  if (tab.kind === 'skill') {
    return <SkillEditorTab tabId={tab.id} path={tab.path} />;
  }

  if (tab.kind === 'viewer') {
    return <ViewerRouter path={tab.path} />;
  }

  // kind === 'code'
  return <EditorTab tabId={tab.id} path={tab.path} />;
}
