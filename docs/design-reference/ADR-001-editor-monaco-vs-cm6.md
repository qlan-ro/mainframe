# ADR-001 — Editor: Monaco today, CodeMirror 6 as a possible migration

- **Status:** Accepted (Monaco stays for now). CM6 documented as a reversible option — **and, scoped to the feature set in §"Scoped decision", a viable bounded migration.**
- **Date:** 2026-06
- **Context owners:** see `desktop/src/renderer/components/editor/` and `desktop/src/renderer/lib/lsp/`

---

## Scoped decision (2026-06, confirmed with user) — READ FIRST

The general analysis below is worst-case. **The actual editor requirements are narrower**, and they exclude the one genuinely-hard rebuild (peek). Confirmed needed feature set:

1. Syntax highlighting
2. Copy reference (`path:line` → clipboard)
3. Go-to reference / definition — **jump / open in a tab** (NOT inline peek)
4. Find usages — a **references list/panel** (NOT inline peek-references)
5. Gutter icons + inline comment widgets
6. ⌘< / ⌘> navigation (back/forward through jump history)

**Peek-definition is explicitly NOT wanted.** Peek = the floating embedded mini-editor
that opens *inline, in place* under your cursor on go-to-def (and the inline split
list+preview for references). It's the part Monaco spent years polishing and the part
that's hard to reproduce in CM6. Since we want go-to-def to **jump/open a tab** instead,
that cost disappears.

**Re-scored against this scope — every item is Easy or Medium, none Hard:**

| Feature | CM6 effort | Approach |
|---|---|---|
| Syntax highlighting | Easy | `@codemirror/lang-*` per language, or feed Shiki (already in stack) |
| Copy reference | Trivial | Context-menu command → clipboard; no editor UI |
| Go-to reference (jump) | Easy | ⌘-click / command → LSP `definition` → open target tab (we already do this via `registerEditorOpener`) |
| Find usages | Medium | LSP `references` → our own list panel (custom UI, straightforward) |
| Gutter icons + inline comment widgets | Medium | `gutter()` + block `WidgetType` + portal; widget already designed (`EditorCommentWidget`) |
| ⌘< / ⌘> navigation | Easy | Small location-history stack + 2 keybindings |

**Verdict for this scope:** CM6 is a **bounded, days-to-low-weeks** migration, not the
open-ended "weeks" the worst-case implies. The blockers that drove caution — peek-definition
and an inline references-preview — are out of scope. The payoff (native warm-chrome look,
full control of the context menu) is exactly what's wanted. **The only open item to verify
is per-language grammar coverage** (which `lang-*` packs are needed); Shiki covers
highlighting in the interim.

This does NOT auto-trigger a migration — Monaco still works and the hybrid (below) is
cheaper if look & feel is the only itch. But if/when CM6 is chosen, treat it as bounded.

---

## Decision

**Keep Monaco** as the code-editor surface for now. It already provides the
IDE-grade navigation we rely on (⌘-click go-to-definition, peek, find-all-references,
hover types), wired to the daemon's LSP. **CodeMirror 6 (CM6) is a viable future
migration** if Monaco's un-restylable widget chrome (context menu, peek, find bar)
becomes a real blocker — but it is a *weeks-not-days* effort concentrated in three
rebuilds. This ADR records what ports for free vs. what must be rebuilt, so the call
can be made (or executed) later without re-deriving the analysis.

---

## Why this is even on the table

The motivation is **not** capability — Monaco does everything. It's **look & feel**:
Monaco renders its own context menu (`.monaco-menu`), peek widget, and find bar with
**structure we can only recolor, not restructure**. We already route *around* the peek
UI (`setup.ts` uses `registerEditorOpener` to send go-to-def to our own tab instead of
Monaco's inline peek) — evidence that where we dislike Monaco's chrome, we're already
replacing it rather than theming it. CM6's appeal is that *everything* is your own DOM
+ plain-CSS theming, so the warm-chrome look is native, not a fight.

See also: the **hybrid option** (§ "Cheaper alternative") which likely beats a full
migration.

---

## The decisive fact: the LSP layer is already editor-agnostic

`desktop/src/renderer/lib/lsp/lsp-client.ts` is a hand-rolled **WebSocket + JSON-RPC**
client to the daemon. Almost none of it is Monaco:

- `connect` / `initialize` handshake, `sendRequest`, `handleMessage`, `ensureDocumentOpen`/`didOpen`, `toLspUri`, `workspaceFolders`/tsconfig discovery — **pure protocol, ports to CM6 untouched.**
- The only Monaco-coupled edge is the registration shim: three `monaco.languages.register{Definition,Reference,Hover}Provider` calls (gated on the server's advertised `caps.definitionProvider` / `referencesProvider` / `hoverProvider`), plus `toMonacoLocations` mapping LSP ranges → Monaco `Range`.

So a migration does **not** rebuild the brain (daemon ownership, remote code,
monorepo tsconfig seeding). It rebuilds the **UI shells** Monaco draws on top — which
are exactly the surfaces we dislike.

---

## Port map — what each feature costs in CM6

| Feature in use today (Monaco) | CM6 path | Effort | Notes |
|---|---|---|---|
| LSP transport (WS + JSON-RPC, didOpen, initialize, tsconfig discovery) | Reuse `lsp-client` as-is; replace only the provider-registration edge + range mapping | **~free** | Biggest asset; fully decoupled |
| **Hover types** (`registerHoverProvider` → `provideHover`) | `hoverTooltip` from `@codemirror/view` | **Easy** | Clean primitive, fully themeable |
| **⌘-click go-to-definition** | `EditorView.domEventHandlers` mousedown w/ `metaKey` → LSP `definition` → `dispatch` scroll/select (or open our tab, as today) | **Easy** | We already own the "open in tab" behavior via `registerEditorOpener` |
| **Theme / look & feel** | `EditorView.theme` (plain CSS) + a highlight style from `--mf-code-*` | **Easy — this is the win** | Native warm-chrome; the whole reason to consider CM6 |
| **Context menu** ("Copy Reference", "Add Agent Context") | No built-in — build our own (we already designed it: `EditorContextMenu` in the prototype) | **Medium — desirable** | This is a *want*, not a tax: full control, matches the wireframe |
| **Gutter glyph + inline comment widget** | `gutter()` + block `WidgetType` decoration; host a React card via portal (same pattern as today's `createPortal` into a Monaco view-zone) | **Medium** | Prototype `EditorCommentWidget` is the spec |
| View state (scroll/cursor persistence) | Serialize selection + scroll offset yourself | **Easy** | Monaco gives this free; small reimplementation |
| Back/forward + custom keybindings | `keymap.of([...])` | **Easy** | |
| Per-language syntax | One `@codemirror/lang-*` per language (Monaco bundles many tokenizers) | **Low–Medium** | We already run **Shiki** — can feed highlighting; otherwise add lang packages |
| TS/JS definitions via Monaco's built-in web worker | **Lost** — route TS/JS through the daemon's `typescript-language-server` (already bundled) | **Low** | Mostly config; the server already ships |
| **Peek definition** (inline expandable editor) | **No equivalent — build a block widget hosting a mini `EditorView`** | **Hard** | The real cost. See risk below |
| **Find-all-references panel** | No equivalent — render our own panel from the LSP `references` result | **Medium–Hard** | We already fetch the data |
| Diff view (if `DiffPane`/diff editor uses Monaco) | `@codemirror/merge` | **Medium** | Verify current usage first |

---

## Primary risk: peek-definition — *out of scope per §"Scoped decision"*

> Per the confirmed scope, peek is **not** wanted (go-to-def jumps/opens a tab). This
> risk therefore **does not apply** to the actual migration. Retained below as
> background for why peek is the expensive part, should requirements ever change.

Peek done *well* (smooth inline expansion, keyboard nav, nested peeks) is genuinely
fiddly — Monaco spent years on it. A first CM6 version will be simpler. Whether that's
"fine" or "a regression" depends on **how much the workflow leans on peek today**.
**Mitigation already in place:** we route go-to-def to a real editor tab (not inline
peek) via `registerEditorOpener`, so the dependence on Monaco's peek may already be low
— confirm before committing.

Secondary risks: (a) per-language grammar coverage (mitigated by Shiki + lang packs);
(b) losing the free TS/JS worker (mitigated — daemon already runs `typescript-language-server`).

---

## Cheaper alternative (recommended to try first): hybrid

Keep Monaco as the **text-editing + LSP core**, but replace the specific surfaces we
dislike with our own React components — the pattern we've already proven with
`registerEditorOpener`:

1. **Context menu** → suppress Monaco's, listen for `contextmenu` on the editor DOM, open our token-styled menu (the prototype `EditorContextMenu`). *Biggest feel win, ~½ day.*
2. **Hover** → render `provideHover` content through our own hover component (or just recolor `.monaco-hover`).
3. **Peek / go-to-def** → already our own tab. Done.
4. **Find-all-references** → render from the LSP data in our own panel.

This buys most of CM6's control at a fraction of the cost, because it never rebuilds
the two genuinely hard things (text editing + LSP integration) that a CM6 migration
forces you to redo. **Reserve a full CM6 migration for the case where, after replacing
the menu + hover, the *core editor feel* still isn't acceptable.**

---

## Migration checklist (if/when CM6 is chosen)

1. Spike first: one CM6 pane wired to the **real daemon LSP** showing ⌘-click jump + themed hover + a custom peek widget + our context menu, styled with `mainframe-theme.css`. Answers "does navigation feel as good, and do I like the look" in 1–2 days before betting the editor.
2. Refactor `lsp-client.ts`: extract the provider-registration edge + `toMonacoLocations` behind an interface; keep transport untouched.
3. Implement CM6 adapters: `hoverTooltip`, definition mousedown handler, references panel, gutter/comment widgets.
4. Theme: `EditorView.theme` + `HighlightStyle` from `--mf-code-*`; diff via `@codemirror/merge`.
5. Decide TS/JS path: route through daemon `typescript-language-server` (drop the Monaco worker).
6. Port view-state persistence + keybindings.
7. Validate peek UX against today's workflow; accept or iterate.

---

## Consequences

- **Now:** no change. Monaco + daemon LSP stays; if look & feel itches, do the **hybrid** menu/hover replacement first.
- **Later:** CM6 is reversible and de-risked by this map. The expensive parts (peek, references panel, per-lang grammars) are known up front, and the LSP plumbing carries over — so the migration is bounded, not open-ended.
