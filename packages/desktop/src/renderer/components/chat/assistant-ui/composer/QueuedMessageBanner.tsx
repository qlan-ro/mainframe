import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { daemonClient } from '../../../../lib/client';

export function QueuedMessageBanner({ chatId }: { chatId: string }) {
  const queuedMessage = useChatsStore((s) => s.queuedMessages.get(chatId));
  const [text, setText] = useState(queuedMessage?.content ?? '');

  useEffect(() => {
    setText(queuedMessage?.content ?? '');
  }, [queuedMessage?.content]);

  const handleSave = useCallback(() => {
    if (!queuedMessage) return;
    const trimmed = text.trim();
    if (trimmed && trimmed !== queuedMessage.content) {
      daemonClient.editQueuedMessage(chatId, queuedMessage.id, trimmed);
    }
  }, [chatId, queuedMessage, text]);

  const handleCancel = useCallback(() => {
    if (!queuedMessage) return;
    daemonClient.cancelQueuedMessage(chatId, queuedMessage.id);
  }, [chatId, queuedMessage]);

  if (!queuedMessage) return null;

  return (
    <div className="mx-3 mb-2 p-2 bg-mf-panel-bg border border-mf-border rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-mf-status text-mf-text-secondary">Queued message</span>
        <button
          type="button"
          onClick={handleCancel}
          className="text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          aria-label="Cancel queued message"
        >
          <X size={14} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleSave}
        className="w-full bg-mf-bg text-mf-small text-mf-text-primary border border-mf-border rounded p-1.5 resize-none outline-none focus:border-mf-accent"
        rows={Math.min(text.split('\n').length, 4)}
      />
    </div>
  );
}
