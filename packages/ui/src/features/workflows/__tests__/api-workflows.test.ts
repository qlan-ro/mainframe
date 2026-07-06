import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
vi.mock('@/lib/api/http', () => ({
  apiBase: () => 'http://d',
  request: vi.fn(),
  requestEmpty: vi.fn(),
}));
import * as http from '@/lib/api/http';
import { startRun, getRun } from '@/lib/api/workflows';

describe('workflows api', () => {
  beforeEach(() => vi.clearAllMocks());
  it('startRun posts inputs to the run endpoint', async () => {
    (http.request as unknown as MockedFunction<typeof http.request>).mockResolvedValue({ id: 'r1' });
    await startRun(31415, 'global:hello', { who: 'x' });
    expect(http.request).toHaveBeenCalledWith('POST', 'http://d/api/workflows/global%3Ahello/runs', {
      inputs: { who: 'x' },
    });
  });
  it('getRun hits the run-detail endpoint', async () => {
    (http.request as unknown as MockedFunction<typeof http.request>).mockResolvedValue({ run: {}, tree: [] });
    await getRun(31415, '4471');
    expect(http.request).toHaveBeenCalledWith('GET', 'http://d/api/workflow-runs/4471');
  });
});
