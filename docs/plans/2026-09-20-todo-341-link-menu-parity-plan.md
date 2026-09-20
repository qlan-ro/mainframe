# Todo #341 — link menu parity (size:s)

## Goal

Every http(s) link in the transcript offers the same three actions — **Open in Mainframe** (a workspace URL tab via the `open-url-tab` surface intent), **Open in browser** (the renderer's existing external opener), and **Copy link** — regardless of whether it rendered as the localhost tunnel chip or as the plain preview link. The gesture stays per renderer (right-click context menu on plain links, dropdown button on the chip) and the chip keeps its tunnel badge and stop-tunnel control; only the *row set* is unified, from one shared source. An href that does not already carry an `http:`/`https:` scheme omits the in-app row rather than rendering it broken. A non-loopback URL must never start a tunnel — including when the session runs on a remote daemon.

## Files touched

| File | Change |
| --- | --- |
| `packages/ui/src/features/chat/parts/link-menu-actions.tsx` (new) | The single row-set source: `httpLinkHref(href)` gate, the ordered descriptor list (in-app / browser / copy) with labels, icons and per-renderer testids, and `useCopyHref` moved here from `link-with-preview.tsx`. |
| `packages/ui/src/features/chat/parts/link-with-preview.tsx` | Renders the shared descriptors as `ContextMenuItem`s; gains the in-app row; "Open link" relabels to "Open in browser". |
| `packages/ui/src/features/chat/smart-actions/UrlChip.tsx` | Renders the same descriptors as `DropdownMenuItem`s; gains the copy row; `DropdownMenu` gains `onOpenChange` so copy feedback resets. Tunnel badge / stop control untouched. |
| `packages/ui/src/lib/ui/CopyMenuItem.tsx` | Takes the menu-item component as a prop so the chip can render the same copy row with `DropdownMenuItem`. |
| `packages/ui/src/features/chat/parts/__tests__/link-menu.test.tsx` (new) | Plain-link menu: row set, single in-app emission, non-http(s) omission. New file because `markdown-text.test.tsx` is already 377 lines against the 300-line cap. |
| `packages/ui/src/features/chat/smart-actions/__tests__/url-chip-menu.test.tsx` | Adds the chip's copy row; existing order/emission assertions must still pass. |
| `packages/e2e/UNUSED-TESTIDS.md` | Add the new testids so the doc does not drift. |
| `.changeset/*.md` | Patch for `@qlan-ro/mainframe-ui`. |

## Design decisions already fixed

- **The in-app gate is a scheme check, not `normalizePreviewUrl`.** The brief named the workspace normalizer as the gate; it is an address-bar helper that injects `http://` into scheme-less input, so it accepts relative hrefs (see Established facts). The gate is instead: `new URL(href)` with no scheme injection, row renders only when `protocol` is `http:` or `https:`. Relative hrefs throw, `mailto:` fails the protocol check — both omit the row. The subscriber still normalizes on receipt, so this is a second gate, not a replacement.
- **Testids:** plain link uses the design-direction names `chat-link-open-in-app`, `chat-link-open` (existing), `chat-link-copy` (existing). The chip keeps its shipped `smart-action-url-open-in-app` / `smart-action-url-open-browser` (already asserted in tests) and gains `smart-action-url-copy`. The descriptor carries a testid per renderer.
- **The browser callback is caller-supplied.** The chip's "Open in browser" is `useUrlTunnel().open` (tunnel-aware on a remote daemon, out of scope); the plain link's is `host.shell.openExternal`. Only the in-app emission and the clipboard write are shared behavior.
- **Row order is one order for both:** Open in Mainframe, Open in browser, Copy link.

## Established facts

- `normalizePreviewUrl` cannot gate the in-app row: run in node against `packages/ui/src/features/preview/normalize-url.ts`'s exact body, `'/docs'` → `'http://docs/'`, `'README.md'` → `'http://readme.md/'`, `'mailto:a@b.com'` → `'http://mailto:a@b.com/'`. Only `'#anchor'` returns null. Receipt: `packages/ui/src/features/preview/normalize-url.ts:14` (the `http://` injection).
- The `open-url-tab` subscriber rejects anything that does not normalize, and never starts a tunnel itself. Receipt: `packages/ui/src/store/url-tab-intent-subscriber.ts:33-38`.
- A URL tab starts no tunnel for a non-loopback address: the port is `null` unless `classifyLocalhostUrl` matches, so no port is subscribed and no start is issued — this holds on a remote daemon too. Receipt: `packages/ui/src/features/url-tab/use-url-tab-tunnel.ts:46-49`; a non-loopback URL resolves to `{ kind: 'direct' }` at `packages/ui/src/features/url-tab/resolve-url-target.ts:72` (and a local daemon at :69), so neither path reaches the tunnel branches.
- The subscriber is mounted app-wide, so the in-app row works from every surface that renders markdown. Receipt: `packages/ui/src/layout/SurfaceHost.tsx:58-61`, mounted at `packages/ui/src/app/AppShell.tsx:104`.
- `emitSurfaceIntent` is a module-level listener set with no import-time side effects, so tests and non-chat surfaces can import it freely. Receipt: `packages/ui/src/store/surface-intents.ts:31-36`.
- `useMenuCopyFeedback`'s delayed close (a document-dispatched Escape keydown) also dismisses a Radix **Dropdown** menu: DismissableLayer registers its keydown listener on `ownerDocument` in the capture phase. Receipt: `node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs:105`.
- `CopyMenuItem` hardcodes `ContextMenuItem`, which is why the shared source must be descriptors plus a per-renderer item component, not a rendered component. Receipt: `packages/ui/src/lib/ui/CopyMenuItem.tsx:26`.
- `docs/plans/` is gitignored (`.gitignore:53`) — this plan is committed with `git add -f`.

## Risks

- **Relabelling "Open link" → "Open in browser"** touches a string an e2e test names in a skipped test title (`packages/e2e/tests-tauri/transcript.spec.ts:429`); no live assertion depends on it, but check for any `getByText('Open link')` before landing.
- **Nested menus.** The plain link's context menu must still win over `MessagePathContextMenu` — `markdown-text.test.tsx` covers this and must stay green; do not touch the `onContextMenu` stopPropagation comment/behavior in `link-with-preview.tsx`.
- **File-size cap.** `link-with-preview.tsx` (121) and `UrlChip.tsx` (111) both grow; extracting the descriptors should keep each well under 300.

## Exit gates

- Right-clicking a non-loopback http(s) link shows all three rows; the in-app row emits exactly one `open-url-tab` intent with the link's href, calls no external opener, and issues no tunnel start — including when the session runs on a remote daemon.
- The chip's menu shows the same three rows and still shows its tunnel badge and stop control when a tunnel is live.
- A non-http(s) href renders the menu without the in-app row; copy and external open still work.
- New unit tests cover the plain-link row set, the in-app emission, and the non-http(s) omission; the existing chip and markdown-text suites stay green.
- `packages/ui` typecheck and lint pass (typecheck includes tests).
- A changeset for `@qlan-ro/mainframe-ui` is present; `UNUSED-TESTIDS.md` lists the new testids.

## Implementation group

**`link-menu-parity` (kind: ui)** — one agent, TDD inline: write each failing test and its fix in the same turn, in this order.

1. Extract the shared row-set source (`link-menu-actions.tsx`) with the scheme gate and `useCopyHref`; unit-test the gate against `https://…`, `http://localhost:…`, `mailto:`, `/docs`, `README.md`.
2. Rewire `LinkWithPreview` onto the descriptors, adding the in-app row and the relabel; new `link-menu.test.tsx` covers the row set, the single intent with no opener and no tunnel start (assert the tunnel-start mock stays uncalled even though the plain-link path has no tunnel hook — the point is to pin the guarantee, not to observe an accident), and the non-http(s) omission.
3. Rewire `UrlChip` onto the same descriptors, adding the copy row and `onOpenChange`; extend `url-chip-menu.test.tsx`.
4. Update `UNUSED-TESTIDS.md`, add the changeset, and run the package's typecheck, lint and unit tests.
