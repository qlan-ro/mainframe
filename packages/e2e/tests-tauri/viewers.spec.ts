/**
 * §viewers — Files-surface non-code viewers (spec #19 of docs/plans/2026-07-03-tauri-e2e-test-plan.md).
 *
 * UI-only: no recording needed (no agent turn). One project + one chat created
 * in `beforeAll`; fixture files (one per viewer kind) are written directly to
 * the project's temp dir BEFORE the file tree first mounts, so the daemon's
 * initial GET /tree picks them up with no extra reload. Files are opened via
 * the file tree (`file-tree-row-${path}`) after revealing the Inspector
 * (`main-toolbar-inspector` — hidden by default), same as editor.spec.ts.
 *
 * Testid reference (verified against packages/ui/src/features/viewers/):
 *   main-toolbar-inspector       — reveals the Inspector (file tree)
 *   file-tree-row-${path}        — a tree row; opens the file on click
 *   files-tab-strip              — tab strip root (role=tab pills)
 *   viewer-shell                 — ViewerShell root (wraps every non-code viewer)
 *   viewer-shell-status          — footer left status string
 *   viewer-shell-reveal          — footer/header "Reveal in file tree" button
 *   viewer-image                 — ImageViewer root
 *   viewer-image-zoom-in / -out  — zoom buttons (disabled in Fit mode)
 *   viewer-image-fit-toggle / viewer-image-actual-toggle — Segmented Fit/100% (aria-pressed)
 *   viewer-svg                   — SvgViewer root
 *   viewer-svg-preview-toggle / viewer-svg-source-toggle — Segmented Preview/Code (aria-pressed)
 *   viewer-svg-source            — raw <pre> source (Code mode only)
 *   viewer-csv                   — CsvViewer root
 *   viewer-csv-filter            — filter input
 *   viewer-csv-header-${header}  — a sortable column header (click cycles asc→desc→off)
 *   viewer-csv-empty             — "no rows match" row (shown only when filter has no results)
 *   viewer-pdf                   — PdfViewer root
 *   viewer-pdf-fallback          — "Open externally" button (disabled only when fileUrl is null)
 *   markdown-preview             — rendered markdown body (MarkdownEditorTab default mode)
 *
 * GROUND-TRUTH FINDING (see report): `viewer-unsupported*` testids exist on
 * `UnsupportedViewer.tsx` but the component is UNREACHABLE via the normal
 * file-tree open flow today. `pickViewerKind` (viewer-router.tsx) only
 * classifies image/svg/csv/pdf extensions as non-code; every other extension
 * resolves to `'code'`, and BOTH tab-kind dispatch paths for `'code'`
 * (`store/intent-subscriber.ts` `kindForPath` → `EditorTabBody`'s default
 * branch → `EditorTab.tsx`) unconditionally pass a `renderCode` prop to
 * `ViewerRouter`, so a `'code'`-kind file always renders CmEditor, never the
 * bare `<ViewerRouter path=.../>` (no `renderCode`) that would fall through
 * to `<UnsupportedViewer>`. That bare invocation only exists on
 * `EditorTabBody`'s `kind === 'viewer'` branch, which by construction never
 * resolves to `pickViewerKind() === 'code'` for the same path. The component
 * is exercised only by its own isolated unit test today. The "Unsupported
 * binary" scenarios below are `test.skip`'d with this finding, per the
 * "don't fake state" rule — see the report for the concern write-up.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

// Minimal 1x1 red PNG — same known-good fixture as composer.spec.ts's attachment test.
// Raw bytes: 70 (verified) → formatBytes(70) === '0.1 KB'.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// 100x50 red rect SVG with explicit viewBox/width/height — raw bytes: 134 → '0.1 KB'.
const FIXTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">' +
  '<rect width="100" height="50" fill="red"/></svg>\n';

// Sortable numeric ("age") + text ("name") columns, 3 rows in a known non-sorted order.
const FIXTURE_CSV = 'name,age\nCharlie,25\nAlice,40\nBob,30\n';

// A minimal (non-compressed, single-page) valid PDF — raw bytes: 201 → '0.2 KB'.
// PdfViewer never parses the PDF; it only wraps the raw bytes into a blob: URL,
// so correctness only requires valid base64-decodable bytes with a .pdf extension.
const FIXTURE_PDF =
  '%PDF-1.1\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Resources<<>>>>endobj\n' +
  'trailer<</Root 1 0 R>>\n';

/** Locate a tab pill by its (unique-in-these-fixtures) visible title text. */
function tabByTitle(page: Page, title: string) {
  return page.locator('[data-testid="files-tab-strip"] [role="tab"]').filter({ hasText: title });
}

/** The ViewerShell footer container (parent of the status testid) — holds both the
 * left `viewer-shell-status` span and the untagged right-aligned `statusRight` span. */
function viewerFooter(page: Page) {
  return page.getByTestId('viewer-shell-status').locator('..');
}

test.describe('§viewers', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);

    // Fixture files — written before the file tree first mounts, so the
    // daemon's initial GET /tree picks them up with no extra reload/refresh.
    writeFileSync(path.join(project.projectPath, 'image.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));
    writeFileSync(path.join(project.projectPath, 'shape.svg'), FIXTURE_SVG);
    writeFileSync(path.join(project.projectPath, 'data.csv'), FIXTURE_CSV);
    writeFileSync(path.join(project.projectPath, 'doc.pdf'), FIXTURE_PDF);
    writeFileSync(path.join(project.projectPath, 'notes.md'), '# Notes\n\nHello world.\n');
    // Binary blob, unknown extension — see the ground-truth finding in the
    // header comment: the "Unsupported" viewer scenario is unreachable via
    // the normal open flow today, but the fixture is still written per the
    // dispatch's "one file of each kind" instruction.
    writeFileSync(path.join(project.projectPath, 'blob.mfbin'), Buffer.from([0, 1, 2, 255, 254, 253, 0x80, 0x81]));

    await createTauriChat(app.page, project.projectId, 'default');

    // Inspector (file tree) is hidden by default — reveal it once for the suite.
    await app.page.getByTestId('main-toolbar-inspector').click();
    await app.page.getByTestId('file-tree').waitFor({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // ── Image viewer ─────────────────────────────────────────────────────────

  test('image opens in Fit mode by default with zoom controls disabled', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-image.png').click();
    await expect(tabByTitle(page, 'image.png')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('viewer-image')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('viewer-image-fit-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewer-image-actual-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('viewer-image-zoom-in')).toBeDisabled();
    await expect(page.getByTestId('viewer-image-zoom-out')).toBeDisabled();

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('PNG · 1×1');
    await expect(viewerFooter(page)).toContainText('0.1 KB · fit to window');
  });

  test('switching to 100% enables zoom in/out and updates the displayed zoom level', async () => {
    const { page } = app;
    // image.png is still the active tab from the previous test.
    await expect(tabByTitle(page, 'image.png')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('viewer-image-actual-toggle').click();
    await expect(page.getByTestId('viewer-image-actual-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewer-image-fit-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('viewer-image-zoom-in')).toBeEnabled();
    await expect(page.getByTestId('viewer-image-zoom-out')).toBeEnabled();
    await expect(viewerFooter(page)).toContainText('0.1 KB · 100%');

    await page.getByTestId('viewer-image-zoom-in').click();
    await expect(viewerFooter(page)).toContainText('0.1 KB · 125%');

    await page.getByTestId('viewer-image-zoom-out').click();
    await page.getByTestId('viewer-image-zoom-out').click();
    await expect(viewerFooter(page)).toContainText('0.1 KB · 75%');
  });

  // ── SVG viewer ───────────────────────────────────────────────────────────

  test('svg opens in Preview mode by default; Code toggle shows the raw source', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-shape.svg').click();
    await expect(tabByTitle(page, 'shape.svg')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('viewer-svg')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('viewer-svg-preview-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewer-svg-source-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('viewer-svg-source')).toHaveCount(0);
    // Preview mode renders the SVG via an <img src="blob:...">.
    await expect(page.locator('[data-testid="viewer-svg"] img[alt="SVG preview"]')).toBeVisible();

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('SVG · viewBox 0 0 100 50');
    await expect(viewerFooter(page)).toContainText('100×50 · 0.1 KB');

    await page.getByTestId('viewer-svg-source-toggle').click();
    await expect(page.getByTestId('viewer-svg-source-toggle')).toHaveAttribute('aria-pressed', 'true');
    const source = page.getByTestId('viewer-svg-source');
    await expect(source).toBeVisible();
    await expect(source).toContainText('<rect width="100" height="50" fill="red"/>');

    await page.getByTestId('viewer-svg-preview-toggle').click();
    await expect(page.getByTestId('viewer-svg-source')).toHaveCount(0);
  });

  // ── CSV viewer ───────────────────────────────────────────────────────────

  test('csv renders a sortable table with the seeded headers and rows in file order', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-data.csv').click();
    await expect(tabByTitle(page, 'data.csv')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('viewer-csv')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('viewer-csv-header-name')).toBeVisible();
    await expect(page.getByTestId('viewer-csv-header-age')).toBeVisible();

    const rows = page.locator('[data-testid="viewer-csv"] tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Charlie');
    await expect(rows.nth(1)).toContainText('Alice');
    await expect(rows.nth(2)).toContainText('Bob');

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('CSV · UTF-8');
    await expect(viewerFooter(page)).toContainText('3 rows · 2 cols');
  });

  test('filter input narrows rows; an unmatched query shows the empty-filter row', async () => {
    const { page } = app;
    await expect(tabByTitle(page, 'data.csv')).toHaveAttribute('aria-selected', 'true');

    const filterInput = page.getByTestId('viewer-csv-filter');
    await filterInput.fill('Bob');

    const rows = page.locator('[data-testid="viewer-csv"] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Bob');
    await expect(viewerFooter(page)).toContainText('1/3 rows · 2 cols');

    await filterInput.fill('zzznomatch');
    await expect(page.getByTestId('viewer-csv-empty')).toBeVisible();
    await expect(page.getByTestId('viewer-csv-empty')).toContainText('No rows match "zzznomatch".');

    await filterInput.fill('');
    await expect(rows).toHaveCount(3);
  });

  test('clicking a column header cycles sort asc → desc → off', async () => {
    const { page } = app;
    await expect(tabByTitle(page, 'data.csv')).toHaveAttribute('aria-selected', 'true');
    // Filter must be clear from the previous test for these row-order assertions to hold.
    await expect(page.getByTestId('viewer-csv-filter')).toHaveValue('');

    const rows = page.locator('[data-testid="viewer-csv"] tbody tr');
    const ageHeader = page.getByTestId('viewer-csv-header-age');

    // asc: 25 (Charlie), 30 (Bob), 40 (Alice)
    await ageHeader.click();
    await expect(rows.nth(0)).toContainText('Charlie');
    await expect(rows.nth(1)).toContainText('Bob');
    await expect(rows.nth(2)).toContainText('Alice');
    await expect(ageHeader).toContainText('▲');

    // desc: 40 (Alice), 30 (Bob), 25 (Charlie)
    await ageHeader.click();
    await expect(rows.nth(0)).toContainText('Alice');
    await expect(rows.nth(1)).toContainText('Bob');
    await expect(rows.nth(2)).toContainText('Charlie');
    await expect(ageHeader).toContainText('▼');

    // off: back to file order — Charlie, Alice, Bob
    await ageHeader.click();
    await expect(rows.nth(0)).toContainText('Charlie');
    await expect(rows.nth(1)).toContainText('Alice');
    await expect(rows.nth(2)).toContainText('Bob');
    await expect(ageHeader).not.toContainText('▲');
    await expect(ageHeader).not.toContainText('▼');
  });

  // ── PDF viewer ───────────────────────────────────────────────────────────

  test('pdf embed mounts and the open-externally button reflects the local-daemon reality', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-doc.pdf').click();
    await expect(tabByTitle(page, 'doc.pdf')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('viewer-pdf')).toBeVisible({ timeout: 10_000 });

    // Browser-mode Chromium may or may not render the PDF plugin — assert the
    // <embed> element mounts, not that it paints pixels.
    await expect(page.locator('[data-testid="viewer-pdf"] embed[type="application/pdf"]')).toHaveCount(1, {
      timeout: 10_000,
    });

    // The e2e daemon target is local (useDaemonIsLocal() === true) and the
    // active project has a resolvable projectPath, so toFileUrl(path,
    // projectPath) is non-null — PdfViewer's fallback button is only disabled
    // on a null fileUrl (it does not gate on isLocal like UnsupportedViewer
    // does), so it is ENABLED here. Assert state only — never click (it shells
    // out via host.shell.openExternal, Tauri-native and not browser-testable).
    const fallback = page.getByTestId('viewer-pdf-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toBeEnabled();

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('PDF · 0.2 KB');
  });

  // ── Unsupported viewer — BLOCKED, see header comment ────────────────────

  test.skip('unsupported binary shows the no-preview card; open-externally + reveal-in-tree work', async () => {
    // TODO(app-tauri): UnsupportedViewer (viewer-unsupported / viewer-unsupported-card /
    // viewer-unsupported-open / viewer-unsupported-reveal) is unreachable via the file-tree
    // open flow today. `pickViewerKind` classifies any unrecognized extension (e.g. our
    // `blob.mfbin` fixture) as `'code'`, and every 'code'-kind tab renders through
    // `EditorTab.tsx`, which unconditionally supplies a `renderCode` prop to `ViewerRouter` —
    // so the router never falls through to `<UnsupportedViewer>`; it renders CmEditor with
    // whatever bytes `readFile(fullPath, 'utf-8')` decodes (replacement chars for invalid
    // sequences) instead. See viewer-router.tsx (pickViewerKind, ViewerRouter),
    // store/intent-subscriber.ts (kindForPath), and layout/surfaces/EditorTabBody.tsx (the
    // bare `<ViewerRouter path={tab.path} />` branch only fires for `kind === 'viewer'`, which
    // by construction never resolves to `pickViewerKind() === 'code'` for the same path).
    // Do not fake this state — unskip once a real entry point routes a file to
    // UnsupportedViewer (e.g. server-side binary detection feeding tab.kind).
  });

  // ── Markdown preview (default mode only — toggle is covered by editor.spec.ts) ──

  test('markdown file opens in Preview mode by default', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-notes.md').click();
    await expect(tabByTitle(page, 'notes.md')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('markdown-mode-preview')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('markdown-preview')).toBeVisible();
    await expect(page.getByTestId('markdown-preview')).toContainText('Hello world.');
    await expect(page.getByTestId('editor-code')).toHaveCount(0);
  });

  // ── ViewerShell chrome — reveal ──────────────────────────────────────────

  test('the viewer shell reveal button highlights the open file in the file tree', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-image.png').click();
    await expect(tabByTitle(page, 'image.png')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('viewer-shell')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('viewer-shell-reveal').click();
    // The reveal intent activates the Files surface but not the Inspector's own
    // Files/Changes tab — switch to it to observe the highlight (same pattern
    // as files-tree.spec.ts's "revealing a file from its viewer" test).
    await page.getByTestId('inspector-tab-files').click();

    const row = page.getByTestId('file-tree-row-image.png');
    await expect(row).toHaveAttribute('data-highlighted', 'true', { timeout: 10_000 });
  });
});
