/**
 * recent-directories — the "N most recently picked directories" store backing
 * the DirectoryPickerModal "Recent" section.
 *
 * Behaviors covered:
 *  - addRecent pushes to the front, newest first.
 *  - Re-adding an existing path moves it to front without duplicating.
 *  - The list is capped at RECENT_DIRECTORIES_MAX, dropping the oldest.
 *  - A blank (whitespace-only) path is a no-op.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useRecentDirectories, RECENT_DIRECTORIES_MAX } from '../recent-directories';

beforeEach(() => {
  useRecentDirectories.setState({ paths: [] });
});

describe('useRecentDirectories addRecent — ordering', () => {
  it('adds paths newest-first', () => {
    useRecentDirectories.getState().addRecent('/a');
    useRecentDirectories.getState().addRecent('/b');

    expect(useRecentDirectories.getState().paths).toEqual(['/b', '/a']);
  });

  it('moves a re-added path to the front without duplicating it', () => {
    useRecentDirectories.setState({ paths: ['/b', '/a'] });

    useRecentDirectories.getState().addRecent('/a');

    expect(useRecentDirectories.getState().paths).toEqual(['/a', '/b']);
  });
});

describe('useRecentDirectories addRecent — cap', () => {
  it('caps the list at RECENT_DIRECTORIES_MAX, dropping the oldest', () => {
    expect(RECENT_DIRECTORIES_MAX).toBe(5);

    for (const path of ['/1', '/2', '/3', '/4', '/5', '/6']) {
      useRecentDirectories.getState().addRecent(path);
    }

    expect(useRecentDirectories.getState().paths).toEqual(['/6', '/5', '/4', '/3', '/2']);
    expect(useRecentDirectories.getState().paths.length).toBe(5);
  });
});

describe('useRecentDirectories addRecent — blank input', () => {
  it('ignores a whitespace-only path', () => {
    useRecentDirectories.getState().addRecent('/a');

    useRecentDirectories.getState().addRecent('   ');

    expect(useRecentDirectories.getState().paths).toEqual(['/a']);
  });
});
