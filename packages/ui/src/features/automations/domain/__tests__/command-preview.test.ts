import { describe, expect, it } from 'vitest';
import type { AutomationStep } from '../../contract';
import { FEATURE_SPIKE_FIXTURE } from '../../fixtures/fixtures';
import { buildCommandPreview } from '../command-preview';

function runCommandStep(): AutomationStep {
  const ifStep = FEATURE_SPIKE_FIXTURE.definition.steps[1];
  const thenSteps = ifStep?.kind === 'if' ? ifStep.then : [];
  const step = thenSteps.find((s) => s.kind === 'run_action' && s.actionId === 'run_command');
  if (!step) throw new Error('fixture 6 is missing its run_command step');
  return step;
}

describe('buildCommandPreview — A1 (contract §6)', () => {
  it('substitutes each chip with a quoted "$MF_<n>" and maps it in envMap, for fixture 6 (double-quoted, no warning)', () => {
    const step = runCommandStep();
    const script = step.kind === 'run_action' ? step.params.script : undefined;
    if (!script) throw new Error('expected a script param');
    const result = buildCommandPreview(script);

    expect(result.text).toBe('echo "Verifying feature scope: "$MF_1"" && pnpm --filter @qlan-ro/mainframe-core build');
    expect(result.envMap).toEqual({ MF_1: { stepId: 'pick-feature', output: 'scope' } });
    expect(result.warnings).toEqual([]);
  });

  it('flags a chip sitting inside single quotes — "$MF_<n>" will not expand there', () => {
    const script = ["echo '", { token: { stepId: 'a', output: 'b' } }, "'"];
    const result = buildCommandPreview(script);

    expect(result.text).toBe(`echo '"$MF_1"'`);
    expect(result.warnings).toEqual([{ index: 1, message: expect.stringContaining('single quotes') }]);
  });

  it('flags a chip sitting inside a quoted heredoc — "$MF_<n>" will not expand there', () => {
    const script = ["cat <<'EOF'\nHello ", { token: { stepId: 'a', output: 'b' } }, '\nEOF\n'];
    const result = buildCommandPreview(script);

    expect(result.text).toBe(`cat <<'EOF'\nHello "$MF_1"\nEOF\n`);
    expect(result.warnings).toEqual([{ index: 1, message: expect.stringContaining('heredoc') }]);
  });

  it('does not warn for a chip inside an UNQUOTED heredoc (that form does expand $VAR)', () => {
    const script = ['cat <<EOF\nHello ', { token: { stepId: 'a', output: 'b' } }, '\nEOF\n'];
    const result = buildCommandPreview(script);
    expect(result.warnings).toEqual([]);
  });

  it('assigns a fresh MF_<n> per occurrence, even for the same token repeated', () => {
    const ref = { stepId: 'a', output: 'b' };
    const script = [{ token: ref }, ' and ', { token: ref }];
    const result = buildCommandPreview(script);
    expect(result.text).toBe('"$MF_1" and "$MF_2"');
    expect(result.envMap).toEqual({ MF_1: ref, MF_2: ref });
  });

  it('never sees cwd/runIn — only the script chip array is accepted, so cwd can never leak into envMap', () => {
    const step = runCommandStep();
    const params = step.kind === 'run_action' ? step.params : {};
    expect(params.runIn).toBeDefined(); // sanity: the fixture really does carry a runIn param
    const result = buildCommandPreview(params.script ?? []);
    expect(Object.values(result.envMap)).not.toContainEqual(expect.objectContaining({ output: 'runIn' }));
  });
});
