---
"@qlan-ro/mainframe-ui": patch
---

Replace native HTML `title=` tooltips with a shared themed `Hint` component
across the app-tauri UI. Native `title` tooltips bypassed the design system —
no theming, no positioning control, and the browser's slow default delay. The
new `components/ui/hint.tsx` wraps the shared shadcn/Radix tooltip (self-contained
`TooltipProvider`, renders the child bare when the label is empty) and replaces
~83 native tooltips across 34 files. Genuine `title` component props and the
non-interactive `<embed>` accessibility label are left untouched.
