import { diffArrays } from 'diff';

import { regions, textMasks } from '../window-config.mjs';

export async function transcriptBounds(page, side) {
  return page.locator(regions.transcript[side]).evaluate((root) => {
    const rect = root.getBoundingClientRect();
    const footer = root.querySelector('[data-testid=chat-thread-footer]')?.getBoundingClientRect();
    const tasks = root.querySelector('[data-testid=chat-turn-status]:has([data-testid=chat-thread-running-tasks])')?.getBoundingClientRect();
    const bottom = (footer?.top ?? rect.bottom) - (tasks?.height ?? 0);
    const strip = document.querySelector('#actstrip, [data-testid=composer-activity-strip]');
    return { x: rect.left, right: rect.right, top: rect.top, bottom, stripTop: strip?.getBoundingClientRect().top, taskHeight: tasks?.height ?? 0 };
  });
}

export async function scrollTranscriptToBottom(page, side) {
  await page.locator(regions.transcript[side]).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
}

async function lines(page, selector, clipRange) {
  const text = await page
    .locator(selector)
    .first()
    .evaluateAll((nodes, clipRange) => {
      const root = nodes[0];
      if (!root?.getClientRects().length || getComputedStyle(root).visibility !== 'visible') return '';
      const clip = root.getBoundingClientRect();
      const { top = clip.top, bottom = clip.bottom } = clipRange ?? {};
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const visible = [];
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const messageFooter = node.parentElement.closest('.mfoot, .mf-tr-footer');
        if (node.parentElement.closest('.sr-only, .sr')) continue;
        if (messageFooter && Number(getComputedStyle(messageFooter).opacity) === 0) continue;
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || getComputedStyle(node.parentElement).visibility !== 'visible')
          continue;
        if (rect.bottom <= top || rect.top >= bottom || rect.right <= clip.left || rect.left >= clip.right)
          continue;
        visible.push(node.textContent);
      }
      return visible.join('\n');
    }, clipRange);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export async function windowTextDiff(proto, app, bounds) {
  const differences = [];
  for (const [region, [p, a]] of Object.entries(regions)) {
    const depth = Math.min(...bounds.map(({ top, bottom }) => bottom - top));
    const texts = await Promise.all([proto, app].map((page, side) => {
      const { bottom } = bounds[side];
      return lines(page, [p, a][side], region === 'transcript' ? { top: bottom - depth, bottom } : null);
    }));
    const filtered = texts.map((lines, side) => lines.filter((line) =>
      !textMasks.some((mask) => mask.region === region && mask.side === side && mask.text === line))
      .join(' ').replace(/(\d) \+/g, '$1+').split(/\s+/).filter(Boolean));
    for (const change of diffArrays(...filtered)) {
      if (!change.added && !change.removed) continue;
      for (const line of change.value) differences.push({
        el: region, part: 'visible text', prop: change.added ? 'only in app' : 'missing in app',
        proto: change.removed ? line : 'absent', app: change.added ? line : 'absent',
      });
    }
  }
  return differences;
}
