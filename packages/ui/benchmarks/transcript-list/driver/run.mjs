// Runs the rig: builds the production bundle, serves it, and plays every case on every variant and engine.
//   node packages/ui/benchmarks/transcript-list/driver/run.mjs [--engines chromium,webkit,wk]
//     [--variants v0,v1,v1s,v2,v1+cv] [--cases P1,P3-fold] [--repeat 2] [--synthetic] [--no-build] [--out file.json]
//   --serve builds, serves the page and waits (P7 by hand: open http://127.0.0.1:5199/?v=v1&manual=1 in Safari).
// A variant written `v1+cv` adds `&cv=1` (content-visibility on rows).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { openEngine } from './engines.mjs';
import { CASES } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.resolve(here, '../../..');
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const work = arg('work', path.join(os.tmpdir(), 'mainframe-transcript-list-rig'));
const dist = path.join(work, 'dist');
const wkBinary = path.join(work, 'wkrig');
const engines = arg('engines', 'chromium,webkit,wk').split(',');
const variants = arg('variants', 'v0,v1,v1s,v2').split(',');
const filters = arg('cases', '').split(',').filter(Boolean);
const repeat = Number(arg('repeat', 1));
const out = arg('out', path.join(work, `results-${Date.now()}.json`));
const synthetic = flag('synthetic');
const PORT = Number(arg('port', 5199));

fs.mkdirSync(work, { recursive: true });
if (!flag('no-build')) {
  execFileSync('npx', ['vite', 'build', '--config', 'benchmarks/transcript-list/vite.config.ts'], {
    cwd: ui,
    stdio: 'inherit',
    env: { ...process.env, RIG_OUT: dist },
  });
  if (engines.includes('wk'))
    execFileSync('swiftc', ['-O', path.join(here, 'wkrig.swift'), '-o', wkBinary], { stdio: 'inherit' });
}
const server = await startServer(dist, PORT);
const log = (line) => process.stdout.write(`${line}\n`);
if (flag('serve')) {
  log(`serving http://127.0.0.1:${PORT}/?v=v1&manual=1 (Ctrl-C to stop)`);
  await new Promise(() => {});
}
const cases = CASES.filter((c) => !filters.length || filters.some((f) => c.id.startsWith(f)));
const results = [];
for (const engineName of engines) {
  let engine = await openEngine(engineName, { synthetic, wkBinary });
  log(JSON.stringify(engine.info));
  for (const variant of variants)
    for (const c of cases) {
      if (c.engines && !c.engines.includes(engineName)) continue;
      for (let r = 0; r < (c.run ? repeat : (c.repeat ?? 1)); r++) {
        const [name, ...extras] = variant.split('+');
        const url = `http://127.0.0.1:${PORT}/?v=${name}${extras.map((x) => `&${x}=1`).join('')}${c.query}`;
        let record;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await engine.open(url);
            const boot = await engine.call('return await window.__rig.boot');
            const run = c.run
              ? await engine.call(
                  `return await window.__rig.run(${JSON.stringify(c.run)}, ${JSON.stringify(c.options)})`,
                )
              : null;
            record = { ...(run ?? { ok: true }), engine: engineName, variant, case: c.id, rep: r, boot };
            break;
          } catch (error) {
            // The harness can report a bare "JavaScript exception" while a load is still settling; retry once.
            record = { engine: engineName, variant, case: c.id, rep: r, ok: false, error: String(error), attempt };
            // A web process that died or hung takes the harness with it: start a fresh one.
            if (/unreachable|timed out|crash/i.test(String(error))) {
              await engine.close().catch(() => {});
              engine = await openEngine(engineName, { synthetic, wkBinary });
            }
          }
        }
        await engine.closePage();
        results.push(record);
        log(JSON.stringify(record));
        fs.writeFileSync(out, JSON.stringify({ engines: engineName, synthetic, results }, null, 1));
      }
    }
  await engine.close();
}
server.close();
log(`results: ${out}`);
