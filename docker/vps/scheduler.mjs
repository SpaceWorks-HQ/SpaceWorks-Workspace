// Independent recovery ticks; never log credentials or response bodies.
async function tick() {
  for (const path of ["outbox", "jobs"]) {
    try {
      const response = await fetch(`http://app:3000/api/internal/${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55_000),
      });
      await response.body?.cancel();
      if (!response.ok) console.error(`Scheduled ${path} returned HTTP ${response.status}.`);
    } catch { console.error(`Scheduled ${path} request failed.`); }
  }
}
await tick();
setInterval(tick, 60_000);
