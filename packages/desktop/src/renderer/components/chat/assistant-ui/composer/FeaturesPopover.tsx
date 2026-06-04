import { useCallback, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { AdapterInfo, Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { Toggle } from '../../../ui/toggle';
import { visibleFeatures } from '../../../../lib/model-tuning';
import { setChatTuning } from '../../../../lib/api';
import { useChatsStore } from '../../../../store/chats';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:features-popover');

export function FeaturesPopover({
  chat,
  adapters,
  modelId,
  disabled = false,
}: {
  chat: Chat;
  adapters: AdapterInfo[];
  modelId: string;
  disabled?: boolean;
}) {
  // Hooks must be unconditional — call all before any early return.
  const updateChat = useChatsStore((s) => s.updateChat);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const setFeature = useCallback(
    (key: keyof SessionTuning, value: boolean) => {
      // Send ONLY the touched field. ultracode→xhigh coercion is a resolver
      // invariant (core), not a UI concern — do NOT also write effort here.
      const patch: SessionTuning = { [key]: value };
      updateChat({ ...chat, ...patch });
      setChatTuning(chat.id, patch).catch((err) =>
        log.warn('setChatTuning failed', { err: String(err) }),
      );
    },
    [chat, updateChat],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const model = adapters.find((a) => a.id === chat.adapterId)?.models.find((m) => m.id === modelId);
  const features = model ? visibleFeatures(model) : [];

  // Hidden entirely when the selected model exposes no tunable features.
  if (features.length === 0) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        data-testid="composer-features-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Feature settings"
        className="flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <SlidersHorizontal size={14} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-mf-card border border-mf-border bg-mf-app-bg p-3 shadow-lg z-50">
          <p className="text-mf-small font-medium text-mf-text-primary mb-2">Features</p>
          <div className="space-y-2">
            {features.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-mf-small text-mf-text-primary">{f.label}</div>
                  <div className="text-mf-label text-mf-text-secondary">{f.desc}</div>
                </div>
                <Toggle
                  data-testid={`composer-feature-${f.key}`}
                  checked={Boolean(chat[f.key as keyof Chat] ?? false)}
                  disabled={disabled}
                  onChange={(v) => setFeature(f.key as keyof SessionTuning, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
