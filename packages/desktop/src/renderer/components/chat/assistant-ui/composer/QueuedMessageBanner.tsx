import React, { useState } from 'react';
import { X, Pencil, Clock, Check } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { daemonClient } from '../../../../lib/client';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

function QueuedItem({ chatId, ref: qRef }: { chatId: string; ref: QueuedMessageRef }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(qRef.content);

  const handleCancel = () => {
    daemonClient.cancelQueuedMessage(chatId, qRef.messageId);
  };

  const handleSaveEdit = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== qRef.content) {
      daemonClient.editQueuedMessage(chatId, qRef.messageId, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Clock size={12} className="shrink-0 animate-pulse text-mf-accent" />
      {editing ? (
        <>
          <textarea
            className="flex-1 bg-mf-surface border border-mf-border rounded px-2 py-0.5 text-mf-small text-mf-text-primary resize-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            rows={1}
          />
          <button onClick={handleSaveEdit} className="p-0.5 hover:bg-mf-hover rounded" title="Save edit">
            <Check size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate">{qRef.content}</span>
          <button
            onClick={() => {
              setText(qRef.content);
              setEditing(true);
            }}
            className="p-0.5 hover:bg-mf-hover rounded"
            title="Edit queued message"
          >
            <Pencil size={12} />
          </button>
        </>
      )}
      <button onClick={handleCancel} className="p-0.5 hover:bg-mf-hover rounded" title="Cancel queued message">
        <X size={12} />
      </button>
    </div>
  );
}

export function QueuedMessageBanner({ chatId }: { chatId: string }) {
  const refs = useChatsStore((s) => s.queuedMessages.get(chatId));

  if (!refs || refs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 bg-mf-hover/50 border-t border-mf-border text-mf-small text-mf-text-secondary">
      {refs.map((ref) => (
        <QueuedItem key={ref.uuid} chatId={chatId} ref={ref} />
      ))}
    </div>
  );
}
