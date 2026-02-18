import React from 'react';

const EXT_MAP: Record<string, { label: string; bg: string; text: string }> = {
  ts: { label: 'TS', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  tsx: { label: 'TS', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  js: { label: 'JS', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  jsx: { label: 'JS', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  mjs: { label: 'JS', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  json: { label: '{}', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  md: { label: 'MD', bg: 'bg-zinc-500/20', text: 'text-zinc-400' },
  css: { label: 'CSS', bg: 'bg-purple-500/20', text: 'text-purple-400' },
  html: { label: 'HTM', bg: 'bg-orange-500/20', text: 'text-orange-400' },
  py: { label: 'PY', bg: 'bg-green-500/20', text: 'text-green-400' },
  rs: { label: 'RS', bg: 'bg-orange-500/20', text: 'text-orange-400' },
  go: { label: 'GO', bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  yaml: { label: 'YML', bg: 'bg-pink-500/20', text: 'text-pink-400' },
  yml: { label: 'YML', bg: 'bg-pink-500/20', text: 'text-pink-400' },
  toml: { label: 'TML', bg: 'bg-zinc-500/20', text: 'text-zinc-400' },
  sh: { label: 'SH', bg: 'bg-green-500/20', text: 'text-green-400' },
  sql: { label: 'SQL', bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

export function FileTypeIcon({ filePath }: { filePath: string }) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const info = EXT_MAP[ext];

  if (!info) {
    const shortExt = ext.slice(0, 3).toUpperCase() || '?';
    return (
      <span className="inline-flex items-center justify-center h-4 min-w-[24px] px-1 rounded text-mf-micro font-bold leading-none bg-zinc-500/20 text-zinc-400">
        {shortExt}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center h-4 min-w-[24px] px-1 rounded text-mf-micro font-bold leading-none ${info.bg} ${info.text}`}
    >
      {info.label}
    </span>
  );
}
