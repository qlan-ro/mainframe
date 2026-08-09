'use client';

/**
 * Carries the trigger field's combobox ARIA props from `ComposerTriggers`
 * (where `useTriggerField` lives) down to `Composer`'s `ComposerPrimitive.Input`
 * — `ComposerTriggers` wraps `children` as an opaque subtree, so `Input` can't
 * reach `field.ariaProps` as a prop.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { TriggerFieldAriaProps } from '@/components/trigger-engine/use-trigger-field';

const CLOSED_COMBOBOX: TriggerFieldAriaProps = {
  role: 'combobox',
  'aria-autocomplete': 'list',
  'aria-haspopup': 'listbox',
  'aria-expanded': false,
};

const TriggerFieldAriaContext = createContext<TriggerFieldAriaProps>(CLOSED_COMBOBOX);

export function TriggerFieldAriaProvider({ value, children }: { value: TriggerFieldAriaProps; children: ReactNode }) {
  return <TriggerFieldAriaContext.Provider value={value}>{children}</TriggerFieldAriaContext.Provider>;
}

export function useTriggerFieldAria(): TriggerFieldAriaProps {
  return useContext(TriggerFieldAriaContext);
}
