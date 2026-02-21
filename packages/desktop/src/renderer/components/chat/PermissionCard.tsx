import React, { useState } from 'react';
import { ShieldAlert, Terminal, ChevronRight } from 'lucide-react';
import type { PermissionRequest, PermissionUpdate } from '@mainframe/types';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface PermissionCardProps {
  request: PermissionRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: PermissionUpdate[],
    overrideInput?: Record<string, unknown>,
  ) => void;
}

export function PermissionCard({ request, onRespond }: PermissionCardProps): React.ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="border border-mf-accent/30 bg-mf-app-bg rounded-mf-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-mf-accent/10">
        <ShieldAlert size={16} className="text-mf-accent" />
        <span className="text-mf-body font-semibold text-mf-text-primary">Permission Required</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Tool name */}
        <div className="flex items-center gap-2 text-mf-body text-mf-text-secondary">
          <Terminal size={14} />
          <span>{request.toolName}</span>
        </div>

        {/* Collapsible command preview */}
        <div>
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-mf-small text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          >
            <ChevronRight size={14} className={cn('transition-transform duration-200', detailsOpen && 'rotate-90')} />
            <span>Details</span>
          </button>
          {detailsOpen && (
            <div className="mt-2 bg-mf-input-bg rounded-mf-input p-2">
              <pre className="text-mf-small font-mono text-mf-text-primary overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(request.input, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onRespond('deny')}>
            Deny
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRespond('allow')}>
            Allow Once
          </Button>
          {request.suggestions.length > 0 && (
            <Button
              size="sm"
              className="bg-mf-accent text-white hover:bg-mf-accent/90"
              onClick={() => onRespond('allow', request.suggestions)}
            >
              Always Allow
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
