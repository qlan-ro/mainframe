/**
 * CmDiffEditorWithComments — CmDiffEditor + the inline comment gutter + portals.
 *
 * The diff twin of CmEditorWithComments: it binds the shared `useCommentGutter`
 * concern to the diff's MODIFIED (right) pane so a reviewer can add the same
 * agent annotations on a diff that they can in the plain editor (#213). The
 * gutter extensions ride in via `extraExtensions` (threaded through the
 * MergeView's `config.b.extensions`, not a pre-built state) and the modified
 * pane's live view arrives via `onViewReady`.
 */
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { CmDiffEditorProps } from '../CmDiffEditor';
import { CmDiffEditor } from '../CmDiffEditor';
import { useCommentGutter } from './use-comment-gutter';

type CmDiffEditorWithCommentsProps = Omit<CmDiffEditorProps, 'extraExtensions' | 'onViewReady'> & {
  enableComments?: boolean;
  /** Additional CM6 extensions merged with the comment-gutter extensions. */
  extraExtensions?: Extension[];
  /** Called with the modified pane's live EditorView once mounted. */
  onViewReady?: (view: EditorView) => void;
  /**
   * File path for the review send; if absent, submit is a no-op with a warning.
   */
  filePath?: string;
};

export function CmDiffEditorWithComments({
  enableComments = true,
  extraExtensions,
  onViewReady,
  filePath,
  ...diffProps
}: CmDiffEditorWithCommentsProps) {
  const { commentExtensions, handleViewReady, submitBar, portals } = useCommentGutter({
    enableComments,
    extraExtensions,
    onViewReady,
    filePath,
  });

  return (
    <>
      {submitBar}
      <CmDiffEditor {...diffProps} extraExtensions={commentExtensions} onViewReady={handleViewReady} />
      {portals}
    </>
  );
}
