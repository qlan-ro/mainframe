/**
 * Which provider an Agent step's chips describe. Shared by the model chip and
 * the permission chip: a step whose `adapterId` is unset still runs somewhere,
 * and the two chips disagreeing about where would be a visible bug.
 */
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

export function resolveStepAdapter(adapters: AdapterInfo[], adapterId: string | undefined): AdapterInfo | undefined {
  return adapters.find((a) => a.id === adapterId) ?? adapters.find((a) => a.installed) ?? adapters[0];
}
