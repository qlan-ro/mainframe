import { diffArrays } from 'diff';

const regions = {
  transcript: ['#thread', '[data-testid=chat-thread-viewport]'],
  sidebar: ['#side', '[data-slot=sidebar]'],
  strip: ['#actstrip', '[data-testid=composer-activity-strip]'],
  panel: ['#spanel', '[data-testid=session-panel-root]'],
};
const appOnly = /^\d+ running tasks?$/;

export async function scrollTranscriptToBottom(page, side) {
  await page.locator(regions.transcript[side]).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
}

async function lines(page, selector) {
  const text = await page
    .locator(selector)
    .first()
    .evaluateAll((nodes) => {
      const root = nodes[0];
      if (!root?.getClientRects().length || getComputedStyle(root).visibility !== 'visible') return '';
      const footer = root.querySelector('[data-testid=chat-thread-footer]');
      const clip = root.getBoundingClientRect();
      const bottom = footer ? Math.min(clip.bottom, footer.getBoundingClientRect().top) : clip.bottom;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const visible = [];
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('.sr-only, .sr')) continue;
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || getComputedStyle(node.parentElement).visibility !== 'visible')
          continue;
        if (rect.bottom <= clip.top || rect.top >= bottom || rect.right <= clip.left || rect.left >= clip.right)
          continue;
        visible.push(node.textContent);
      }
      return visible.join('\n');
    });
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export async function windowTextDiff(proto, app) {
  const differences = [];
  for (const [region, [p, a]] of Object.entries(regions)) {
    const [expected, actual] = await Promise.all([lines(proto, p), lines(app, a)]);
    const changes = diffArrays(
      expected,
      actual.filter((line) => !appOnly.test(line)),
    );
    for (const change of changes) {
      if (!change.added && !change.removed) continue;
      for (const line of change.value) differences.push(`${region} ${change.added ? '+' : '-'} ${line}`);
    }
  }
  return differences;
}
