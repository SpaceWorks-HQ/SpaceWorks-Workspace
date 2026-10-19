import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/scheduled', () => ({ runScheduledJobs: vi.fn(async () => ({ ran: 12, failed: [] as string[] })) }));
import { runScheduledJobs } from '@/lib/scheduled';
import { POST } from '@/app/api/internal/jobs/route';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('monitor external scheduler entry point', () => {
  it.each([undefined, 'Bearer wrong-token'])('rejects unauthorized job requests before running work', async authorization => {
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret-with-at-least-32-characters');
    const response = await POST(new Request('http://localhost/api/internal/jobs', { method: 'POST', headers: authorization ? { authorization } : {} })); expect(response.status).toBe(404); expect(runScheduledJobs).not.toHaveBeenCalled();
  });
  it('runs the registry once after valid bearer authentication', async () => { vi.stubEnv('CRON_SECRET', 'fixture-cron-secret-with-at-least-32-characters'); const response = await POST(new Request('http://localhost/api/internal/jobs', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })); expect(response.status).toBe(204); expect(runScheduledJobs).toHaveBeenCalledTimes(1); });
  it('reports job failures without internal details', async () => { vi.stubEnv('CRON_SECRET', 'fixture-cron-secret-with-at-least-32-characters'); vi.mocked(runScheduledJobs).mockResolvedValueOnce({ ran: 12, failed: ['monitor'] }); const response = await POST(new Request('http://localhost/api/internal/jobs', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })); expect(response.status).toBe(500); expect(await response.json()).toEqual({ ok: false }); });
});
