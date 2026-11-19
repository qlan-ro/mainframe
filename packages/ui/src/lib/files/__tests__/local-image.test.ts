import { describe, expect, it } from 'vitest';
import { imageMimeForPath, localImagePath } from '../local-image';

describe('localImagePath', () => {
  it('accepts absolute POSIX, Windows and file:// sources', () => {
    expect(localImagePath('/tmp/a.png')).toBe('/tmp/a.png');
    expect(localImagePath('C:/x/a.png')).toBe('C:/x/a.png');
    expect(localImagePath('C:\\x\\a.png')).toBe('C:\\x\\a.png');
    expect(localImagePath('file:///tmp/my%20pic.png')).toBe('/tmp/my pic.png');
  });

  it('rejects relative, home, web and data sources', () => {
    expect(localImagePath('a/b.png')).toBeNull();
    expect(localImagePath('~/a.png')).toBeNull();
    expect(localImagePath('https://x.com/a.png')).toBeNull();
    expect(localImagePath('data:image/png;base64,AAA')).toBeNull();
    expect(localImagePath('')).toBeNull();
  });
});

describe('imageMimeForPath', () => {
  it('maps known extensions case-insensitively', () => {
    expect(imageMimeForPath('/a/b.PNG')).toBe('image/png');
    expect(imageMimeForPath('/a/b.jpeg')).toBe('image/jpeg');
    expect(imageMimeForPath('/a/b.webp')).toBe('image/webp');
  });
  it('returns null otherwise', () => {
    expect(imageMimeForPath('/a/b.svg')).toBeNull();
    expect(imageMimeForPath('/a/b')).toBeNull();
  });
});
