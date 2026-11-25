/** A command and what it printed. The terminal follows the theme (T1b). */
import { cn } from '@/lib/utils';
import { ScrollRegion } from './Surface';

/**
 * Escape sequences: OSC (a window title, a hyperlink's address) up to its BEL or
 * ST, or to the line's end when it was cut; CSI (colours, cursor); the two- and
 * three-character ones.
 */
const ESCAPES = /\u001b\][^\u0007\u001b\n]*(?:\u0007|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]/g;

function lineClass(line: string): string | undefined {
  const exit = /^\s*exit (\d+)\s*$/.exec(line);
  if (exit) return exit[1] === '0' ? 'text-mf-tr-term-ok' : 'text-mf-tr-term-err';
  if (/[✓✔]/.test(line) || /\b(?:pass(?:ed|ing)?|ok)\b/i.test(line)) return 'text-mf-tr-term-ok';
  if (/[✗✘×]/.test(line) || /\b(?:error|fail(?:ed|ure|ing)?)\b/i.test(line)) return 'text-mf-tr-term-err';
  return undefined;
}

export function TerminalBody({ command, output }: { command: string; output: string }) {
  const lines = output.replace(ESCAPES, '').replace(/\n$/, '').split('\n');
  return (
    <ScrollRegion label="Command output" testId="chat-bash-region" className="bg-mf-tr-term">
      <pre data-testid="chat-bash-output" className="mf-tr-mono px-3 py-2 text-mf-tr-term-ink">
        {command && (
          <span className="block wrap-break-word whitespace-pre-wrap">
            <span className="text-muted-foreground select-none">$ </span>
            {command}
          </span>
        )}
        {output &&
          lines.map((line, index) => (
            <span key={index} className={cn('block min-h-[19px] wrap-break-word whitespace-pre-wrap', lineClass(line))}>
              {line}
            </span>
          ))}
      </pre>
    </ScrollRegion>
  );
}
