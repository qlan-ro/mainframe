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
// Separate context, not a field on TriggerFieldAriaProps: that object is
// spread onto the textarea, and a non-ARIA key would become a bogus DOM attribute.
const TriggerFieldArmedContext = createContext<boolean>(false);

export function TriggerFieldAriaProvider({
  value,
  armed = false,
  children,
}: {
  value: TriggerFieldAriaProps;
  armed?: boolean;
  children: ReactNode;
}) {
  return (
    <TriggerFieldAriaContext.Provider value={value}>
      <TriggerFieldArmedContext.Provider value={armed}>{children}</TriggerFieldArmedContext.Provider>
    </TriggerFieldAriaContext.Provider>
  );
}

export function useTriggerFieldAria(): TriggerFieldAriaProps {
  return useContext(TriggerFieldAriaContext);
}

/** True whenever a trigger token is detected, even with an empty entry list. */
export function useTriggerFieldArmed(): boolean {
  return useContext(TriggerFieldArmedContext);
}
