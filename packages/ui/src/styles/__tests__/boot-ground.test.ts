import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/** The first value `--sidebar` takes in a block of globals.css opened by `selector`. */
function sidebarIn(css: string, selector: string): string {
  const block = css.slice(css.indexOf(`${selector} {`));
  return /--sidebar:\s*(#[0-9a-f]{6})/i.exec(block)![1]!.toLowerCase();
}

describe('the first frame, before any CSS or script of the app has run', () => {
  const css = read('src/styles/globals.css');
  const html = read('index.html');
  const light = sidebarIn(css, ':root');
  const dark = sidebarIn(css, '.dark');

  it('paints the shell ground (the sidebar token) in light', () => {
    expect(html).toMatch(new RegExp(`html,\\s*body\\s*{\\s*background:\\s*${light}`, 'i'));
  });

  it('paints the shell ground in dark, once the stored theme is on <html>', () => {
    expect(html).toMatch(new RegExp(`html\\.dark,\\s*html\\.dark body\\s*{\\s*background:\\s*${dark}`, 'i'));
  });

  it('is the window colour the shell is created with', () => {
    const conf = JSON.parse(read('../app-tauri/src-tauri/tauri.conf.json')) as {
      app: { windows: { backgroundColor: string }[] };
    };
    expect(conf.app.windows[0]!.backgroundColor.toLowerCase()).toBe(light);
  });

  it('applies the stored theme with a script the CSP allows (external, same origin)', () => {
    expect(html).toMatch(/<script src="\.\/boot-theme\.js"><\/script>/);
    expect(read('public/boot-theme.js')).toContain("localStorage.getItem('mf-theme')");
  });
});
