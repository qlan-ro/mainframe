import { vi, expect } from 'vitest';
import { agentRoutes } from '../../server/routes/agents.js';
import { skillRoutes } from '../../server/routes/skills.js';
import type { RouteContext } from '../../server/routes/types.js';

// Shared fixtures for agents-and-skills.test.ts, which merges the former
// routes/agents.test.ts + routes/skills.test.ts (structural clones of each
// other) into one parameterized suite. Split into its own file to keep the
// test file under the 300-line cap.

export const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

export function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

export function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

export function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

export interface ResourceConfig {
  label: string;
  routes: (ctx: RouteContext) => any;
  segment: string;
  sampleList: Array<{ id: string; name: string }>;
  listMethod: string;
  createMethod: string;
  updateMethod: string;
  deleteMethod: string;
  createBody: Record<string, unknown>;
  createExpectedArgs: [string, Record<string, unknown>];
  createdItem: Record<string, unknown>;
  createMissingBody: Record<string, unknown>;
  createThrowBody?: { success: false; error: string };
  updateBody: Record<string, unknown>;
  updateExpectedArgs: [string, string, string];
  updatedItem: Record<string, unknown>;
  updateMissingBody: Record<string, unknown>;
  encodedId: string;
  decodedId: string;
  notFoundBody?: { success: false; error: string };
  missingProjectPathBody?: { success: false; error: unknown };
}

export const RESOURCES: ResourceConfig[] = [
  {
    label: 'agent',
    routes: agentRoutes,
    segment: 'agents',
    sampleList: [{ id: 'a1', name: 'builder' }],
    listMethod: 'listAgents',
    createMethod: 'createAgent',
    updateMethod: 'updateAgent',
    deleteMethod: 'deleteAgent',
    createBody: { projectPath: '/p', name: 'reviewer', description: 'Reviews code', content: 'review' },
    createExpectedArgs: ['/p', { name: 'reviewer', description: 'Reviews code', content: 'review', scope: 'project' }],
    createdItem: { id: 'a2', name: 'reviewer' },
    createMissingBody: { projectPath: '/p' },
    updateBody: { projectPath: '/p', content: 'new' },
    updateExpectedArgs: ['a1', '/p', 'new'],
    updatedItem: { id: 'a1', content: 'new' },
    updateMissingBody: { projectPath: '/p' },
    encodedId: 'my%2Fagent',
    decodedId: 'my/agent',
  },
  {
    label: 'skill',
    routes: skillRoutes,
    segment: 'skills',
    sampleList: [{ id: 's1', name: 'commit' }],
    listMethod: 'listSkills',
    createMethod: 'createSkill',
    updateMethod: 'updateSkill',
    deleteMethod: 'deleteSkill',
    createBody: { projectPath: '/p', name: 'review', content: 'do review' },
    createExpectedArgs: [
      '/p',
      { name: 'review', displayName: 'review', description: '', content: 'do review', scope: 'project' },
    ],
    createdItem: { id: 's2', name: 'review' },
    createMissingBody: { projectPath: '/p' },
    createThrowBody: { success: false, error: 'Operation failed' },
    updateBody: { projectPath: '/p', content: 'updated' },
    updateExpectedArgs: ['s1', '/p', 'updated'],
    updatedItem: { id: 's1', name: 'commit', content: 'updated' },
    updateMissingBody: { projectPath: '/p' },
    encodedId: 'my%2Fskill',
    decodedId: 'my/skill',
    notFoundBody: { success: false, error: 'Adapter not found or does not support skills' },
    missingProjectPathBody: { success: false, error: expect.any(String) },
  },
];
