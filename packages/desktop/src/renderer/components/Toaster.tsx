import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useToastStore, type Toast } from '../store/toasts';
import { cn } from '../lib/utils';

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 4000;

const TYPE_STYLES: Record<Toast['type'], string> = {
  success: 'bg-[#0a2e1a] border border-[#1a5c34] text-mf-success',
  error: 'bg-[#2e0a0a] border border-[#5c1a1a] text-mf-destructive',
  info: 'bg-[#0a1a2e] border border-[#1a345c] text-mf-accent',
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

  return (
    <div
      role="alert"
      className={cn(
        'cursor-pointer rounded-md px-4 py-3 text-sm font-medium shadow-lg',
        'transition-opacity duration-200 flex items-start gap-2',
        TYPE_STYLES[toast.type],
      )}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.type === 'error' && <X size={14} className="shrink-0 mt-0.5 opacity-60 hover:opacity-100" />}
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
