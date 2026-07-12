import { describe, it, expect, vi } from 'vitest';

// execFile is called as: execFile(bin, args, opts, callback)
// The helper then calls cp.stdin?.end() on the returned child object.
// The mock must call the trailing callback with (null, stdout) and return
// an object with a stdin.end stub so the optional-chain call does not throw.
const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

// Import AFTER the mock is registered so the module picks up the stub.
const { generateClaudeTitle } = await import('../plugins/builtin/claude/title-generator.js');

describe('generateClaudeTitle — CLI args contract', () => {
  it('passes --no-session-persistence to execFile so throwaway prompts are never persisted', async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, callback: (err: null, stdout: string) => void) => {
        callback(null, 'Fix Login Bug');
        return { stdin: { end: vi.fn() } };
      },
    );

    const result = await generateClaudeTitle('some message', 'claude');

    // Verify execFile was invoked exactly once.
    expect(execFileMock).toHaveBeenCalledTimes(1);

    // The second argument is the args array — assert the flag is present.
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain('--no-session-persistence');

    // Happy-path: the mocked stdout is returned as the title.
    expect(result).toBe('Fix Login Bug');
  });
});
