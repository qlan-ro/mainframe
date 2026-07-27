import { describe, expect, it } from 'vitest';
import { classifyLocalhostUrl, isTunnelEligiblePort, parsePortTunnelLabel, portTunnelLabel } from '../port-tunnels.js';

describe('classifyLocalhostUrl', () => {
  it('reads an explicit port from every localhost host form', () => {
    expect(classifyLocalhostUrl('http://localhost:5173')).toEqual({ port: 5173 });
    expect(classifyLocalhostUrl('http://127.0.0.1:3000/path?q=1')).toEqual({ port: 3000 });
    expect(classifyLocalhostUrl('http://[::1]:8080')).toEqual({ port: 8080 });
  });

  it('defaults the port by scheme when none is given', () => {
    expect(classifyLocalhostUrl('http://localhost')).toEqual({ port: 80 });
    expect(classifyLocalhostUrl('https://localhost')).toEqual({ port: 443 });
    expect(classifyLocalhostUrl('https://127.0.0.1/')).toEqual({ port: 443 });
    expect(classifyLocalhostUrl('https://[::1]')).toEqual({ port: 443 });
  });

  it('rejects hosts that are not loopback', () => {
    expect(classifyLocalhostUrl('http://example.com:5173')).toBeNull();
    expect(classifyLocalhostUrl('https://example.com/localhost')).toBeNull();
    expect(classifyLocalhostUrl('http://localhost.example.com')).toBeNull();
    expect(classifyLocalhostUrl('http://127.0.0.2:3000')).toBeNull();
  });

  it('rejects schemes other than http and https', () => {
    expect(classifyLocalhostUrl('ws://localhost:5173')).toBeNull();
    expect(classifyLocalhostUrl('file:///tmp/localhost')).toBeNull();
  });

  it('rejects an unparsable href', () => {
    expect(classifyLocalhostUrl('not a url')).toBeNull();
    expect(classifyLocalhostUrl('')).toBeNull();
  });
});

describe('isTunnelEligiblePort', () => {
  it('accepts the unprivileged range', () => {
    expect(isTunnelEligiblePort(1024, 31415)).toBe(true);
    expect(isTunnelEligiblePort(5173, 31415)).toBe(true);
    expect(isTunnelEligiblePort(65535, 31415)).toBe(true);
  });

  it('refuses privileged and out-of-range ports', () => {
    expect(isTunnelEligiblePort(0, 31415)).toBe(false);
    expect(isTunnelEligiblePort(80, 31415)).toBe(false);
    expect(isTunnelEligiblePort(1023, 31415)).toBe(false);
    expect(isTunnelEligiblePort(65536, 31415)).toBe(false);
  });

  it("refuses the daemon's own port", () => {
    expect(isTunnelEligiblePort(31415, 31415)).toBe(false);
  });
});

describe('port tunnel labels', () => {
  it('builds the label from the port', () => {
    expect(portTunnelLabel(5173)).toBe('port:5173');
  });

  it('reads the port back out of the label', () => {
    expect(parsePortTunnelLabel('port:5173')).toBe(5173);
  });

  it('rejects labels owned by other tunnels', () => {
    expect(parsePortTunnelLabel('daemon')).toBeNull();
    expect(parsePortTunnelLabel('preview:abc')).toBeNull();
    expect(parsePortTunnelLabel('port:abc')).toBeNull();
    expect(parsePortTunnelLabel('port:')).toBeNull();
    expect(parsePortTunnelLabel('port:5173:extra')).toBeNull();
  });
});
