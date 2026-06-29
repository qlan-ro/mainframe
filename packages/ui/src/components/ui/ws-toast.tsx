'use client';

/**
 * WsToastCard — warm-chrome toast card rendered via sonner's `toast.custom()`.
 *
 * Geometry, chip, countdown rail, CTA, and dismiss button all match the
 * 14-windowstates.jsx prototype spec exactly.
 *
 * WsInfoGlyph — inline SVG info glyph (circle + vertical line + dot).
 * Not in the Lucide set; ported from WsInfoGlyph in the prototype.
 */
import { useEffect, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface WsToastProps {
  id: string | number;
  type: ToastType;
  title: string;
  description?: string;
  chatId?: string;
  /** Invoked with `chatId` when the "Open session →" CTA is clicked. */
  onOpenSession?: (chatId: string) => void;
  onDismiss: (id: string | number) => void;
}

// ─── per-type chip config ─────────────────────────────────────────────────────

const CHIP_CONFIG: Record<ToastType, { bg: string; ink: string }> = {
  success: { bg: 'bg-mf-success-tint', ink: 'text-mf-success' },
  error: { bg: 'bg-mf-destructive-tint', ink: 'text-destructive' },
  warning: { bg: 'bg-mf-warning-tint', ink: 'text-mf-warning' },
  info: { bg: 'bg-primary/10', ink: 'text-primary' },
};

// ─── WsInfoGlyph ─────────────────────────────────────────────────────────────

function WsInfoGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8.2v4" />
      <circle cx="9" cy="5.8" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── status chip icon ─────────────────────────────────────────────────────────

function ChipIcon({ type }: { type: ToastType }) {
  if (type === 'info') return <WsInfoGlyph size={14} />;
  if (type === 'success') return <Check size={14} aria-hidden />;
  // error and warning both use TriangleAlert
  return <TriangleAlert size={14} aria-hidden />;
}

// ─── WsToastCard ─────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 4200;

export function WsToastCard({ id, type, title, description, chatId, onOpenSession, onDismiss }: WsToastProps) {
  const chip = CHIP_CONFIG[type];
  const isAuto = type !== 'error';
  const [hover, setHover] = useState(false);

  // auto-dismiss for non-error toasts; pause while hovered
  useEffect(() => {
    if (!isAuto || hover) return;
    const timer = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [isAuto, hover, id, onDismiss]);

  return (
    <div
      role="alert"
      data-testid="toast-root"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        'relative w-[332px] flex items-start gap-[10px]',
        'pt-[11px] px-[12px] pb-[12px]',
        'rounded-[11px] bg-background border-[0.5px] border-mf-border-hover overflow-hidden',
        'shadow-[var(--mf-shadow-pop)]',
      )}
    >
      {/* status chip */}
      <span
        data-testid="toast-status-chip"
        className={cn(
          'w-[24px] h-[24px] shrink-0 rounded-[8px] inline-flex items-center justify-center mt-[1px]',
          chip.bg,
          chip.ink,
        )}
      >
        <ChipIcon type={type} />
      </span>

      {/* text column */}
      <div className="flex-1 min-w-0">
        <div className="text-body font-semibold text-foreground tracking-tight">{title}</div>
        {description && (
          <div className="text-label text-muted-foreground mt-[3px] leading-normal max-h-[88px] overflow-auto [overflow-wrap:anywhere]">
            {description}
          </div>
        )}
        {chatId && (
          <button
            type="button"
            data-testid="toast-open-session"
            onClick={() => {
              onOpenSession?.(chatId);
              onDismiss(id);
            }}
            className="text-caption font-medium text-primary mt-[6px] block"
          >
            Open session →
          </button>
        )}
      </div>

      {/* dismiss button */}
      <button
        type="button"
        data-testid="toast-dismiss"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(id);
        }}
        className={cn(
          'w-[20px] h-[20px] shrink-0 rounded-[6px] inline-flex items-center justify-center',
          'border-none bg-transparent cursor-pointer',
          'opacity-40 hover:opacity-85 hover:bg-muted/60 transition-opacity',
        )}
      >
        <X size={11} aria-hidden />
      </button>

      {/* countdown rail — hidden for errors and while hovered */}
      {isAuto && !hover && (
        <span
          key={id}
          data-testid="toast-countdown-rail"
          className={cn(
            'absolute left-0 bottom-0 h-[2.5px] rounded-bl-[11px]',
            chip.ink,
            'bg-current opacity-50',
            'animate-[ws-toast-rail_4200ms_linear_forwards]',
          )}
        />
      )}
    </div>
  );
}
