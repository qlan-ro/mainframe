/**
 * Tutorial tour store — persists first-run completion state.
 *
 * Fields: completed (gated by store), step (0-indexed, 0..3).
 * Actions: next / back / skip / complete / reset.
 * Button-driven navigation only — no action-gated auto-advance.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const TOTAL_STEPS = 4;

interface TutorialState {
  completed: boolean;
  step: number; // 0-indexed
  next: () => void;
  back: () => void;
  skip: () => void;
  complete: () => void;
  reset: () => void;
}

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      completed: false,
      step: 0,
      next: () => {
        const { step } = get();
        if (step >= TOTAL_STEPS - 1) {
          set({ completed: true });
        } else {
          set({ step: step + 1 });
        }
      },
      back: () => {
        const { step } = get();
        if (step > 0) set({ step: step - 1 });
      },
      skip: () => set({ completed: true }),
      complete: () => set({ completed: true }),
      reset: () => set({ completed: false, step: 0 }),
    }),
    { name: 'mf:tutorial' },
  ),
);
