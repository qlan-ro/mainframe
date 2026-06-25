import { describe, it, expect } from 'vitest';
import { isAllowedExternalScheme, ALLOWED_EXTERNAL_SCHEMES } from '../external-schemes.js';

describe('isAllowedExternalScheme', () => {
  it('allows http/https case-insensitively', () => {
    expect(isAllowedExternalScheme('https://example.com')).toBe(true);
    expect(isAllowedExternalScheme('HTTP://localhost:3000')).toBe(true);
  });
  it('allows the IDE/app schemes', () => {
    for (const s of [
      'vscode',
      'cursor',
      'jetbrains',
      'zed',
      'slack',
      'linear',
      'notion',
      'figma',
      'discord',
      'tel',
      'mailto',
    ]) {
      expect(isAllowedExternalScheme(`${s}://open/x`)).toBe(true);
    }
  });
  it('rejects dangerous schemes', () => {
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ssh://host', 'data:text/html,x', 'ftp://x', '']) {
      expect(isAllowedExternalScheme(u)).toBe(false);
    }
  });
  it('exposes the canonical list without trailing colons', () => {
    expect(ALLOWED_EXTERNAL_SCHEMES).toContain('vscode-insiders');
    expect(ALLOWED_EXTERNAL_SCHEMES.every((s) => !s.endsWith(':'))).toBe(true);
  });
});
