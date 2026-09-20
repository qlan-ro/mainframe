/* PROTOTYPE — a fixture assistant bubble carrying every link shape #341/#355
 * care about, so variants can be judged in the real chrome without seeding a
 * chat. Right-click each link for its menu. */
import { LinkWithPreview } from '@/features/chat/parts/link-with-preview';

const ABS = '/Users/doruchiulan/Projects/qlan/mainframe/packages/ui/src/app/AppShell.tsx:86';
const REL = 'packages/ui/src/features/chat/parts/link-with-preview.tsx';
const FILE_URL = 'file:///Users/doruchiulan/Projects/qlan/mainframe/docs/ARCHITECTURE.md';

export function LinkFixturePanel() {
  return (
    <div
      data-testid="prototype-link-fixture"
      className="fixed bottom-16 right-6 z-[90] w-[460px] rounded-xl bg-card p-4 text-sm leading-relaxed text-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fixture · assistant turn</p>
      <p className="my-2">
        The layout store is seeded in <LinkWithPreview href={ABS}>AppShell.tsx:86</LinkWithPreview>, and the anchor override lives in{' '}
        <LinkWithPreview href={REL}>{REL}</LinkWithPreview>. See also{' '}
        <LinkWithPreview href={FILE_URL}>docs/ARCHITECTURE.md</LinkWithPreview> for the module map.
      </p>
      <p className="my-2">
        Upstream reference: <LinkWithPreview href="https://react.dev/reference/react/useSyncExternalStore">useSyncExternalStore</LinkWithPreview>.
        Dev server: <LinkWithPreview href="http://localhost:5173/settings">http://localhost:5173/settings</LinkWithPreview>.
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">Right-click a link for its menu · click a file link to see the stubbed open-file intent.</p>
    </div>
  );
}
