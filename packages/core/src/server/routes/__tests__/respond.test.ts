import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { ok, okEmpty, fail } from '../respond.js';

function mockRes(): Response & { body?: unknown; statusCode: number } {
  const res = { statusCode: 200 } as unknown as Response & { body?: unknown; statusCode: number };
  res.status = vi.fn((n: number) => {
    res.statusCode = n;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  }) as unknown as Response['json'];
  return res;
}

describe('respond helpers', () => {
  it('ok wraps payload in { success: true, data }', () => {
    const res = mockRes();
    ok(res, { a: 1 });
    expect(res.body).toEqual({ success: true, data: { a: 1 } });
  });

  it('okEmpty emits { success: true }', () => {
    const res = mockRes();
    okEmpty(res);
    expect(res.body).toEqual({ success: true });
  });

  it('fail sets status and emits { success: false, error }', () => {
    const res = mockRes();
    fail(res, 404, 'Not found');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not found' });
  });
});
