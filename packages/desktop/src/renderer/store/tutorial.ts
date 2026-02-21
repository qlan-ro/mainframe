import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const TOTAL_STEPS = 4;

interface TutorialState {
  completed: boolean;
  step: number; // 1-indexed
  nextStep: () => void;
  complete: () => void;
  skip: () => void;
}

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      completed: false,
      step: 1,
      nextStep: () => {
        const { step } = get();
        if (step >= TOTAL_STEPS) {
          set({ completed: true });
        } else {
          set({ step: step + 1 });
        }
      },
      complete: () => set({ completed: true }),
      skip: () => set({ completed: true }),
    }),
    { name: 'mf:tutorial' },
  ),
);
