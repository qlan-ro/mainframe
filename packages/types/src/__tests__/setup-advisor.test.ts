import { describe, it, expect } from 'vitest';
import {
  AutomationRecommendationSchema,
  ProjectFingerprintSchema,
  SetupAdvisorReportSchema,
  type AutomationRecommendation,
  type ProjectFingerprint,
} from '../setup-advisor.js';

const validRecommendation: AutomationRecommendation = {
  id: 'mcp-postgres',
  category: 'mcp',
  title: 'Add a Postgres MCP server',
  signal: 'Detected a Postgres connection string in .env',
  why: 'Postgres MCP servers let the agent query schema and data directly.',
  command: 'claude mcp add postgres',
  adapters: ['claude'],
};

const validFingerprint: ProjectFingerprint = {
  languages: ['typescript'],
  frameworks: ['react'],
  databases: ['postgres'],
  externalApis: [],
  testing: ['vitest'],
  tooling: ['pnpm'],
  gitHost: 'github',
  hasClaudeConfig: true,
  hasEnvFiles: true,
  hasLockFiles: true,
  dirs: ['src'],
  fileCount: 42,
  signals: ['found package.json'],
};

describe('AutomationRecommendationSchema', () => {
  it('accepts a well-formed recommendation and round-trips it unchanged', () => {
    expect(AutomationRecommendationSchema.parse(validRecommendation)).toEqual({
      id: 'mcp-postgres',
      category: 'mcp',
      title: 'Add a Postgres MCP server',
      signal: 'Detected a Postgres connection string in .env',
      why: 'Postgres MCP servers let the agent query schema and data directly.',
      command: 'claude mcp add postgres',
      adapters: ['claude'],
    });
  });

  it('rejects an unknown category', () => {
    expect(
      AutomationRecommendationSchema.safeParse({ ...validRecommendation, category: 'themes' })
        .success
    ).toBe(false);
  });

  it('rejects a missing command', () => {
    const { command: _drop, ...rest } = validRecommendation;
    expect(AutomationRecommendationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a missing adapters', () => {
    const { adapters: _drop, ...rest } = validRecommendation;
    expect(AutomationRecommendationSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts an absent targetPath', () => {
    expect(AutomationRecommendationSchema.safeParse(validRecommendation).success).toBe(true);
  });
});

describe('ProjectFingerprintSchema', () => {
  it('accepts gitHost: null', () => {
    expect(ProjectFingerprintSchema.safeParse({ ...validFingerprint, gitHost: null }).success).toBe(
      true
    );
  });

  it('accepts gitHost: github', () => {
    expect(
      ProjectFingerprintSchema.safeParse({ ...validFingerprint, gitHost: 'github' }).success
    ).toBe(true);
  });

  it('accepts gitHost: gitlab', () => {
    expect(
      ProjectFingerprintSchema.safeParse({ ...validFingerprint, gitHost: 'gitlab' }).success
    ).toBe(true);
  });

  it('accepts gitHost: other', () => {
    expect(
      ProjectFingerprintSchema.safeParse({ ...validFingerprint, gitHost: 'other' }).success
    ).toBe(true);
  });

  it('rejects gitHost: bitbucket', () => {
    expect(
      ProjectFingerprintSchema.safeParse({ ...validFingerprint, gitHost: 'bitbucket' }).success
    ).toBe(false);
  });
});

describe('SetupAdvisorReportSchema', () => {
  it('accepts a fingerprint with an empty recommendations array', () => {
    expect(
      SetupAdvisorReportSchema.safeParse({ fingerprint: validFingerprint, recommendations: [] })
        .success
    ).toBe(true);
  });

  it('rejects a report missing fingerprint', () => {
    expect(SetupAdvisorReportSchema.safeParse({ recommendations: [] }).success).toBe(false);
  });
});
