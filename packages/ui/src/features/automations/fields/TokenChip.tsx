/**
 * TokenChip — read-only render of a resolved token (ts153 wf2-fields.jsx
 * `WfTokenChip`, ported off the prototype's inline `tok()` object onto the
 * contract's flat `{token: TokenRef}` chip part: a committed part carries no
 * label/color/icon of its own, so callers resolve a `TokenDescriptor` first
 * (from the current scope, or `resolve.ts` for out-of-scope refs) and this
 * component only renders the display.
 *
 * Colors are per-`TokenSourceKind`, not per-token — `sourceKindStyle` is the
 * one place that mapping lives, reused by `TokenPicker`'s row icons. Per the
 * 2026-07-11 typography audit (§1, approved drift from the prototype): the
 * hue lives on the icon + tint background only; the label text stays
 * `text-foreground` — never colored text on a colored fill.
 */
import type { LucideIcon } from 'lucide-react';
import { Clock, MessageCircle, Plug, RotateCw, Sparkles, TriangleAlert, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TokenDescriptor, TokenSourceKind } from '../domain/tokens';

interface SourceStyle {
  icon: LucideIcon;
  iconClass: string;
  tintClass: string;
  borderClass: string;
}

const SOURCE_STYLE: Record<TokenSourceKind, SourceStyle> = {
  builtin: { icon: Clock, iconClass: 'text-muted-foreground', tintClass: 'bg-muted', borderClass: 'border-border' },
  trigger: {
    icon: Zap,
    iconClass: 'text-mf-wf-kind-call',
    tintClass: 'bg-mf-wf-kind-call/12',
    borderClass: 'border-mf-wf-kind-call/30',
  },
  agent: { icon: Sparkles, iconClass: 'text-primary', tintClass: 'bg-primary/12', borderClass: 'border-primary/30' },
  askme: {
    icon: MessageCircle,
    iconClass: 'text-mf-wf-kind-question',
    tintClass: 'bg-mf-wf-kind-question/12',
    borderClass: 'border-mf-wf-kind-question/30',
  },
  action: {
    icon: Plug,
    iconClass: 'text-mf-wf-violet',
    tintClass: 'bg-mf-wf-violet/12',
    borderClass: 'border-mf-wf-violet/30',
  },
  item: {
    icon: RotateCw,
    iconClass: 'text-mf-wf-kind-loop',
    tintClass: 'bg-mf-wf-kind-loop/12',
    borderClass: 'border-mf-wf-kind-loop/30',
  },
};

export function sourceKindStyle(kind: TokenSourceKind): SourceStyle {
  return SOURCE_STYLE[kind];
}

export interface TokenChipProps {
  /** The resolved token, or `null` when its producer no longer exists — renders a "Missing value" chip instead of crashing (validate.ts pins the real issue on the step). */
  descriptor: TokenDescriptor | null;
  /** The drilled-in sub-field (`TokenRef.field`), rendered as "› field". */
  field?: string;
  onRemove?: () => void;
  testId?: string;
}

export function TokenChip({ descriptor, field, onRemove, testId }: TokenChipProps) {
  if (!descriptor) {
    return (
      <span
        data-testid={testId}
        className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 align-middle text-caption font-medium text-foreground"
      >
        <TriangleAlert size={12} className="text-destructive" aria-hidden />
        <span className="truncate">Missing value</span>
        {onRemove && (
          <button
            type="button"
            data-testid={testId ? `${testId}-remove` : undefined}
            onClick={onRemove}
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/15"
          >
            <X size={9} aria-hidden />
          </button>
        )}
      </span>
    );
  }

  const style = SOURCE_STYLE[descriptor.sourceKind];
  const Icon = style.icon;
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex h-5 max-w-[220px] items-center gap-1 rounded-full border align-middle text-caption font-medium text-foreground',
        onRemove ? 'pl-[7px] pr-1' : 'px-2',
        style.tintClass,
        style.borderClass,
      )}
    >
      <Icon size={12} className={style.iconClass} aria-hidden />
      <span className="truncate">
        {descriptor.label}
        {field && <span className="text-muted-foreground"> › {field}</span>}
      </span>
      {onRemove && (
        <button
          type="button"
          data-testid={testId ? `${testId}-remove` : undefined}
          onClick={onRemove}
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
        >
          <X size={9} aria-hidden />
        </button>
      )}
    </span>
  );
}
