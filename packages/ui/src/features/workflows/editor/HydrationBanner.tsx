/**
 * HydrationBanner — shown instead of the builder/YAML panes when a loaded
 * workflow can't be opened visually (Task 20).
 *
 * Two cases share this component:
 * - Unparseable / schema-invalid file: `onConvert` is absent — there is no
 *   draft to hydrate into, so there's nothing to convert.
 * - Comments-only file: `parseWorkflowToDraft` succeeded but the source has
 *   comments that a visual save would silently drop. `onConvert` lets the
 *   user make that loss explicit instead of it happening on first edit.
 */
import { TriangleAlert } from 'lucide-react';
import { ShikiCode } from '@/lib/shiki-tokens';

interface HydrationBannerProps {
  reason: string;
  rawYaml: string;
  onConvert?: () => void;
}

const PRE_CLASS =
  'flex-1 overflow-auto bg-mf-code-bg p-[10px_14px] font-mono text-caption leading-relaxed text-mf-code-fg';

export function HydrationBanner({ reason, rawYaml, onConvert }: HydrationBannerProps): React.ReactElement {
  return (
    <div data-testid="workflows-hydration-banner" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-start gap-2.5 border-b border-border bg-mf-destructive-tint px-4 py-3">
        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-destructive" aria-hidden />
        <div data-testid="workflows-hydration-banner-message" className="min-w-0 flex-1 text-label text-foreground">
          <p className="font-semibold">This workflow can&apos;t be edited visually</p>
          <p className="text-mf-text-3">{reason}</p>
        </div>
        {onConvert && (
          <button
            type="button"
            data-testid="workflows-hydration-banner-convert"
            onClick={onConvert}
            className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-label font-semibold text-foreground hover:bg-accent"
          >
            Convert to visual
          </button>
        )}
      </div>
      <div data-testid="workflows-hydration-banner-yaml" className="flex min-h-0 flex-1 flex-col bg-mf-code-bg">
        <ShikiCode code={rawYaml} lang="yaml" preClass={PRE_CLASS} />
      </div>
    </div>
  );
}
