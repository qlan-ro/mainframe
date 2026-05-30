import type { TextMessagePartComponent } from '@assistant-ui/react';
import { getExternalStoreMessages, useMessage } from '@assistant-ui/react';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import { PERMISSION_PLACEHOLDER } from '../convert-message';
import { ErrorPart } from './ErrorPart';
import { MarkdownText } from './markdown-text';

export const MainframeText: TextMessagePartComponent = (props) => {
  const { text } = props;

  if (text === PERMISSION_PLACEHOLDER.text) {
    return null;
  }

  if (!text || text.trim() === '') return null;

  return <MainframeTextInner {...props} />;
};

/**
 * Renders a text part. If the original DisplayMessage has an error block whose
 * message matches this text part, renders an ErrorPart instead of markdown.
 * This avoids the sentinel round-trip: error message text is now carried directly
 * in the text part, and the renderer identifies it by checking the source blocks
 * within the current message only (no cross-message scan).
 */
const MainframeTextInner: TextMessagePartComponent = (props) => {
  const { text } = props;
  const originalMessages = useMessage((m) => getExternalStoreMessages<DisplayMessage>(m));

  // Error parts live only in error-type DisplayMessages, whose single rendered
  // text part IS the error. Key off the message type rather than matching the
  // message string (which could collide with ordinary text). The block-message
  // match is kept as a defensive fallback for any future path that embeds an
  // error block inside a non-error message.
  // The outer message always maps to a single DisplayMessage at index 0.
  const original = originalMessages[0];
  const isError =
    original !== undefined &&
    (original.type === 'error' || original.content.some((block) => block.type === 'error' && block.message === text));

  if (isError) {
    return <ErrorPart message={text} />;
  }

  // data-text-part marks this subtree as searchable by the chat-local FindBar.
  return (
    <div data-text-part>
      <MarkdownText {...props} />
    </div>
  );
};
