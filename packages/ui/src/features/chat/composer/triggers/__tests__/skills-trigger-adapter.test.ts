import { describe, it, expect } from 'vitest';
import { buildSkillsTriggerAdapter } from '../skills-trigger-adapter';
import type { Skill } from '@qlan-ro/mainframe-types';

const skillFixtures: Skill[] = [
  {
    id: 's1',
    adapterId: 'claude',
    name: 'code-review',
    displayName: 'Code Review',
    description: 'Reviews code for quality issues',
    scope: 'global',
    filePath: '/skills/code-review.md',
    content: '# Code Review',
    invocationName: 'plugin:code-review',
  },
  {
    id: 's2',
    adapterId: 'claude',
    name: 'test-writer',
    displayName: 'Test Writer',
    description: 'Writes unit tests for functions',
    scope: 'project',
    filePath: '/skills/test-writer.md',
    content: '# Test Writer',
    // no invocationName — falls back to name
  },
  {
    id: 's3',
    adapterId: 'claude',
    name: 'foo-debug',
    displayName: 'Foo Debugger',
    description: 'Debugs foo-related failures',
    scope: 'global',
    filePath: '/skills/foo-debug.md',
    content: '# Foo Debug',
    invocationName: 'plugin:foo-debug',
  },
];

describe('buildSkillsTriggerAdapter', () => {
  const adapter = buildSkillsTriggerAdapter(skillFixtures);

  it('categories is empty (search-first)', () => {
    expect(adapter.categories()).toEqual([]);
  });

  it("search('') returns all skills — bare / lists everything", () => {
    const results = adapter.search!('');
    expect(results).toEqual([
      {
        id: 'plugin:code-review',
        type: 'skill',
        label: 'Code Review',
        description: 'Reviews code for quality issues',
      },
      {
        id: 'test-writer',
        type: 'skill',
        label: 'Test Writer',
        description: 'Writes unit tests for functions',
      },
      {
        id: 'plugin:foo-debug',
        type: 'skill',
        label: 'Foo Debugger',
        description: 'Debugs foo-related failures',
      },
    ]);
  });

  it('categoryItems returns all skills mapped to TriggerItems', () => {
    const items = adapter.categoryItems('skills');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: 'plugin:code-review',
      type: 'skill',
      label: 'Code Review',
      description: 'Reviews code for quality issues',
    });
    expect(items[1]).toEqual({
      id: 'test-writer',
      type: 'skill',
      label: 'Test Writer',
      description: 'Writes unit tests for functions',
    });
    expect(items[2]).toEqual({
      id: 'plugin:foo-debug',
      type: 'skill',
      label: 'Foo Debugger',
      description: 'Debugs foo-related failures',
    });
  });

  it('categoryItems uses invocationName as id when present, else name', () => {
    const items = adapter.categoryItems('skills');
    expect(items[0]?.id).toBe('plugin:code-review'); // has invocationName
    expect(items[1]?.id).toBe('test-writer'); // no invocationName
  });

  it('search filters case-insensitively by name/displayName/description', () => {
    // 'foo' matches s3 (name=foo-debug, displayName=Foo Debugger, description contains 'foo')
    const results = adapter.search!('foo');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('plugin:foo-debug');
    expect(results[0]?.label).toBe('Foo Debugger');
  });

  it('search is case-insensitive', () => {
    const results = adapter.search!('TEST');
    // matches s2: name=test-writer, displayName=Test Writer
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('test-writer');
  });

  it('search returns empty array when no match', () => {
    expect(adapter.search!('zzz-no-match')).toHaveLength(0);
  });

  it('search matches on description text', () => {
    // 'unit tests' is in s2 description only
    const results = adapter.search!('unit tests');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('test-writer');
  });
});
