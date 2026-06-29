---
"@qlan-ro/mainframe-ui": patch
---

Stop showing tooltips that merely repeat fully-visible text. `TruncatedWithTooltip`
now reveals its tooltip only when the label is actually clipped (new
`useIsTruncated` hook comparing `scrollWidth`/`clientWidth`); a custom `tooltip`
prop still always shows, since it adds info beyond the visible text. Redundant
echo tooltips were removed across the session sidebar (title, project chip) and
elsewhere (About pane values, Task card agent/model, Search pattern, worktree
path). Informative tooltips — icon buttons, basename-with-full-path, relative
time with full date — are unchanged.
