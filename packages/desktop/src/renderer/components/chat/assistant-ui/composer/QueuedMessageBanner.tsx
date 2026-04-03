import React, { useState, useEffect } from 'react';
import { X, Pencil, Clock } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { daemonClient } from '../../../../lib/client';

export function QueuedMessageBanner({ chatId }: { chatId: string }) {
  const queuedRef = useChatsStore((s) => s.queuedMessages.get(chatId));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (queuedRef) setText(queuedRef.content);
  }, [queuedRef?.content]);

  if (!queuedRef) return null;

  const handleCancel = () => {
    daemonClient.cancelQueuedMessage(chatId, queuedRef.messageId);
  };

  const handleSaveEdit = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== queuedRef.content) {
      daemonClient.editQueuedMessage(chatId, queuedRef.messageId, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-mf-hover/50 border-t border-mf-border text-mf-small text-mf-text-secondary">
      <Clock size={14} className="shrink-0 animate-pulse text-mf-accent" />
      {editing ? (
        <textarea
          className="flex-1 bg-mf-surface border border-mf-border rounded px-2 py-1 text-mf-small text-mf-text-primary resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSaveEdit();
            }
          }}
          autoFocus
          rows={1}
        />
      ) : (
        <span className="flex-1 truncate">Queued: {queuedRef.content}</span>
      )}
      <button
        onClick={() => setEditing(!editing)}
        className="p-0.5 hover:bg-mf-hover rounded"
        title="Edit queued message"
      >
        <Pencil size={14} />
      </button>
      <button onClick={handleCancel} className="p-0.5 hover:bg-mf-hover rounded" title="Cancel queued message">
        <X size={14} />
      </button>
    </div>
  );
}
