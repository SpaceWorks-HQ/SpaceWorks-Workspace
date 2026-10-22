// Managed-host scheduler: APP_URL is private; only CRON_SECRET is needed.
const origin = new URL(process.env.APP_URL || 'http://app:3000');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_URL must be an HTTP(S) origin.');
if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error('CRON_SECRET is required.');
async function tick() {
  for (const endpoint of ['outbox', 'jobs']) {
    const response = await fetch(new URL(`/api/internal/${endpoint}`, origin), { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Scheduled ${endpoint} returned HTTP ${response.status}.`);
  }
}
if (process.argv.includes('--once')) await tick();
else { await tick().catch(() => console.error('Scheduler tick failed.')); setInterval(() => tick().catch(() => console.error('Scheduler tick failed.')),60_000); }
