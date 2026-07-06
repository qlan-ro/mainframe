/**
 * recent-directories — the N most-recently-picked project directories, for the
 * DirectoryPickerModal "Recent" section. Persisted to localStorage under
 * `mf:recent-directories` via zustand's persist middleware (mirrors
 * store/ui-prefs.ts). Only directory picks are recorded (file picks are noise
 * for the add-project flow).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const RECENT_DIRECTORIES_MAX = 5;

interface RecentDirectoriesState {
  paths: string[];
  /** Record a picked directory: dedupes and moves it to the front, capped at MAX. */
  addRecent: (path: string) => void;
}

export const useRecentDirectories = create<RecentDirectoriesState>()(
  persist(
    (set) => ({
      paths: [],
      addRecent: (path) =>
        set((state) => {
          const trimmed = path.trim();
          if (!trimmed) return state;
          const next = [trimmed, ...state.paths.filter((p) => p !== trimmed)].slice(0, RECENT_DIRECTORIES_MAX);
          return { paths: next };
        }),
    }),
    { name: 'mf:recent-directories' },
  ),
);
