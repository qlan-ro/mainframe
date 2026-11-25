/**
 * What Copy, Quote and Export take from a message. An agent's reply is its
 * turn's whole answer, which can span messages (a compaction or a skill's text
 * falls between two parts of it); anything else is the message's own text.
 */
import { useAui } from '@assistant-ui/react';
import { useAnswerText } from './turn/turn-context';

export function useReplyText(): () => string {
  const aui = useAui();
  const answer = useAnswerText();
  return () => {
    const { id, role, content } = aui.message.getState();
    const own = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');
    return (role === 'assistant' && answer(id)) || own;
  };
}
