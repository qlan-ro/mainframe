import { execFileSync } from 'node:child_process';

const sources = new Set([
  'src/features/chat/thread/use-thread-bottom-pin.ts',
  'src/features/chat/messages/compact/use-compact-scroll-anchor.ts',
  'src/features/chat/parts/markdown-table.tsx',
]);

export function baselinePlugin(root, revision) {
  return {
    name: 'transcript-scroll-baseline',
    enforce: 'pre',
    load(id) {
      const relative = id.split('?')[0].slice(root.length);
      if (!revision || !sources.has(relative)) return null;
      return execFileSync('git', ['show', `${revision}:packages/ui/${relative}`], { cwd: root, encoding: 'utf8' });
    },
  };
}
