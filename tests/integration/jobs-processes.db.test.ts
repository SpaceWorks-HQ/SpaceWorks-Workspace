import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { createQueues, closeQueues, queueConnection } from "@/lib/queue/client";
const redisUrl = process.env.TEST_QUEUE_REDIS_URL || "redis://127.0.0.1:6395/0";
async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No health port available.");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
describe("bundled background entrypoints", () => {
  beforeAll(() => { execFileSync(process.execPath, ["scripts/build-jobs.mjs"], { stdio: "pipe" }); }, 30_000);
  it.each(["worker", "beat"])("%s serves health and exits cleanly on SIGTERM", async role => {
    const prefix = `sww:test:process:${randomUUID()}`;
    const port = await freePort();
    const queues = createQueues(prefix, queueConnection(false, redisUrl));
    const child = spawn(process.execPath, [`dist/${role}.js`], {
      env: { ...process.env, NODE_ENV: "development", REDIS_URL: redisUrl, JOBS_QUEUE_PREFIX: prefix, JOBS_HEALTH_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-1000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-1000); });
    const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    try {
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).status; }
        catch { return 0; }
      }, { timeout: 10_000, interval: 50 }).toBe(200);
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Shutdown did not finish: ${output}`)), 10_000); });
      try { expect(await Promise.race([exited, timeout])).toEqual({ code: 0, signal: null }); }
      finally { clearTimeout(timer); }
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
      for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
      await closeQueues(queues);
    }
  });
});
