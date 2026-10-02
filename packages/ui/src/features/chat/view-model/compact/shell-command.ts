export function programName(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop() ?? '';
}

function tokenize(command: string): string[] | undefined {
  if (!command || command.length > 32768 || /[\n\r\u0000]/.test(command)) return undefined;
  const tokens: string[] = [];
  let token = '',
    quote = '',
    started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote === "'") {
      if (char === "'") quote = '';
      else token += char;
    } else if (char === '\\') {
      const next = command[++i];
      if (next === undefined) return undefined;
      token += quote === '"' && !['"', '\\', '$', '`'].includes(next) ? '\\' + next : next;
      started = true;
    } else if (char === '$' || char === '`') return undefined;
    else if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/[;&|<>(){}#]/.test(char)) return undefined;
    else if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
    if (tokens.length > 512) return undefined;
  }
  if (quote) return undefined;
  if (started) tokens.push(token);
  return tokens.length ? tokens : undefined;
}

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

function unwrapEnvironment(tokens: string[]): string[] | undefined {
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === '--') {
      index++;
      break;
    }
    if (['-i', '--ignore-environment'].includes(token) || assignment.test(token) || /^--unset=\w+$/.test(token))
      index++;
    else if (['-u', '--unset'].includes(token) && /^[A-Za-z_]\w*$/.test(tokens[index + 1] ?? '')) index += 2;
    else if (token.startsWith('-')) return undefined;
    else break;
  }
  return tokens.slice(index);
}

function unwrapSudo(tokens: string[]): string[] | undefined {
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === '--') {
      index++;
      break;
    }
    if (['-n', '-E', '--non-interactive', '--preserve-env'].includes(token) || /^--(?:user|group)=[\w-]+$/.test(token))
      index++;
    else if (['-u', '-g', '--user', '--group'].includes(token) && /^[\w-]+$/.test(tokens[index + 1] ?? '')) index += 2;
    else if (token.startsWith('-')) return undefined;
    else break;
  }
  return tokens.slice(index);
}

function unwrapShell(tokens: string[], depth: number): string[] | undefined {
  let index = 1;
  while (['--noprofile', '--norc', '-l'].includes(tokens[index] ?? '')) index++;
  if (!['-c', '-lc'].includes(tokens[index] ?? '') || tokens.length !== index + 2) return undefined;
  return parseShellCommand(tokens[index + 1], depth + 1);
}

export function parseShellCommand(value: unknown, depth = 0): string[] | undefined {
  if (typeof value !== 'string' || depth > 4) return undefined;
  let tokens = tokenize(value);
  for (let wrappers = depth; tokens?.length && wrappers <= 4; wrappers++) {
    while (tokens.length && assignment.test(tokens[0]!)) tokens.shift();
    const program = programName(tokens[0] ?? '');
    if (
      [
        'if',
        'then',
        'else',
        'elif',
        'fi',
        'for',
        'while',
        'until',
        'do',
        'done',
        'case',
        'esac',
        'select',
        'function',
        '!',
        'time',
      ].includes(program)
    )
      return undefined;
    if (['sh', 'bash', 'zsh'].includes(program)) return unwrapShell(tokens, wrappers);
    if (program === 'env') tokens = unwrapEnvironment(tokens);
    else if (program === 'sudo') tokens = unwrapSudo(tokens);
    else return program ? tokens : undefined;
  }
  return undefined;
}
