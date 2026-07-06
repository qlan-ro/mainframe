import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseWorkflowYaml, WorkflowParseError } from './dsl/parse.js';
import { verifyWorkflow } from './dsl/verify.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate the YAML string, then write it to `dir/<name>.yml`.
 * Throws `WorkflowParseError` on parse failure, `ValidationError` on verify
 * failure or name mismatch. Callers must path-safety-check `dir` before calling.
 */
export async function writeWorkflowYaml(args: {
  dir: string;
  name: string;
  yaml: string;
}): Promise<{ filePath: string }> {
  const def = parseWorkflowYaml(args.yaml); // throws WorkflowParseError on failure
  const errors = verifyWorkflow(def);
  if (errors.length > 0) {
    throw new ValidationError(errors.map((e) => e.message).join('; '));
  }
  if (def.name !== args.name) {
    throw new ValidationError(`name mismatch: file identifier '${args.name}' vs definition name '${def.name}'`);
  }
  const filePath = join(args.dir, `${args.name}.yml`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, args.yaml, 'utf8');
  return { filePath };
}
