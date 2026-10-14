import { join } from 'node:path';

export async function measureTable(page) {
  await page.goto('http://localhost:5198/benchmarks/transcript-scroll/?table');
  await page.locator('#stream').waitFor();
  const geometry = () =>
    page.locator('tbody tr:first-child').evaluate((row) => ({
      columns: [...row.children].map((cell) => cell.getBoundingClientRect().width),
      height: row.getBoundingClientRect().height,
      tableWidth: row.closest('table').getBoundingClientRect().width,
    }));
  const before = await geometry();
  await page.locator('#stream').click();
  const after = await geometry();
  const layouts = [];
  for (const width of [640, 320]) {
    for (const theme of ['light', 'dark']) {
      await page.locator('#root > div').evaluate((el, width) => {
        el.style.width = `${width}px`;
      }, width);
      await page.locator('html').evaluate((el, theme) => {
        el.className = theme;
      }, theme);
      const bounds = await geometry();
      layouts.push({ width, theme, tableWidth: bounds.tableWidth });
      if (process.env.BENCHMARK_ARTIFACT_DIR)
        await page.screenshot({
          path: join(process.env.BENCHMARK_ARTIFACT_DIR, `table-${width}-${theme}.png`),
        });
    }
  }
  return {
    before,
    after,
    layouts,
    columnShiftPx: Math.max(...before.columns.map((width, i) => Math.abs(width - after.columns[i]))),
    existingRowHeightShiftPx: Math.abs(before.height - after.height),
  };
}
