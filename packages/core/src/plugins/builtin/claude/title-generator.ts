import { execFile } from 'node:child_process';

function execFileNoStdin(
  bin: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const cp = execFile(bin, args, { ...opts, encoding: 'utf-8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout: stdout as string });
    });
    cp.stdin?.end();
  });
}

/** One-shot Haiku call over the Claude CLI that turns a first message into a short title. */
export async function generateClaudeTitle(content: string, binary: string): Promise<string | null> {
  const message = content.slice(0, 500);
  const prompt = `Generate a short title (2-5 words) for a coding chat that starts with this message.\nRules: Title case. No quotes. No punctuation. Be specific about the task.\nExamples: Auth Refactor, Fix Login Bug, Add Dark Mode Toggle, Optimize DB Queries\n\nMessage: ${message}\n\nTitle:`;

  const { stdout } = await execFileNoStdin(
    binary,
    [
      '-p',
      prompt,
      // Don't persist this throwaway prompt as a resumable session on disk —
      // otherwise it pollutes the CLI's session list (and our external-sessions
      // scan) as a "Generate a short title…" ghost. The CLI's own title gen
      // avoids this by calling the API directly; we shell out, so we opt out here.
      '--no-session-persistence',
      '--output-format',
      'text',
      '--model',
      'claude-haiku-4-5-20251001',
      '--max-turns',
      '1',
    ],
    { timeout: 30_000, maxBuffer: 8192, env: { ...process.env, NO_COLOR: '1' } },
  );

  const title = stdout
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (title && title.length >= 2 && title.length <= 80) return title;
  return null;
}
