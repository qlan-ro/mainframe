import React from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import { useMessage } from '@assistant-ui/react';
import type { ChatMessage } from '@mainframe/types';
import { ERROR_PLACEHOLDER, PERMISSION_PLACEHOLDER } from '../convert-message';
import { ErrorPart } from './ErrorPart';
import { MarkdownText } from './markdown-text';

export const MainframeText: TextMessagePartComponent = (props) => {
  const { text } = props;
  if (text === ERROR_PLACEHOLDER.text) {
    return <ErrorPartFromMessage />;
  }

  if (text === PERMISSION_PLACEHOLDER.text) {
    return null;
  }

  if (!text || text.trim() === '') return null;

  // Props required by TextMessagePartComponent contract; MarkdownText reads text via context internally
  return <MarkdownText {...props} />;
};

function ErrorPartFromMessage() {
  const originalMessages = useMessage((m) => getExternalStoreMessages<ChatMessage>(m));
  const errorMessage = findErrorMessage(originalMessages);
  return <ErrorPart message={errorMessage} />;
}

function findErrorMessage(messages: ChatMessage[]): string {
  for (const msg of messages) {
    if (msg.type === 'error') {
      for (const block of msg.content) {
        if (block.type === 'error') return block.message;
      }
    }
    for (const block of msg.content) {
      if (block.type === 'error') return block.message;
    }
  }
  return 'An error occurred';
}
