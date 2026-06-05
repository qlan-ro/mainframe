/**
 * directive-text — shadcn/assistant-ui vendored component, warm-chrome restyled.
 *
 * Provides `createDirectiveText(formatter, options?)` for building inline-chip
 * text renderers from a custom `Unstable_DirectiveFormatter`.
 *
 * Usage:
 *   const MyText = createDirectiveText(myFormatter, { iconMap: { mention: AtSign } });
 *   // Use MyText as a TextMessagePartComponent or as a markdown `p` child renderer.
 *
 * Chip styling follows warm-chrome mf-chip token (rgba overlay on current surface).
 * No /opacity modifier — uses solid token values only.
 */
import { memo, type FC } from 'react';
import type { TextMessagePartComponent, Unstable_DirectiveFormatter } from '@assistant-ui/react';
import { cn } from '@/lib/utils';

type IconComponent = FC<{ className?: string }>;

export type CreateDirectiveTextOptions = {
  /** Maps a directive `type` to an icon component. */
  iconMap?: Record<string, IconComponent>;
  /** Icon rendered when `iconMap` has no entry for the segment type. */
  fallbackIcon?: IconComponent;
};

// ── Warm-chrome chip ─────────────────────────────────────────────────────────

interface DirectiveChipProps {
  type: string;
  label: string;
  id: string;
  Icon?: IconComponent;
}

function DirectiveChip({ type, label, id, Icon }: DirectiveChipProps) {
  return (
    <span
      data-slot="directive-text-chip"
      data-directive-type={type}
      data-directive-id={id}
      aria-label={`${type}: ${label}`}
      className={cn(
        'aui-directive-chip',
        'inline-flex items-center gap-1',
        'rounded-md px-1.5 py-0.5',
        'bg-mf-chip text-primary',
        'font-mono text-caption font-medium',
        'border border-border',
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      {label}
    </span>
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a `TextMessagePartComponent` that parses directive syntax and renders
 * inline chips for each resolved directive segment.
 *
 * When the text has no directives, it renders the raw text with no overhead.
 */
export function createDirectiveText(
  formatter: Unstable_DirectiveFormatter,
  options?: CreateDirectiveTextOptions,
): TextMessagePartComponent {
  const iconMap = options?.iconMap;
  const fallbackIcon = options?.fallbackIcon;

  const Component: TextMessagePartComponent = ({ text }) => {
    const segments = formatter.parse(text);

    if (segments.length === 1 && segments[0]!.kind === 'text') {
      return <>{text}</>;
    }

    return (
      <>
        {segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return (
              <span key={i} className="whitespace-pre-wrap">
                {seg.text}
              </span>
            );
          }

          const Icon = iconMap?.[seg.type] ?? fallbackIcon;
          return <DirectiveChip key={i} type={seg.type} label={seg.label} id={seg.id} Icon={Icon} />;
        })}
      </>
    );
  };

  Component.displayName = 'DirectiveText';
  return Component;
}

// ── Default export ────────────────────────────────────────────────────────────

import { unstable_defaultDirectiveFormatter } from '@assistant-ui/react';

const DirectiveTextImpl = createDirectiveText(unstable_defaultDirectiveFormatter);

/**
 * `TextMessagePartComponent` that parses `:type[label]{name=id}` directives and
 * renders them as inline warm-chrome chips. For per-type icons or a custom format,
 * build a component with `createDirectiveText(formatter, { iconMap })`.
 */
export const DirectiveText: TextMessagePartComponent = memo(DirectiveTextImpl);
DirectiveText.displayName = 'DirectiveText';
