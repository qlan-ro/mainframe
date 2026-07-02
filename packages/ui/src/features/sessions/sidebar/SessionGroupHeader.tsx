/**
 * SessionGroupHeader — the label header for one time/status section in the
 * sessions list (Pinned / Today / Yesterday / Earlier / A–Z / By status).
 *
 * Rendered by the virtualized list (`SessionListVirtuoso`) as GroupedVirtuoso's
 * `groupContent`. GroupedVirtuoso owns the sticky positioning of the active
 * group header, so this element carries only the visual chrome (warm glass +
 * blur) and the leading pin glyph on the 'Pinned' group — not `sticky top-0`.
 */
import { PinIcon } from 'lucide-react';

export function SessionGroupHeader({ label }: { label: string }) {
  const inPinnedGroup = label === 'Pinned';
  return (
    <div
      data-testid={`sessions-group-header-${label}`}
      className="flex items-center gap-[4px] bg-mf-glass px-[12px] pb-[3px] pt-[7px] text-micro font-bold uppercase tracking-wide text-mf-text-3 backdrop-blur-[40px] backdrop-saturate-[1.8]"
    >
      {inPinnedGroup && (
        <PinIcon data-testid="sessions-group-pin-glyph" className="size-[9px] flex-shrink-0 text-primary" />
      )}
      {label}
    </div>
  );
}
