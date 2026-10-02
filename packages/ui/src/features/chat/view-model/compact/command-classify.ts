import type { Action, ActionKind } from './action-label';
import { summarizeFiles } from './file-summary';
import { programName } from './shell-command';

function operands(args: readonly string[], flags: readonly string[], valued: readonly string[] = [], short?: RegExp) {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      result.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-')) result.push(arg);
    else if (flags.includes(arg) || short?.test(arg)) continue;
    else if (valued.includes(arg) && args[i + 1] && !args[i + 1]!.startsWith('-')) i++;
    else return undefined;
  }
  return result;
}

function readCommand(program: string, args: string[]): Action | undefined {
  let paths: string[] | undefined;
  if (program === 'cat') paths = operands(args, [], [], /^-[nbsETv]+$/);
  if (program === 'head' || program === 'tail') {
    if (args.some((arg, index) => ['-n', '--lines'].includes(arg) && !/^\d+$/.test(args[index + 1] ?? '')))
      return undefined;
    paths = operands(args, ['-q', '-v'], ['-n', '--lines']);
  }
  if (program === 'sed' && args[0] === '-n' && /^\d+(,\d+)?p$/.test(args[1] ?? '')) paths = operands(args.slice(2), []);
  if (!paths?.length || paths.some((path) => /[*?\[\]]/.test(path))) return undefined;
  const target = summarizeFiles(paths, 'read');
  return target ? { kind: 'read', target } : undefined;
}

function searchCommand(program: string, args: string[]): Action | undefined {
  const paths = operands(
    args,
    ['--hidden', '--files', '--no-ignore', '--line-number', '--ignore-case', '--fixed-strings'],
    ['-g', '--glob', '-t', '--type', '--type-not', '--max-count'],
    /^-[nriIlvFw]+$/,
  );
  if (!paths) return undefined;
  if (program === 'rg' && args.includes('--files')) return { kind: 'list', target: paths.join(', ') || 'files' };
  const [query, ...directories] = paths;
  if (!query) return undefined;
  return { kind: 'grep', target: `for "${query}"${directories.length ? ` in ${directories.join(', ')}` : ''}` };
}

const scripts: Record<string, ActionKind> = {
  lint: 'lint',
  typecheck: 'typecheck',
  'type-check': 'typecheck',
  test: 'test',
  format: 'format',
  build: 'build',
  install: 'install',
  ci: 'install',
};
function packageCommand(tokens: string[]): Action | undefined {
  let index = 1;
  while (['--filter', '-F', '--prefix', '--cwd', '-C', '--workspace', '-w'].includes(tokens[index] ?? '')) {
    if (!tokens[index + 1] || tokens[index + 1]!.startsWith('-')) return undefined;
    index += 2;
  }
  if (tokens[index] === 'exec') return classifyCommand(tokens.slice(index + 1));
  if (tokens[index] === 'run') index++;
  const script = tokens[index] ?? '';
  const kind = Object.prototype.hasOwnProperty.call(scripts, script) ? scripts[script] : undefined;
  if (!kind) return undefined;
  const flags: Partial<Record<ActionKind, string[]>> = {
    install: ['--frozen-lockfile', '--immutable', '--silent'],
    test: ['--run'],
    lint: ['--fix'],
    format: ['--check', '--write'],
  };
  const rest = operands(tokens.slice(index + 1), flags[kind] ?? []);
  return rest?.length === 0 ? { kind } : undefined;
}

const gitKinds: Record<string, ActionKind> = {
  status: 'git-status',
  diff: 'git-diff',
  log: 'git-log',
  show: 'git-show',
  add: 'git-add',
  commit: 'git-commit',
  push: 'git-push',
  pull: 'git-pull',
  fetch: 'git-fetch',
  switch: 'git-switch',
  checkout: 'git-switch',
};
const gitFlags: Record<string, string[]> = {
  status: ['--short', '-s', '--branch', '-b', '--porcelain'],
  diff: ['--stat', '--cached', '--staged', '--name-only', '--check'],
  log: ['--oneline', '--all', '--graph', '--decorate'],
  show: ['--stat', '--name-only'],
  add: ['-A', '--all', '-u'],
  commit: ['-a', '--amend', '--no-edit'],
  push: ['-u', '--set-upstream', '--force-with-lease'],
  pull: ['--rebase', '--ff-only'],
  fetch: ['--all', '--prune'],
  switch: [],
  checkout: [],
};
function gitCommand(args: string[]): Action | undefined {
  const [verb = '', ...rest] = args;
  const kind = Object.prototype.hasOwnProperty.call(gitKinds, verb) ? gitKinds[verb] : undefined;
  if (!kind) return undefined;
  const valued = verb === 'commit' ? ['-m', '--message'] : verb === 'log' ? ['-n', '--max-count'] : [];
  return operands(rest, gitFlags[verb]!, valued) ? { kind } : undefined;
}

function directCommand(program: string, args: string[]): Action | undefined {
  const kinds: Record<string, ActionKind> = {
    eslint: 'lint',
    tsc: 'typecheck',
    vitest: 'test',
    jest: 'test',
    prettier: 'format',
  };
  const kind = Object.prototype.hasOwnProperty.call(kinds, program) ? kinds[program] : undefined;
  if (!kind) return undefined;
  const flags: Record<string, string[]> = {
    eslint: ['--fix'],
    tsc: ['--noEmit'],
    vitest: ['--run'],
    jest: ['--runInBand'],
    prettier: ['--check', '--write'],
  };
  const rest = operands(args, flags[program]!, program === 'tsc' ? ['--project', '-p'] : ['--config']);
  if (!rest || (program === 'vitest' && rest.length > 0 && rest[0] !== 'run')) return undefined;
  return { kind };
}

export function classifyCommand(tokens: string[]): Action | undefined {
  const program = programName(tokens[0] ?? '');
  const args = tokens.slice(1);
  if (['cat', 'head', 'tail', 'sed'].includes(program)) return readCommand(program, args);
  if (['rg', 'grep'].includes(program)) return searchCommand(program, args);
  if (program === 'ls') {
    const paths = operands(args, ['--all', '--almost-all'], [], /^-[laAh]+$/);
    return paths ? { kind: 'list', target: paths.join(', ') || 'directory' } : undefined;
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) return packageCommand(tokens);
  if (program === 'npx') return tokens.length > 1 ? directCommand(programName(tokens[1]!), tokens.slice(2)) : undefined;
  if (program === 'git') return gitCommand(args);
  return directCommand(program, args);
}
