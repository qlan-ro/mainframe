import React, { useEffect, useState, useMemo } from 'react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { getFileContent } from '../../lib/api';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      row.push(field);
      field = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === '\r') i++;
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

export function CsvViewer({ filePath }: { filePath: string }): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setRawContent(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => setRawContent(result.content))
      .catch(() => setError('Failed to load CSV'));
  }, [activeProjectId, filePath, activeChatId]);

  const rows = useMemo(() => (rawContent ? parseCsv(rawContent) : []), [rawContent]);
  const header = rows[0];
  const body = rows.slice(1);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (rawContent === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>
    );
  }

  if (!header || header.length === 0) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Empty CSV</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-mf-small font-mono">
        <thead className="sticky top-0 bg-mf-sidebar z-10">
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="text-left px-3 py-2 text-mf-text-primary font-medium border-b border-mf-divider whitespace-nowrap"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="hover:bg-mf-hover">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5 text-mf-text-secondary border-b border-mf-divider/50 whitespace-nowrap"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
