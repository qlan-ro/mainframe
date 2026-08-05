/**
 * Shared setup for the Skills-section suites.
 *
 * The `vi.mock('@/lib/api/skills-cli', …)` factory still has to be repeated per
 * file — it is hoisted above the module body, so it cannot reach an import.
 * Everything after that point can be shared, and is: the section now reads the
 * manifest *and* the registry on mount, so every suite needs both resolved or
 * it is testing an accidental error state.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { SkillsCatalogEntry, SkillsCliEntry } from '@qlan-ro/mainframe-types';
import * as skillsCliApi from '@/lib/api/skills-cli';
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';

export function resetSkillsStores(): void {
  act(() => {
    useSkillsCliStore.getState().reset();
    useSkillsBrowseStore.getState().reset();
  });
  vi.clearAllMocks();
}

export function mockManifest(entries: SkillsCliEntry[] = []): void {
  vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries });
}

export function mockCatalog(entries: SkillsCatalogEntry[]): void {
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'available', entries });
}

export function mockCatalogUnavailable(): void {
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'unavailable' });
}

export function makeEntry(
  overrides: Partial<SkillsCliEntry> & { name: string; scope: 'project' | 'global' },
): SkillsCliEntry {
  return {
    source: 'shadcn/ui',
    sourceType: 'github',
    skillPath: `skills/${overrides.name}/SKILL.md`,
    ...overrides,
  };
}

/**
 * Opens a row's scope DropdownMenu. Radix menu triggers open on POINTERDOWN,
 * not click, so `fireEvent.click` alone leaves the menu shut.
 */
export async function openScopeMenu(key: string): Promise<void> {
  const trigger = await screen.findByTestId(`skills-row-action-${key}`);
  fireEvent.pointerDown(trigger, { button: 0 });
  await screen.findByTestId(`skills-row-scope-${key}`);
}
