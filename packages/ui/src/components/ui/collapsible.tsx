import * as React from 'react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { useRetainedDisclosure } from './disclosure-state';
function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const identity = props as { 'data-slot'?: string; 'data-testid'?: string };
  const retained = useRetainedDisclosure(props, identity['data-testid'] ?? identity['data-slot'] ?? 'collapsible');
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} {...retained} />;
}
function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}
function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />;
}
export { Collapsible, CollapsibleTrigger, CollapsibleContent };
