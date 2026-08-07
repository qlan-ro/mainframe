# `src/v2` — the parallel UI build

A clone of the desktop UI rebuilt on stock shadcn, running beside the shipped app
instead of replacing it. Nothing outside `src/v2/` and the four config seams
listed below is allowed to change until we flip.

```
pnpm --filter @qlan-ro/mainframe-ui exec vite --port 5199
open http://localhost:5199/v2.html
```

## Why a clone and not an in-place fix

The shipped app's design system diverges from stock at almost every layer —
spacing, type, colour, radii, three colour schemes, three window styles. Undoing
that in place reflows ~1,300 spacing sites and every type rung at once, with no
visual-regression net in the e2e suite to catch what breaks. Beside it, each
surface is ported and looked at once, and the shipped app keeps working.

## What this is

Stock shadcn: preset `b2D0wqNxT` on the **`radix-vega`** style.
`styles/globals.css` is that preset's sheet, verbatim, with **six** deviations.
The sheet's own header block is authoritative and explains each; in short:
`--primary` / `--sidebar-primary` (the macOS system blue `#0a84ff` instead of
the preset's two indigos), the near-black ink family (pulled off pure black),
`--success`, `--warning` (a real amber since 2026-08-06 — it shipped as a
`destructive` mix, which made every caution surface read as red), plus two
tokens the preset does not ship at all: `--sidebar-selection` and
`--bubble-tinted`. Everything else is a stock shadcn name at a stock value.

The sheet is short because the bulk of the style ships in the `shadcn` npm
package via `@import "shadcn/tailwind.css"` — that's where utilities like
`no-scrollbar` come from. Radii are derived: one `--radius: 0.625rem` with
`sm/md/lg/xl/2xl/3xl/4xl` as `calc()` multiples of it.

**The style is a component-class choice, not a token one.** `radix-luma` and
`radix-vega` ship byte-identical stylesheets (`cmp` them if you doubt it); the
entire difference is in the class strings the registry writes into
`components/ui/*`. v2 started on Luma and moved to Vega because Luma's pill
geometry (`rounded-4xl` buttons, `rounded-3xl` filled inputs) was too round for
this app — a swap of the primitive files, with `globals.css` untouched.

**Nothing else Mainframe-specific is in here, on purpose.** No `mf-*` tokens, no
named type rungs, no compressed spacing, no colour schemes, no window styles. The
point is to see the stock baseline before anything is added back. Two known
losses that will want tokens eventually, both commented where they bite
(`features/sessions/fixtures.ts`):

- **Project identity colours** ride the chart ramp, which is monochrome emerald
  here — four lightnesses of one hue, not four identities.
- **Status colours** have no stock hue beyond `destructive`, so running/waiting
  separate on accent intensity. "Waiting" losing its amber is a real loss.

## Rules

- **Never import `src/proto`, and never edit outside `src/v2`.** The four
  permitted seams are `v2.html`, the `@v2` alias in `vite.config.ts`, the `@v2/*`
  path in `tsconfig.json`, and this directory.
- **Primitives are v2's own.** `components/ui/*` are stock `radix-vega` files;
  do not import `@/components/ui/*` — the shipped copies carry custom classes
  that are undefined here.
- **Undefined utilities are a trap.** A font-size or colour class that doesn't
  exist renders at the inherited value with no error, so a stray `text-label` or
  `bg-mf-glass` looks subtly wrong rather than breaking.
  `pnpm --filter @qlan-ro/mainframe-ui exec node scripts/v2-lint.mjs` greps for
  the whole removed set; run it before calling a port done.
- **Non-visual code is shared, not cloned.** Stores, hooks, `lib/`, the daemon
  client and the assistant-ui runtime are imported from `@/`. Only markup and
  tokens live here.

## Adding a shadcn component

The style is fixed by `style: "radix-vega"` in `components.json`; `shadcn add` has
no base flag and will prompt interactively for one if it can't infer the project.
The reliable path is to scaffold a throwaway reference project and copy out of
it:

```
npx shadcn@latest create -p vega -b radix -t vite -n vegaref -y
cd vegaref && npx shadcn@latest add <component>
```

then copy the file into `src/v2/components/ui/`, rewriting `@/lib/utils` →
`@v2/lib/utils` and `@/components/ui` → `@v2/components/ui`. Check the lockfile
either way — see the `shadcn-add-churns-lockfile` note; hand-add any Radix
dependency to `packages/ui/package.json` rather than letting the CLI install.

Modern shadcn imports the unified `radix-ui` package (`import { Slot } from
"radix-ui"`), not the fifteen separate `@radix-ui/*` entries the shipped app uses.

## The sidebar

`components/ui/sidebar/` is the canonical 703-line registry sidebar, split into four
files to satisfy the 300-line rule (`context` / `sidebar` / `sections` / `menu`).
Three things changed:

- **No mobile path.** The `Sheet` drawer, `useIsMobile` and every `md:` variant
  are gone — this is a desktop app.
- **A flex child, not a `fixed` overlay.** Upstream positions the panel `fixed`
  and reserves its width with a sibling spacer, which assumes a page scrolling
  behind it. Mainframe's shell is a row of panels inside a window, so `Sidebar`
  animates its own width and the spacer, the breakpoints and the floating/inset
  variants disappear with it. The `data-state` / `data-collapsible` / `data-side`
  attributes are kept verbatim — every descendant styles itself off them, so
  keeping the contract keeps the family portable.
- **No cookie.** Upstream writes `sidebar_state`, which a desktop app has no use
  for; `SidebarProvider` takes `open`/`onOpenChange` instead. ⌘B is built in.

Width is stock `16rem`, not the shipped app's 280px — narrower, so session titles
truncate sooner. Widen it here if the sessions list needs it.

## Order of work

1. ~~Project configuration~~
2. ~~globals.css / themes~~ — now the stock preset; see *What this is* above.
3. ~~App shell~~ — `app/V2Shell.tsx`; no runtime provider, no overlay hosts, no
   session router. Those return with the surfaces they belong to.
4. Features, sidebar first — the sessions sidebar renders off fixtures
   (`features/sessions/fixtures.ts`). Swapping in the real thread list is a
   source change, not a rewrite.
