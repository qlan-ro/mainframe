/**
 * Per-capture badge color palette. Each capture's metadata-sidecar row gets a
 * stable color from this palette, cycled by index. Multiple captures in one
 * message become distinguishable at a glance — the same color always appears
 * at the same position, so the user can pair a breadcrumb badge with its
 * matching thumbnail by visual order.
 */
const PALETTE: ReadonlyArray<string> = [
  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  'bg-rose-500/15 text-rose-300 border-rose-500/30',
];

export function captureBadgeClass(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}
