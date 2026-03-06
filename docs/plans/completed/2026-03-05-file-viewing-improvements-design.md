# File Viewing Improvements Design

Three changes to how files are viewed and edited in the desktop app.

## Feature 1: Context Files Open in Monaco

**Current:** `ContextFileItem` renders as `<details>` + `<pre>` with inline content preview (max 200px scroll). Content lazy-loaded via `getSessionFile()`.

**Change:** Clicking a context file item calls `openEditorTab(filePath)` to open it in the Monaco editor in the right panel file view. Remove the inline expand/collapse behavior and content fetching. The component becomes a simple clickable row (icon + filename + badges).

### Affected files

- `ContextFileItem.tsx` — Remove `<details>`/`<pre>` rendering, add `openEditorTab()` onClick
- `ContextSection.tsx` — May simplify since children are no longer expandable

## Feature 2: Skills Editing in Monaco

**Current:** `SkillEditorTab` uses a plain `<textarea>` for editing skill content.

**Change:** Replace the `<textarea>` with `MonacoEditor` (language: `markdown`). Reuse the same component used by `EditorTab`, with `readOnly={false}` and `onChange` wired to the existing save logic (Cmd+S). Plugin-scoped skills remain read-only.

Content loading already goes through the daemon API — no change needed on the backend. The concern is that file content must always be fetched via the daemon (not direct filesystem access from the renderer), which is already the case.

### Affected files

- `SkillEditorTab.tsx` — Replace `<textarea>` with `MonacoEditor`

## Feature 3: Non-Text File Renderers

**Current:** Non-text files opened from the Files tab or context get sent to Monaco as `plaintext`. No image/SVG/PDF/CSV viewing.

**Change:** When opening a file, `FileViewContent` checks the extension. If it's a non-text format, it renders a specialized viewer component in the same file view panel instead of Monaco.

### Supported formats

| Format | Extensions | Renderer |
|--------|-----------|----------|
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico` | `<img>` centered, fit-to-container |
| SVG | `.svg` | `<img>` with data URL, or sandboxed `<iframe>` |
| PDF | `.pdf` | `<iframe>`/`<embed>` with PDF data |
| CSV | `.csv` | Parsed to `<table>` with styled rows/columns |

### Routing logic

In `FileViewContent`, before rendering `EditorTab`:

1. Check file extension from `fileView.filePath`
2. If non-text, render `ImageViewer`, `PdfViewer`, `SvgViewer`, or `CsvViewer`
3. Otherwise, render `EditorTab` (Monaco) as before

### Content delivery

All content fetched via the daemon files API. Binary files (images, PDF) need base64 encoding. Text-based files (CSV, SVG) use the existing text response. A new field or endpoint flag may be needed to signal binary content.

### Tab behavior

These use the existing `type: 'editor'` tab type. `FileViewHeader` shows filename and path as usual. The tab system is unchanged — only the renderer varies by extension.

### Affected files

- `FileViewContent.tsx` — Add extension check and route to specialized viewers
- New components: `ImageViewer.tsx`, `PdfViewer.tsx`, `SvgViewer.tsx`, `CsvViewer.tsx`
- Files API (core) — May need binary/base64 response support for images and PDFs
