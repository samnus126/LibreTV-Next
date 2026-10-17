import { afterEach, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns/promises';
import { isBlockedByDNS } from './ssrf';

afterEach(() => vi.restoreAllMocks());

describe('Workers-compatible DNS checks', () => {
  it('blocks a private IPv4 answer even when lookup is unavailable', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('Not implemented'));
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['192.168.1.5']);
    vi.spyOn(dns, 'resolve6').mockResolvedValue([]);
    expect(await isBlockedByDNS('https://source.example/video')).toBe(true);
  });
  it('blocks private IPv6 when no IPv4 answer exists', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('Not implemented'));
    vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENODATA'));
    vi.spyOn(dns, 'resolve6').mockResolvedValue(['fd00::10']);
    expect(await isBlockedByDNS('https://source.example/video')).toBe(true);
  });
  it('allows public IPv4 and IPv6 answers', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('Not implemented'));
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.1.1.1']);
    vi.spyOn(dns, 'resolve6').mockResolvedValue(['2606:4700::1111']);
    expect(await isBlockedByDNS('https://source.example/video')).toBe(false);
  });
});
