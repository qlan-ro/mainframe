/**
 * Tutorial tour store — persists first-run completion state.
 *
 * Fields: completed (gated by store), step (0-indexed).
 * Actions: next / back / skip / complete / reset.
 * Button-driven navigation only — no action-gated auto-advance.
 *
 * The store holds no step total: how many steps exist is decided at runtime by
 * the anchors on screen (features/tour/steps.ts), so the overlay owns the last
 * step and calls complete(). A constant here would silently end a longer tour
 * early, which is what a hardcoded 4 did when the tour grew past four steps.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      next: () => set({ step: get().step + 1 }),
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
