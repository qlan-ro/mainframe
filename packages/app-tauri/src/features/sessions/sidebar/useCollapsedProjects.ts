/**
 * Re-export so that sidebar/ consumers and tests share the same module identity.
 * Tests mock '../useCollapsedProjects' relative to __tests__/, which resolves to
 * this file. SessionGroup.tsx imports './useCollapsedProjects' (same file), so
 * the mock intercepts correctly.
 */
export { useCollapsedProjects } from '../useCollapsedProjects';
export type { CollapsedProjectsApi } from '../useCollapsedProjects';
