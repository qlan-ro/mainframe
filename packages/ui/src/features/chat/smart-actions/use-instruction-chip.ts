'use client';

/**
 * The single decision point for all four instruction seams (prose span, inline
 * code, language-less fence, language-tagged fence): "does this text chip?".
 *
 * A syntactic match is not enough — the name must resolve in the per-chat
 * skills catalog, or an unknown `/word` in prose would grow buttons that run
 * nothing. While the catalog is loading there is no chip; it appears when the
 * catalog resolves.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { parseInstructionLine, type Skill } from '@qlan-ro/mainframe-types';
import { resolveSkillName, useChatSkills } from '@/features/skills/use-chat-skills';
import { useSmartActionsEnabled } from './smart-actions-context';

export interface InstructionChipTarget {
  /** The bare `/name` token — the chip's `data-smart-action-token`. */
  token: string;
  /** Instruction plus any arguments; what the chip displays and inserts. */
  insertText: string;
}

/**
 * `resolveSkillName` falls back to returning its input, so a bare string
 * comparison cannot tell "resolved" from "unknown". Round-trip it instead: the
 * fallback name only matches a real skill when it was an exact match anyway.
 */
function isKnownSkill(name: string, skills: Skill[]): boolean {
  const resolved = resolveSkillName(name, skills);
  return skills.some((skill) => (skill.invocationName || skill.name) === resolved);
}

function useResolvedTarget(text: string | null): InstructionChipTarget | null {
  const enabled = useSmartActionsEnabled();
  const { skills, loading } = useChatSkills();

  return useMemo(() => {
    if (!enabled || loading || text === null) return null;
    const line = parseInstructionLine(text);
    if (!line || !isKnownSkill(line.name, skills)) return null;
    return { token: `/${line.name}`, insertText: line.insertText };
  }, [enabled, loading, text, skills]);
}

/** Prose spans: the marker node's token, which never carries arguments. */
export function useInstructionChipForToken(token: string | undefined): InstructionChipTarget | null {
  return useResolvedTarget(token ?? null);
}

/**
 * Code seams: an inline span or fence body whose *entire* content is one
 * instruction line. Children arrive as rendered React nodes, so anything that
 * is not plain text (a nested element from another plugin) is not an
 * instruction and yields no chip.
 */
export function useInstructionChipForLine(children: ReactNode): InstructionChipTarget | null {
  const text = useMemo(() => flattenText(children), [children]);
  return useResolvedTarget(text);
}

function flattenText(children: ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.every((child) => typeof child === 'string')) {
    return children.join('');
  }
  return null;
}
