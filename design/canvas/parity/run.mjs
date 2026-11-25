// node design/canvas/parity/run.mjs [--area shell] [--only regex] [--themes light,dark] [--views wide,mid,small] [--out dir] [--skip-build]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApp, HERE, WORK } from './lib/build.mjs';
import { launch } from './lib/browser.mjs';
import { runArea } from './lib/run.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const out = arg('out') ?? join(WORK, 'out');
mkdirSync(out, { recursive: true });
const dir = process.argv.includes('--skip-build') ? join(WORK, 'app') : await buildApp();
const names = readdirSync(join(HERE, 'areas'))
  .filter((f) => f.endsWith('.mjs') && f !== 'common.mjs' && f !== 'classes.mjs')
  .map((f) => f.slice(0, -4))
  .filter((n) => !arg('area') || arg('area').split(',').includes(n));
const browser = await launch();
let failed = false;
try {
  for (const name of names) {
    const area = (await import(pathToFileURL(join(HERE, 'areas', `${name}.mjs`)).href)).default;
    const { rows, problems, counts } = await runArea({
      browser,
      dir,
      area,
      outDir: out,
      only: arg('only') && new RegExp(arg('only')),
      themes: arg('themes')?.split(','),
      views: arg('views')?.split(','),
    });
    writeFileSync(join(out, `${name}.json`), JSON.stringify(rows, null, 1));
    writeFileSync(join(out, `${name}.counts.json`), JSON.stringify(counts));
    console.log(`${name}: ${rows.length} differing rows, ${problems.length} problems`);
    for (const p of problems) console.log(`  ! ${p}`);
    if (problems.length) failed = true;
  }
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
