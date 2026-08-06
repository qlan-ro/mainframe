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
 * Radix menu triggers open on POINTERDOWN, not click, so `fireEvent.click`
 * alone leaves the menu shut.
 */
async function openMenu(triggerTestId: string, menuTestId: string): Promise<void> {
  fireEvent.pointerDown(await screen.findByTestId(triggerTestId), { button: 0 });
  await screen.findByTestId(menuTestId);
}

/** Opens a skill row's scope DropdownMenu. */
export function openScopeMenu(key: string): Promise<void> {
  return openMenu(`skills-row-action-${key}`, `skills-row-scope-${key}`);
}

/** Opens the InstallBand's scope DropdownMenu — the same question a row asks. */
export function openInstallScopeMenu(): Promise<void> {
  return openMenu('skills-section-install', 'skills-section-install-scope');
}
