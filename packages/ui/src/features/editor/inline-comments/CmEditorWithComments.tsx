/**
 * CmEditorWithComments — CmEditor + the inline comment gutter + React portals.
 *
 * A thin composition over `useCommentGutter` (which owns the editor-agnostic
 * comment concern: data model, gutter extension, portals, submit/send). This
 * component only binds that concern to a code `CmEditor`:
 * - the gutter extensions are merged into the editor via `extraExtensions`.
 * - the live EditorView is forwarded via `onViewReady` (also passed through to
 *   the parent for context-menu use).
 *
 * The diff viewer shares the same hook via CmDiffEditorWithComments.
 */
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { CmEditorProps } from '../CmEditor';
import { CmEditor } from '../CmEditor';
import { useCommentGutter } from './use-comment-gutter';

type CmEditorWithCommentsProps = Omit<CmEditorProps, 'extraExtensions' | 'onViewReady'> & {
  enableComments?: boolean;
  /** Additional CM6 extensions merged with the comment-gutter extensions (e.g. LSP). */
  extraExtensions?: Extension[];
  /** Called with the live EditorView once mounted; forwarded to parent for context-menu use. */
  onViewReady?: (view: EditorView) => void;
  /**
   * Absolute or repo-relative path to the file being edited.
   * Required for review send; if absent, submit is a no-op with a console warning.
   */
  filePath?: string;
};

export function CmEditorWithComments({
  enableComments = true,
  extraExtensions,
  onViewReady,
  filePath,
  ...editorProps
}: CmEditorWithCommentsProps) {
  const { commentExtensions, handleViewReady, submitBar, portals } = useCommentGutter({
    enableComments,
    extraExtensions,
    onViewReady,
    filePath,
  });

  return (
    <>
      {submitBar}
      <CmEditor {...editorProps} extraExtensions={commentExtensions} onViewReady={handleViewReady} />
      {portals}
    </>
  );
}
