/**
 * comment-gutter — public re-export barrel.
 *
 * Implementation is split across two focused modules:
 *   - comment-gutter-state   : CM6 StateField, StateEffects, CommentBlockWidget
 *   - comment-gutter-markers : GutterMarker classes and buildCommentGutter factory
 *
 * All external import paths (CmEditorWithComments, tests) import from this
 * file so they require no changes after the decomposition.
 */
export type { InlineCommentState, AddCommentPayload, CommentFieldValue } from './comment-gutter-state';
export {
  addCommentEffect,
  deleteCommentEffect,
  CommentBlockWidget,
  commentField,
  getCommentsFromState,
  getCommentWidget,
} from './comment-gutter-state';

export type { CommentGutterCallbacks } from './comment-gutter-markers';
export { CommentGutterMarker, AddCommentMarker, buildCommentGutter } from './comment-gutter-markers';
