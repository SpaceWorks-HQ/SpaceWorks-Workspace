import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/monitor/coord', () => ({ waitForSlot: vi.fn(async () => true) }));
import { waitForSlot } from '@/lib/monitor/coord';
import { createProviderHttp, retryDelayMs } from '@/lib/monitor/cloud/http';
beforeEach(() => { vi.mocked(waitForSlot).mockReset().mockResolvedValue(true); });
describe('monitor provider throttling', () => {
  it('parses numeric, date and epoch reset headers', () => {
    expect(retryDelayMs(new Headers({ 'retry-after': '12' }), 0)).toBe(12000);
    expect(retryDelayMs(new Headers({ 'retry-after': 'Mon, 19 Oct 2026 12:00:00 GMT' }), Date.parse('2026-10-19T11:59:00Z'))).toBe(60000);
    expect(retryDelayMs(new Headers({ 'x-ratelimit-reset': '1792411200' }), 1792411190000)).toBe(10000);
  });
  it('does not contact a provider when coordination fails closed', async () => { vi.mocked(waitForSlot).mockResolvedValue(false); const fetchImpl = vi.fn(); await expect(createProviderHttp({ key: 'fixture', spacingMs: 1, fetchImpl }).json('https://api.example.com')).rejects.toMatchObject({ kind: 'rate_limited' }); expect(fetchImpl).not.toHaveBeenCalled(); });
  it('honours a short Retry-After before retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } })).mockResolvedValueOnce(Response.json({ ok: true })); const sleep = vi.fn(async (ms: number) => { void ms; });
    expect((await createProviderHttp({ key: 'fixture', spacingMs: 0, fetchImpl, sleep }).json('https://api.example.com')).data).toEqual({ ok: true }); expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
  });
  it('defers long Retry-After values without retrying early', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } })); const sleep = vi.fn();
    await expect(createProviderHttp({ key: 'fixture', spacingMs: 0, fetchImpl, sleep }).json('https://api.example.com')).rejects.toMatchObject({ kind: 'rate_limited' }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it('does not expose provider error bodies or credentials', async () => { const fetchImpl = vi.fn(async () => new Response('credential-leak', { status: 403 })); await expect(createProviderHttp({ key: 'fixture', spacingMs: 0, fetchImpl }).json('https://api.example.com')).rejects.toThrow('required read permission'); });
});
