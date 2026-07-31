# `src/v2` — the parallel UI build

A clone of the desktop UI where the design system is rebuilt correctly, running
beside the shipped app instead of replacing it. Nothing outside `src/v2/` and the
four config seams listed below is allowed to change until we flip.

```
pnpm --filter @qlan-ro/mainframe-ui exec vite --port 5199
open http://localhost:5199/v2.html
```

## Why a clone and not an in-place fix

The scale repair changes what `p-2` and `text-body` mean. In place that reflows
~1,300 spacing sites and every type rung at once, with no visual-regression net
in the e2e suite to catch what breaks. Beside it, each surface is ported and
looked at once, and the shipped app keeps working the whole time.

## What is actually different

Only the scale. `src/v2/styles/globals.css` imports the shipped token file and
overrides two things:

1. **Spacing** — the shipped theme overrides `--spacing-1..12` with a compressed
   ramp while Tailwind's fractional steps still resolve off the stock `0.25rem`
   base, so the scale is non-monotonic: `p-2.5` is 10px but `p-3` is 6px. Going
   up a step can go down. v2 sets those twelve overrides back to `initial`, which
   hands the whole scale to Tailwind's 4px base and makes it monotonic.
2. **Type** — the shipped scale has 8 rungs, four of them within 1px of each
   other (10/11/12/13). v2 has 6, each at least 14% from its neighbours.

Colours, radii, shadows, the three schemes and the three window styles are
unchanged and still come from the shipped file. There is one source of colour
truth, and it is not in here.

## Rules

- **Never import `src/proto`, and never edit outside `src/v2`.** The four
  permitted seams are `v2.html`, the `@v2` alias in `vite.config.ts`, the `@v2/*`
  path in `tsconfig.json`, and this directory.
- **Reuse a shipped primitive until you need to change it.** `@/components/ui/*`
  renders under v2 tokens because v2 loads its own CSS bundle — that *is* the
  port for most primitives. Fork one into `src/v2/components/ui/` only when the
  markup itself has to change, and then v2 owns that copy.
- **Dead rungs are a trap.** `text-micro` and `text-label` do not exist in v2.
  A font-size class that isn't defined renders at the inherited size with no
  error, so a shipped primitive that uses one will look subtly wrong rather than
  break. `pnpm --filter @qlan-ro/mainframe-ui exec node scripts/v2-lint.mjs`
  greps for them; run it before calling a port done.
- **Non-visual code is shared, not cloned.** Stores, hooks, `lib/`, the daemon
  client and the assistant-ui runtime are imported from `@/`. Only markup and
  tokens live here.

## Adding a shadcn component

`src/v2` is its own shadcn project root, so the CLI writes into
`src/v2/components/ui` against the v2 stylesheet:

```
pnpm dlx shadcn@latest add <component> -c packages/ui/src/v2
```

The CLI stops on an interactive "Select a component library" prompt that `--yes`
does not skip, so for anything non-trivial it is faster to fetch the registry
JSON and port by hand. Check the lockfile either way — see the
`shadcn-add-churns-lockfile` note; hand-add the Radix dependency to
`packages/ui/package.json` if the CLI tries to install.

## The sidebar

`components/ui/sidebar/` is a port of the registry component, not a copy. Four
things changed, and they are the same four any registry component will need:

- **No `forwardRef`.** React 19; the repo's own primitives are plain functions.
- **No mobile path.** The `Sheet` drawer, `useIsMobile` and every `md:` variant
  are gone — this is a desktop app.
- **A flex child, not a `fixed` overlay.** Upstream positions the panel `fixed`
  and reserves its width with a sibling spacer, which assumes a page scrolling
  behind it. Mainframe's shell is a row of floating panels, so `Sidebar` animates
  its own width and the spacer disappears. The `data-state` / `data-collapsible`
  / `data-side` attributes are kept verbatim — every descendant styles itself off
  them, so keeping the contract keeps the family portable.
- **`--sidebar-*` aliased onto the warm chrome** in `styles/globals.css`
  (`--sidebar` → `--mf-glass`, accent → `--accent`, and so on). The primitives
  keep upstream's class names, so they stay diffable against the registry, and
  because each alias points at a token the six scheme blocks already redefine,
  the panel tracks classic/ocean/velvet × light/dark with no per-scheme work.

Persistence is the caller's: upstream writes a `sidebar_state` cookie, which a
desktop app has no use for, so `SidebarProvider` takes `open`/`onOpenChange`
instead. ⌘B is built in.

## Order of work

1. ~~Project configuration~~
2. ~~globals.css / themes~~
3. ~~App shell~~ — `app/V2Shell.tsx`; no runtime provider, no overlay hosts, no
   session router. Those return with the surfaces they belong to.
4. Features, sidebar first — the sessions sidebar renders off fixtures
   (`features/sessions/fixtures.ts`). Swapping in the real thread list is a
   source change, not a rewrite.
