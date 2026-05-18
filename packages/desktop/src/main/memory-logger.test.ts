import { describe, it, expect } from 'vitest';
import { selectRendererMemory } from './renderer-memory.js';

describe('selectRendererMemory', () => {
  const metrics = [
    { pid: 100, type: 'Browser', memory: { workingSetSize: 111, peakWorkingSetSize: 222 } },
    { pid: 200, type: 'Tab', memory: { workingSetSize: 333, peakWorkingSetSize: 444, privateBytes: 555 } },
    { pid: 300, type: 'GPU', memory: { workingSetSize: 666, peakWorkingSetSize: 777 } },
  ];

  it('returns the memory of the process matching the renderer OS pid', () => {
    expect(selectRendererMemory(200, metrics)).toEqual({
      workingSetSize: 333,
      peakWorkingSetSize: 444,
      privateBytes: 555,
    });
  });

  it('returns null when no process matches the pid', () => {
    expect(selectRendererMemory(999, metrics)).toBeNull();
  });
});
