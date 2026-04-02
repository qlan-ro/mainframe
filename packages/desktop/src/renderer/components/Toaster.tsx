import React, { useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useToastStore, type Toast } from '../store/toasts';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { cn } from '../lib/utils';

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 4000;

const TYPE_CONFIG: Record<Toast['type'], { icon: React.ReactNode; style: string }> = {
  success: {
    icon: <CheckCircle2 size={16} className="shrink-0 mt-0.5" />,
    style: 'border-mf-success/30 text-mf-success bg-mf-panel-bg',
  },
  error: {
    icon: <AlertCircle size={16} className="shrink-0 mt-0.5" />,
    style: 'border-mf-destructive/30 text-mf-destructive bg-mf-panel-bg',
  },
  info: {
    icon: <Info size={16} className="shrink-0 mt-0.5" />,
    style: 'border-mf-accent/30 text-mf-accent bg-mf-panel-bg',
  },
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): React.ReactElement {
  useEffect(() => {
    if (toast.type === 'error') return;
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss]);

  const handleClick = useCallback(() => {
    if (!toast.chatId) return;
    const chat = useChatsStore.getState().chats.find((c) => c.id === toast.chatId);
    useChatsStore.getState().setActiveChat(toast.chatId);
    useTabsStore.getState().openChatTab(toast.chatId, chat?.title);
    onDismiss(toast.id);
  }, [toast.chatId, toast.id, onDismiss]);

  const { icon, style } = TYPE_CONFIG[toast.type];

  return (
    <div
      role="alert"
      onClick={handleClick}
      className={cn(
        'w-[340px] rounded-md px-3 py-2 text-sm shadow-lg border',
        'transition-opacity duration-200 flex items-start gap-2',
        style,
        toast.chatId && 'cursor-pointer hover:brightness-110',
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="font-medium select-text text-mf-text-primary">{toast.title}</p>
        {toast.description && (
          <p className="mt-1 text-xs select-text text-mf-text-secondary max-h-24 overflow-y-auto">
            {toast.description}
          </p>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="shrink-0 mt-0.5 opacity-40 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {visible.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
