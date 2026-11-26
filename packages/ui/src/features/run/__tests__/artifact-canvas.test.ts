// @vitest-environment jsdom
/** The artifact canvas keeps only the shown page's boards loaded: each is a whole document. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, expect, it } from 'vitest';

const CANVAS = resolve(
  __dirname,
  '../../../../../core-rs/crates/mainframe-server/src/routes/artifact_preview/canvas.js',
);

const board = (page: string) => ({ page, x: 0, y: 0, w: 100, h: 100 });

function open(launch: object = {}) {
  const data = {
    pages: [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ],
    boards: { 'A.dc.html': board('one'), 'B.dc.html': board('one'), 'C.dc.html': board('two') },
    order: ['A.dc.html', 'B.dc.html', 'C.dc.html'],
    launch,
  };
  document.body.innerHTML = '<script type="application/json" id="mf-canvas-data"></script>';
  document.getElementById('mf-canvas-data')!.textContent = JSON.stringify(data);
  new Function(readFileSync(CANVAS, 'utf8'))();
}

const loaded = () =>
  [...document.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src')!.split('/').pop());

function showPage(id: string) {
  const select = document.querySelector<HTMLSelectElement>('#pages select')!;
  select.value = id;
  select.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  document.head.innerHTML = '';
});

it('loads the boards of the page it opens on, and no others', () => {
  open();
  expect(loaded()).toEqual(['A.dc.html', 'B.dc.html']);
});

it('opens on the launch board’s page', () => {
  open({ view: 'focused', file: 'C.dc.html' });
  expect(loaded()).toEqual(['C.dc.html']);
});

it('unloads the page it leaves and loads it again on return', () => {
  open();
  showPage('two');
  expect(loaded()).toEqual(['C.dc.html']);
  showPage('one');
  expect(loaded()).toEqual(['A.dc.html', 'B.dc.html']);
});

it('keeps a reloaded board under its shield, so a drag over it still pans', () => {
  open();
  showPage('two');
  showPage('one');
  for (const frame of document.querySelectorAll('iframe')) {
    expect(frame.nextElementSibling?.className).toBe('shield');
  }
});
