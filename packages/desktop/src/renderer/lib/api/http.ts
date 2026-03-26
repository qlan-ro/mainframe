const host: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const port: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_HTTP_PORT'] ?? '31415';
const API_BASE = `http://${host}:${port}`;

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
  } catch {
    /* response body not JSON */
  }
  return `HTTP ${res.status}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return res.json();
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return res.json();
}

async function deleteRequest(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
}

export { API_BASE, fetchJson, postJson, putJson, deleteRequest };
