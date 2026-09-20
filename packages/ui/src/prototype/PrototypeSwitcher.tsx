/* PROTOTYPE — floating variant switcher (see variant.ts). */
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LinkFixturePanel } from './LinkFixturePanel';
import { VARIANTS, prototypeGroup, setVariant, useVariant } from './variant';

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function PrototypeSwitcher() {
  const group = prototypeGroup();
  const variant = useVariant();
  const list = group ? VARIANTS[group] : [];
  const idx = Math.max(0, list.findIndex((v) => v.key === variant));
  const step = (d: number) => {
    if (list.length === 0) return;
    setVariant(list[(idx + d + list.length) % list.length]?.key ?? 'A');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const current = list[idx];
  if (!group || !current) return null;
  return (
    <div
      data-testid="prototype-switcher"
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-2 py-1 text-xs text-background shadow-lg ring-1 ring-black/20"
    >
      <button type="button" className="rounded-full p-1 hover:bg-background/20" onClick={() => step(-1)} aria-label="Previous variant">
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="font-mono uppercase opacity-70">{group}</span>
      <span className="font-semibold">
        {current.key} — {current.name}
      </span>
      <button type="button" className="rounded-full p-1 hover:bg-background/20" onClick={() => step(1)} aria-label="Next variant">
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

/** Mounted once in AppShell; renders nothing unless ?prototype= is set in dev. */
export function PrototypeOverlay() {
  const group = prototypeGroup();
  if (!group) return null;
  return (
    <>
      {group === 'links' && <LinkFixturePanel />}
      <PrototypeSwitcher />
    </>
  );
}
