import type { CheckStatus } from "@/lib/monitor/types";

/**
 * Monitor state machine (pure). Confirmation: an incident opens after
 * `failureThreshold` consecutive failures. Recovery: it resolves after
 * `successThreshold` consecutive healthy checks; any failure during recovery
 * resets the count. Maintenance: checks still count for recovery but never
 * open incidents or alert. Flapping: a monitor that would open its fifth
 * incident inside an hour is marked flapping; it keeps one quiet incident
 * open and resolves it only after 15 stable minutes.
 */

export type MonitorState = "PENDING" | "UP" | "DEGRADED" | "DOWN" | "PAUSED" | "MAINTENANCE" | "UNKNOWN";

export type MachineMonitor = {
  lastStatus: MonitorState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  successThreshold: number;
  incidentOnDegraded: boolean;
  flapping: boolean;
  intervalSec: number;
};

export type MachineInput = {
  monitor: MachineMonitor;
  outcome: CheckStatus;
  inMaintenance: boolean;
  /** An unresolved AUTO incident is open for this monitor. */
  hasOpenIncident: boolean;
  /** AUTO incidents opened for this monitor in the last hour. */
  recentIncidentCount: number;
  /** Actual continuous recovery duration, supplied by the persisted checker. */
  stableForSec?: number;
};

export type MachineResult = {
  status: MonitorState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  flapping: boolean;
  openIncident: boolean;
  resolveIncident: boolean;
  /** Send monitor.down/incident.opened (or monitor.up/incident.resolved) notifications. */
  notify: boolean;
  /** Emit monitor.degraded (entered DEGRADED without an incident). */
  emitDegraded: boolean;
};

export const FLAPPING_INCIDENTS_PER_HOUR = 4;
export const FLAPPING_STABLE_SEC = 15 * 60;

export function nextMonitorState(input: MachineInput): MachineResult {
  const { monitor, outcome, inMaintenance, hasOpenIncident } = input;
  if (outcome === "UNKNOWN") {
    return {
      status: inMaintenance ? "MAINTENANCE" : "UNKNOWN",
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveSuccesses: monitor.consecutiveSuccesses,
      flapping: monitor.flapping,
      openIncident: false,
      resolveIncident: false,
      notify: false,
      emitDegraded: false,
    };
  }
  const failing = outcome === "DOWN" || (outcome === "DEGRADED" && monitor.incidentOnDegraded);
  const consecutiveFailures = inMaintenance ? 0 : failing ? monitor.consecutiveFailures + 1 : 0;
  const consecutiveSuccesses = failing ? 0 : monitor.consecutiveSuccesses + 1;
  const status: MonitorState = inMaintenance ? "MAINTENANCE" : outcome;

  let flapping = monitor.flapping;
  let openIncident = false;
  let resolveIncident = false;
  let notify = false;

  if (!inMaintenance && failing && !hasOpenIncident && consecutiveFailures >= monitor.failureThreshold) {
    openIncident = true;
    if (input.recentIncidentCount >= FLAPPING_INCIDENTS_PER_HOUR) flapping = true;
    notify = !flapping;
  }

  if (hasOpenIncident && !failing && consecutiveSuccesses >= monitor.successThreshold) {
    const stableEnough = !flapping || (input.stableForSec ?? consecutiveSuccesses * monitor.intervalSec) >= FLAPPING_STABLE_SEC;
    if (stableEnough) {
      resolveIncident = true;
      notify = !inMaintenance;
      flapping = false;
    }
  }

  const emitDegraded = !inMaintenance && outcome === "DEGRADED" && !monitor.incidentOnDegraded && monitor.lastStatus !== "DEGRADED";
  return { status, consecutiveFailures, consecutiveSuccesses, flapping, openIncident, resolveIncident, notify, emitDegraded };
}
