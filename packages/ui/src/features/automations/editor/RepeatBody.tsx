/**
 * RepeatBody — "For each item in" list-token pick + inner recipe (ts153
 * wf2-editor.jsx `WfRepeatBody`, ported onto the contract's non-optional
 * `RepeatBlock.items: TokenRef`). `currentItemToken` mirrors `domain/tokens.
 * ts`'s private helper of the same name — duplicated rather than exported
 * from that frozen Phase-0 module, since this render-time scope threading
 * (tokens passed as props, `Recipe`/`IfBody`/`RepeatBody` never call
 * `scopeAt`) is a different access pattern than `scopeAt`'s whole-definition
 * walk.
 */
import type { ActionCatalogEntry, RepeatBlock, TokenRef } from '../contract';
import { TOKEN_STEP_CURRENT } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { TokenChip } from '../fields/TokenChip';
import { TokenPicker } from '../fields/TokenPicker';
import { Recipe } from './Recipe';

export interface RepeatBodyProps {
  step: RepeatBlock;
  onChange: (patch: Partial<RepeatBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

function resolve(tokens: TokenDescriptor[], ref: TokenRef): TokenDescriptor | null {
  return tokens.find((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output) ?? null;
}

function currentItemToken(itemsRef: TokenRef, scope: TokenDescriptor[]): TokenDescriptor | null {
  const listToken = resolve(scope, itemsRef);
  if (!listToken) return null;
  const descriptor: TokenDescriptor = {
    ref: { stepId: TOKEN_STEP_CURRENT, output: 'item' },
    label: 'Current item',
    type: 'text',
    sourceKind: 'item',
    source: 'Repeat',
  };
  if (listToken.fields) descriptor.fields = listToken.fields;
  return descriptor;
}

export function RepeatBody({ step, onChange, tokens, catalog, issues, depth }: RepeatBodyProps) {
  const listTokens = tokens.filter((t) => t.type === 'list');
  const chosen = resolve(tokens, step.items);
  const itemToken = currentItemToken(step.items, tokens);
  const inner = itemToken ? [...tokens, itemToken] : tokens;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-foreground">For each item in</span>
        <TokenChip descriptor={chosen} testId={`automations-repeat-items-${step.id}`} />
        <TokenPicker
          tokens={listTokens}
          onInsert={(ref) => onChange({ items: ref })}
          testId={`automations-repeat-items-picker-${step.id}`}
        />
      </div>
      <Recipe
        steps={step.steps}
        onChange={(steps) => onChange({ steps })}
        tokens={inner}
        catalog={catalog}
        issues={issues}
        depth={depth + 1}
        testId={`automations-recipe-${step.id}-steps`}
      />
    </div>
  );
}
