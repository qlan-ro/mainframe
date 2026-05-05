import React, { useState, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Button } from '../ui/button';
import '../editor/setup';

interface DiffViewProps {
  oldCode: string;
  newCode: string;
  filename: string;
  mode?: 'inline' | 'split';
  onModeChange?: (mode: 'inline' | 'split') => void;
}

export const DiffView: React.FC<DiffViewProps> = ({ oldCode, newCode, filename, mode = 'inline', onModeChange }) => {
  const [currentMode, setCurrentMode] = useState<'inline' | 'split'>(mode);

  const handleModeChange = useCallback(
    (newMode: 'inline' | 'split') => {
      setCurrentMode(newMode);
      onModeChange?.(newMode);
    },
    [onModeChange],
  );

  // Detect language from filename
  const ext = filename.split('.').pop() || '';
  const language = getLanguageFromExt(ext);

  return (
    <div className="flex h-full flex-col bg-mf-panel-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-mf-border px-4 py-3 shrink-0">
        <span className="text-sm font-medium text-mf-text-secondary">{filename}</span>
        <div className="flex gap-2">
          <Button
            variant={currentMode === 'inline' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => handleModeChange('inline')}
            aria-label="Switch to inline diff view"
          >
            ≣ Inline
          </Button>
          <Button
            variant={currentMode === 'split' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => handleModeChange('split')}
            aria-label="Switch to side-by-side diff view"
          >
            ⇄ Split
          </Button>
        </div>
      </div>

      {/* Diff Editor */}
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language={language}
          original={oldCode}
          modified={newCode}
          theme="mainframe-dark"
          options={{
            originalEditable: false,
            readOnly: true,
            renderSideBySide: currentMode === 'split',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', monospace",
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
              useShadows: false,
            },
            padding: { top: 4, bottom: 4 },
          }}
        />
      </div>
    </div>
  );
};

function getLanguageFromExt(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    xml: 'xml',
  };
  return map[ext.toLowerCase()] || 'plaintext';
}
