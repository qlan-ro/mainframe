---
"@qlan-ro/mainframe-app-tauri": patch
---

Artboard-parity drift audit — Phase 3 (per-surface structural majors), from
`docs/architecture/2026-06-17-artboard-parity-drift-audit.md`. **SvgViewer cluster:**

- the Preview/Source segmented toggle moves into the `ViewerShell` breadcrumb-header
  `actions` slot (removing the separate sub-bar that added an extra chrome row);
- source mode renders on the code surface (`bg-mf-code-bg` + `text-mf-code-fg`) instead
  of the default body background;
- preview mode shows the SVG inside a raised, rounded card (`rounded-[11px]`,
  `bg-background`, `--mf-shadow-pop`) over the checkerboard, matching the prototype;
- the active segment gains a 0.5px raised-border ring (was flat).

**Viewers:** CsvViewer filter → ViewerShell `actions` (drop the sub-bar) + sticky thead
`bg-mf-content2` + accent ▲/▼ sort arrows + `statusRight`; ImageViewer Fit/100% + zoom
controls in `actions` + white shadow-card + `statusRight`; UnsupportedViewer `bg-card`
card + 46×46 icon chip + primary-fill CTA.

**Markdown:** MarkdownPreview 720px centering column; MarkdownEditorTab single
ViewerShell (no duplicate chrome) + Preview/Source labels + raised active segment;
`cm-setup` warm theme reads the active mode at build (no longer hardcoded `dark:true`).

**Window chrome / sidebar:** AnswerPill solid amber + 5px radius + 45% amber ring;
StatusDot ping-halo; MainToolbar 40px + CMD+O hint chip; SidebarFooter 25px + working
pulse; sidebar 280px; SidebarHeader hover consistency.

**Chat cards / markers / user-message:** markdown table sans font + content2 surfaces +
3px primary blockquote; gate/plan running-footer + queued-turn ghost-border affordances.

**Composer:** send-button + plan-mode + control polish. **Tasks:** status dot → keyboard
`<button>` + cycle, Delete action, `updated` sort key, priority-pill leading dot.

Deferred (need new global tokens or daemon endpoints, deliberately not shipped): the
review-panel commit rail (no git-commit endpoint — a fake-success control was reverted),
the SurfaceRail dynamic-floor change (conflicts with the documented chat-permanent-floor
decision — reverted), composer edit-mode amber glow, tasks priority/status semantic
colors, ordered-list mono markers, inline-code color, CM live-scheme hot-swap.
