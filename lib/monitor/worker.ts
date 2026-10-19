import "server-only";
import { Limiter, tick, recordCheckerHeartbeat } from "./scheduler";
import { icmpAvailable } from "./checks";
import { sweepHeartbeats } from "./heartbeatService";
import { syncDueConnections } from "./cloud/sync";

const KEY = Symbol.for("sww.monitorWorker");
type Worker = { timer?: ReturnType<typeof setTimeout>; stopped: boolean; limiter: Limiter; cloud?: Promise<void> };
type Global = typeof globalThis & { [KEY]?: Worker };
/** Long-lived Node runtime. Timers are unref'd and one worker exists per process. */
export function startMonitorWorker(): void {
  const global = globalThis as Global;
  if (global[KEY] && !global[KEY]!.stopped) return;
  const state: Worker = { stopped: false, limiter: new Limiter() }; global[KEY] = state;
  void icmpAvailable();
  let nextCloud = 0;
  async function work() {
    if (state.stopped) return;
    try {
      const started = await tick(state.limiter);
      await recordCheckerHeartbeat(started);
      await sweepHeartbeats();
      if (Date.now() >= nextCloud && !state.cloud) {
        nextCloud = Date.now() + 60000;
        state.cloud = syncDueConnections(new Date()).catch(() => { console.error("[monitor] cloud sync failed"); }).finally(() => { state.cloud = undefined; });
      }
    } catch { console.error("[monitor] worker tick failed"); }
    if (!state.stopped) { state.timer = setTimeout(work, 5000); state.timer.unref(); }
  }
  void work();
}
export async function stopMonitorWorker() {
  const state = (globalThis as Global)[KEY];
  if (!state) return;
  state.stopped = true; clearTimeout(state.timer); await state.limiter.idle(); await state.cloud;
}
