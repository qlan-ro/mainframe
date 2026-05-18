# UI Selector Catalog
Resolved selectors for test-worktree. Each row is re-verified on use.

| NL target | Selector | Source | Confidence | Last verified |
|---|---|---|---|---|
| files panel › file entry | `[data-testid="right-top"]` >> `getByText("<filename>", { exact: true })` | dom-verify | 0.80 | 2026-05-17 |
| files panel › monaco editor | `.monaco-editor` (single code-editor instance; assertion target) | dom-verify | 0.80 | 2026-05-17 |
| chat › composer input | `[data-testid="center"] textarea` (only textarea in chat zone) | dom-verify | 0.80 | 2026-05-17 |
| sessions › new session (mainframe-web) | `button[aria-label="New session in mainframe-web"]` (reveal-on-hover; dispatch click via DOM) | dom-verify | 0.80 | 2026-05-17 |
| sessions › project group (mainframe-web) | `[data-testid^="project-group-"]` filtered by text `mainframe-web` | dom-verify | 0.80 | 2026-05-17 |
| sessions › chat list item | `[data-testid="chat-list-item"]` | catalog | 0.95 | 2026-05-17 |
| sessions › archive session action | chat-list-item >> `button[aria-label="Archive session"]` | dom-verify | 0.80 | 2026-05-17 |
| left rail › preview toggle | `button[title="Preview"]` (left icon rail) | dom-verify | 0.80 | 2026-05-17 |
| launch bar › start button | `[data-testid="launch-start-btn"]` | catalog | 0.95 | 2026-05-17 |
| launch bar › config selector | `[data-testid="launch-config-selector"]` | catalog | 0.95 | 2026-05-17 |
| chat › shiki code block | `[data-testid="center"] pre.shiki` (kept-language highlight path) | dom-verify | 0.80 | 2026-05-17 |
| chat › fallback code block | `[data-testid="center"] code.block` (dropped-language plain path) | dom-verify | 0.80 | 2026-05-17 |
