# macOS Scrollbar Track Design

## Problem

Mainframe uses the standard `scrollbar-color` property for a transparent track. macOS WKWebView delegates scrollbar painting to AppKit, whose expanded scrollbar ignores the requested track color. Overlay scrollbars appear correct, but an expanded scrollbar paints an opaque gray gutter in packaged builds.

## Considered approaches

1. Keep the standards-only rule. This preserves the current source but leaves the WebKit failure unresolved.
2. Add WebKit pseudo-elements beside non-default standard properties. CSS Scrollbars requires WebKit/Blink engines to ignore the pseudo-elements when a standard scrollbar property has a non-default value, so this combination is unreliable.
3. Select one styling path per engine capability. Use `::-webkit-scrollbar` pseudo-elements in engines that expose them and retain `scrollbar-width`/`scrollbar-color` as the fallback. This avoids conflicting APIs and directly controls the native track. This is the selected approach.

## Design

Keep the scrollbar rules in `packages/ui/src/styles/app.css` and inside `@layer base`, preserving Tailwind utility precedence. A `@supports selector(*::-webkit-scrollbar)` branch will set an 8-pixel scrollbar, keep the track transparent, hide the thumb at rest, and reveal the existing `--border` thumb on hover. A mutually exclusive `@supports not selector(*::-webkit-scrollbar)` branch will retain the current standards-based behavior.

The fix changes no component structure, tokens, or interaction model. Scrollbar opt-outs that set `scrollbar-width: none` remain utilities and continue to outrank the base layer.

## Verification

- Add a source-level Vitest guard that requires mutually exclusive WebKit and standards branches, a transparent WebKit track, and hover-only thumb color.
- Run the test once before implementation to prove it catches the current stylesheet.
- Run the focused test, UI typecheck, and production UI build after implementation.
- Build and capture the packaged macOS app with a long chat thread. Confirm the right-edge track matches the content background at rest and while the thumb is visible.

## Scope

This change only fixes scrollbar painting. It does not change the application palette, macOS scrollbar preferences, or Tauri window behavior.
