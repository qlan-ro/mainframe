// Builds the mount page once, with the app's own plugins and CSS, into .work/app.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(HERE, '../../..');
export const WORK = process.env.PARITY_WORK ?? join(HERE, '.work');
// Another checkout's packages/ui, to measure the same states before a change.
const UI = process.env.PARITY_UI ?? join(ROOT, 'packages/ui');
const fromUi = createRequire(join(UI, 'package.json'));
const load = (name) => import(pathToFileURL(fromUi.resolve(name)).href);

export async function buildApp() {
  const { build } = await load('vite');
  const react = await load('@vitejs/plugin-react');
  const babel = (await load('@rolldown/plugin-babel')).default;
  const tailwindcss = (await load('@tailwindcss/vite')).default;
  await build({
    configFile: false,
    logLevel: 'warn',
    root: join(HERE, 'app'),
    base: './',
    plugins: [tailwindcss(), react.default(), babel({ presets: [react.reactCompilerPreset()] })],
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${join(UI, 'src')}/` },
        { find: /^(react|react-dom)(\/.*)?$/, replacement: join(UI, 'node_modules/$1$2') },
      ],
    },
    build: { outDir: join(WORK, 'app'), emptyOutDir: true, target: 'es2020', minify: false, chunkSizeWarningLimit: 20_000 },
  });
  return join(WORK, 'app');
}
