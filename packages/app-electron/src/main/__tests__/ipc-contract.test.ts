import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { parseIpcArg } from '../ipc-validate.js';
import { FilePathSchema } from '@qlan-ro/mainframe-types';

describe('parseIpcArg', () => {
  it('returns the parsed value for valid input', () => {
    expect(parseIpcArg(FilePathSchema, '/Users/me/.mainframe/config.json', 'fs:readFile')).toBe(
      '/Users/me/.mainframe/config.json',
    );
  });

  it('throws a tagged error for invalid input', () => {
    expect(() => parseIpcArg(FilePathSchema, '', 'fs:readFile')).toThrow(/fs:readFile/);
  });
});
