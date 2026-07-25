import { describe, it, expect } from 'vitest';
import {
  AutomationRecommendationSchema,
  ProjectFingerprintSchema,
  RecommendationProvenanceSchema,
  RecommendationSourceSchema,
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
  provenance: 'first-party',
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
      provenance: 'first-party',
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

  it('rejects a missing provenance', () => {
    const { provenance: _drop, ...rest } = validRecommendation;
    expect(AutomationRecommendationSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts a first-party recommendation with no source', () => {
    expect(
      AutomationRecommendationSchema.safeParse({
        ...validRecommendation,
        provenance: 'first-party',
      }).success
    ).toBe(true);
  });

  it('accepts a third-party recommendation with source and round-trips repo and installs', () => {
    const parsed = AutomationRecommendationSchema.parse({
      ...validRecommendation,
      provenance: 'third-party',
      source: { repo: 'wshobson/agents', installs: 12345 },
    });
    expect(parsed.provenance).toBe('third-party');
    expect(parsed.source).toEqual({ repo: 'wshobson/agents', installs: 12345 });
  });

  it('rejects source: null', () => {
    expect(
      AutomationRecommendationSchema.safeParse({
        ...validRecommendation,
        provenance: 'third-party',
        source: null,
      }).success
    ).toBe(false);
  });
});

describe('RecommendationProvenanceSchema', () => {
  it('accepts first-party', () => {
    expect(RecommendationProvenanceSchema.safeParse('first-party').success).toBe(true);
  });

  it('accepts vendor-official', () => {
    expect(RecommendationProvenanceSchema.safeParse('vendor-official').success).toBe(true);
  });

  it('accepts third-party', () => {
    expect(RecommendationProvenanceSchema.safeParse('third-party').success).toBe(true);
  });

  it('rejects an unknown provenance', () => {
    expect(RecommendationProvenanceSchema.safeParse('unknown').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(RecommendationProvenanceSchema.safeParse('').success).toBe(false);
  });
});

describe('RecommendationSourceSchema', () => {
  const validSource = { repo: 'wshobson/agents', installs: 12345 };

  it('accepts a well-formed source', () => {
    expect(RecommendationSourceSchema.safeParse(validSource).success).toBe(true);
  });

  it('rejects an empty repo', () => {
    expect(RecommendationSourceSchema.safeParse({ ...validSource, repo: '' }).success).toBe(false);
  });

  it('rejects a negative installs count', () => {
    expect(RecommendationSourceSchema.safeParse({ ...validSource, installs: -1 }).success).toBe(
      false
    );
  });

  it('rejects a non-integer installs count', () => {
    expect(RecommendationSourceSchema.safeParse({ ...validSource, installs: 12.5 }).success).toBe(
      false
    );
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
