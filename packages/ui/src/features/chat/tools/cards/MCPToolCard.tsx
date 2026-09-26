/**
 * MCPToolCard — marker pill for `mcp__<server>__<tool>` tool calls.
 *
 * Registry key: '_Mcp' (catches all mcp__* via resolveToolCard).
 * Visual family: centered marker pill on the chat spine (MarkerWrap/MarkerPill).
 *
 * Behavior:
 *   - Parse mcp__<server>__<tool>; strip leading 'claude_ai_' from server; capitalize.
 *   - Row: Plug icon + '{server} executed {tool}' (tool in text-primary).
 *   - Pending: 'executing', Error: '{server} failed: {tool}'.
 *   - Expandable (success only) → MarkerBody with ARGUMENTS + RESULT sections.
 *   - Tooltip on the pill = the raw toolName.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { PlugIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MarkerWrap,
  MarkerPill,
  MarkerBody,
  MarkerCapsLabel,
  MarkerPre,
  useMarkerOpen,
  type MarkerState,
} from './marker-pill';
import { isErrorResult, extractResultContent, resultImages } from '../shared/result';
import { ToolResultImageThumbs } from '../shared/ToolResultImageThumbs';

// ── Parse MCP tool name ───────────────────────────────────────────────────────

function parseMcpToolName(toolName: string): { server: string; tool: string } {
  const match = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!match) return { server: 'mcp', tool: toolName };
  let server = match[1] ?? 'mcp';
  if (server.startsWith('claude_ai_')) server = server.slice('claude_ai_'.length);
  server = server.charAt(0).toUpperCase() + server.slice(1);
  return { server, tool: match[2] ?? toolName };
}

// ── Result text extraction ────────────────────────────────────────────────────

/**
 * Falls back to JSON.stringify for non-string, non-image results — but an
 * image-carrying result (todo #363) must never hit that branch, since it
 * would serialize the base64 `images` payload into the marker body.
 */
function extractResultText(result: unknown): string {
  const content = extractResultContent(result);
  if (content !== '') return content;
  if (resultImages(result).length > 0) return content;
  if (result !== undefined && result !== null && typeof result !== 'string') {
    return JSON.stringify(result, null, 2);
  }
  return content;
}

// ── MCPToolCard ───────────────────────────────────────────────────────────────

export const MCPToolCard: ToolCallMessagePartComponent = ({ toolCallId, toolName, args, result, isError }) => {
  const { server, tool } = parseMcpToolName(toolName);
  const { open, toggle } = useMarkerOpen(false);

  const isPending = result === undefined;
  const errored = !isPending && isErrorResult(result, isError);

  const state: MarkerState = isPending ? 'pending' : errored ? 'error' : 'done';
  const expandable = state === 'done';

  const verb = errored ? 'failed:' : isPending ? 'executing' : 'executed';

  const argsText = JSON.stringify(args, null, 2);
  const resultText = extractResultText(result);
  const images = resultImages(result);

  const pillContent = (
    <>
      {server} {verb} {state !== 'error' && <span className="text-primary">{tool}</span>}
      {state === 'error' && <span className="text-destructive">{tool}</span>}
    </>
  );

  return (
    <MarkerWrap>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <MarkerPill
              icon={<PlugIcon />}
              state={state}
              expandable={expandable}
              open={open}
              onClick={toggle}
              testId="chat-mcp-pill"
            >
              {pillContent}
            </MarkerPill>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs font-mono break-all">
          {toolName}
        </TooltipContent>
      </Tooltip>

      {open && expandable && (
        <MarkerBody>
          <div className="flex flex-col gap-3">
            <div>
              <MarkerCapsLabel>Arguments</MarkerCapsLabel>
              <MarkerPre muted>{argsText}</MarkerPre>
            </div>
            {resultText && (
              <div>
                <MarkerCapsLabel>Result</MarkerCapsLabel>
                <MarkerPre>{resultText}</MarkerPre>
              </div>
            )}
            {images.length > 0 && (
              <div>
                <MarkerCapsLabel>Images</MarkerCapsLabel>
                <ToolResultImageThumbs toolCallId={toolCallId} images={images} />
              </div>
            )}
          </div>
        </MarkerBody>
      )}
    </MarkerWrap>
  );
};

MCPToolCard.displayName = 'MCPToolCard';
