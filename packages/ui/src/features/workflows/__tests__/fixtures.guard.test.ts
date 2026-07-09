import { describe, expect, it } from 'vitest';
import { parseWorkflowYaml } from '@qlan-ro/mainframe-core/workflows/dsl';
import { CANONICAL_FIXTURES } from './fixtures';

describe('canonical fixtures are valid DSL', () => {
  it.each(CANONICAL_FIXTURES)('$name parses under the core grammar', ({ yaml }) => {
    expect(() => parseWorkflowYaml(yaml)).not.toThrow();
  });
});
