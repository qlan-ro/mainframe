/**
 * A1 — the `run_command` "what will run" preview (contract §6). Script chips
 * are never spliced into shell source: each becomes `MF_<n>` in the child env
 * and the script text gets a quoted `"$MF_<n>"` where the chip sat. This is a
 * best-effort lexer (single-quote toggling + quoted-heredoc tracking, not a
 * full shell parser) whose only job is to flag the two documented cases where
 * that substitution silently won't expand: a chip inside single quotes, or
 * inside a quoted heredoc (`<<'EOF'`/`<<"EOF"` — the unquoted form `<<EOF`
 * DOES expand `$VAR` and is not flagged). `cwd`/`runIn` is deliberately out
 * of scope — this function only ever sees the `script` chip array.
 */
import type { ChipText, TokenRef } from '../automation.js';
import { isTokenPart } from './chip-parts.js';

export interface CommandPreviewWarning {
  /** Index into the `script` array of the chip this warning is about. */
  index: number;
  message: string;
}

export interface CommandPreviewResult {
  envMap: Record<string, TokenRef>;
  text: string;
  warnings: CommandPreviewWarning[];
}

const QUOTED_HEREDOC_OPEN = /<<-?\s*(['"])(\w+)\1/;

function countUnescapedSingleQuotes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "'" && line[i - 1] !== '\\') count++;
  }
  return count;
}

export function buildCommandPreview(script: ChipText): CommandPreviewResult {
  const envMap: Record<string, TokenRef> = {};
  const warnings: CommandPreviewWarning[] = [];
  let text = '';
  let inSingleQuote = false;
  let heredocDelim: string | null = null;
  let n = 0;

  const scanLiteral = (literal: string) => {
    for (const line of literal.split('\n')) {
      if (heredocDelim !== null) {
        if (line.trim() === heredocDelim) heredocDelim = null;
        continue;
      }
      if (countUnescapedSingleQuotes(line) % 2 === 1) inSingleQuote = !inSingleQuote;
      if (!inSingleQuote) {
        const match = QUOTED_HEREDOC_OPEN.exec(line);
        if (match) heredocDelim = match[2] ?? null;
      }
    }
  };

  script.forEach((part, index) => {
    if (isTokenPart(part)) {
      n += 1;
      const varName = `MF_${n}`;
      envMap[varName] = part.token;
      text += `"$${varName}"`;
      if (inSingleQuote) {
        warnings.push({
          index,
          message: `This value sits inside single quotes — "$${varName}" will NOT expand; it will run literally.`,
        });
      } else if (heredocDelim !== null) {
        warnings.push({
          index,
          message: `This value sits inside a quoted heredoc — "$${varName}" will NOT expand; it will run literally.`,
        });
      }
    } else {
      scanLiteral(part);
      text += part;
    }
  });

  return { envMap, text, warnings };
}
