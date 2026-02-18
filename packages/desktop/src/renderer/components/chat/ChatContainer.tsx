import React from 'react';
import { MainframeRuntimeProvider } from './assistant-ui/MainframeRuntimeProvider';
import { MainframeThread } from './assistant-ui/MainframeThread';
import { ChatSessionBar } from './ChatSessionBar';

interface ChatContainerProps {
  chatId: string;
}

function ChatContent({ chatId }: { chatId: string }) {
  return (
    <div className="h-full flex flex-col">
      <ChatSessionBar chatId={chatId} />
      <div className="flex-1 overflow-hidden">
        <MainframeThread />
      </div>
    </div>
  );
}

export function ChatContainer({ chatId }: ChatContainerProps): React.ReactElement {
  return (
    <MainframeRuntimeProvider chatId={chatId}>
      <ChatContent chatId={chatId} />
    </MainframeRuntimeProvider>
  );
}
