import { describe, it, expect } from 'vitest';
import { fileUriToPath, pathToFileUri } from '../file-uri';

describe('pathToFileUri', () => {
  it('percent-encodes spaces, # and ? per segment', () => {
    expect(pathToFileUri('/Users/me/My Project/C# notes/a?.ts')).toBe(
      'file:///Users/me/My%20Project/C%23%20notes/a%3F.ts',
    );
  });
});

describe('fileUriToPath', () => {
  it('decodes an encoded URI back to the original path', () => {
    expect(fileUriToPath('file:///Users/me/My%20Project/C%23%20notes/a%3F.ts')).toBe(
      '/Users/me/My Project/C# notes/a?.ts',
    );
  });

  it('keeps a literal # in the path instead of treating it as a fragment', () => {
    expect(fileUriToPath('file:///x/C#/a.cs')).toBe('/x/C#/a.cs');
  });

  it('keeps a malformed percent-escape as written instead of throwing', () => {
    expect(fileUriToPath('file:///x/100%/a.ts')).toBe('/x/100%/a.ts');
  });

  it('strips a localhost authority', () => {
    expect(fileUriToPath('file://localhost/x/a.ts')).toBe('/x/a.ts');
  });

  it('passes a non-URI path through unchanged', () => {
    expect(fileUriToPath('/x/my file.ts')).toBe('/x/my file.ts');
  });
});
