/** A command and what it printed. The terminal follows the theme (T1b). */
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

function testRunnerLine(line: string) {
  const failure = /^(\s*FAIL )(.+)$/.exec(line);
  if (failure)
    return (
      <>
        <span className="font-semibold text-mf-tr-term-err">{failure[1]}</span>
        {failure[2]}
      </>
    );
  const summary = /^(\s*(?:Test Files|Tests) +)(\d+ failed)(.*)$/.exec(line);
  if (summary)
    return (
      <>
        {summary[1]}
        <span className="text-mf-tr-term-err">{summary[2]}</span>
        {summary[3]}
      </>
    );
  if (/^\s*(?:[A-Za-z]*Error):/.test(line)) return <span className="text-mf-tr-term-err">{line}</span>;
  if (/^\s*❯ /.test(line)) return <span className="text-[color:var(--mf-tr-term-muted)]">{line}</span>;
  return null;
}

function terminalLine(line: string) {
  const progress = /^( +(?:Compiling|Finished|Running)) (.+)$/.exec(line);
  if (progress) {
    return (
      <>
        <span className="font-semibold text-mf-tr-term-ok">{progress[1]}</span>
        {` ${progress[2]}`}
      </>
    );
  }
  const result = /^(test (?:result:|.* \.\.\.) )(ok|FAILED)(.*)$/.exec(line);
  if (result) {
    return (
      <>
        {result[1]}
        <span className={result[2] === 'ok' ? 'text-mf-tr-term-ok' : 'text-mf-tr-term-err'}>{result[2]}</span>
        {result[3]}
      </>
    );
  }
  return testRunnerLine(line) ?? <span className={lineClass(line)}>{line}</span>;
}

export function TerminalBody({ command, output }: { command?: string; output: string }) {
  const lines = output.replace(ESCAPES, '').replace(/\n$/, '').split('\n');
  return (
    <ScrollRegion
      label="Command output"
      testId="chat-bash-region"
      className="bg-mf-tr-term dark:shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <pre data-testid="chat-bash-output" className="mf-tr-mono px-3 py-2 text-mf-tr-term-ink">
        {command && (
          <span className="block wrap-break-word whitespace-pre-wrap">
            <span className="text-muted-foreground select-none">$ </span>
            {command}
          </span>
        )}
        {output &&
          lines.map((line, index) => (
            <span key={index} className="block min-h-[19px] whitespace-pre">
              {terminalLine(line)}
            </span>
          ))}
      </pre>
    </ScrollRegion>
  );
}
