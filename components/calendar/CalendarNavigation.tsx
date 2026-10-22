"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import type { CalendarScreenProps, CalendarNavigate } from "./CalendarTypes";

const subscribeZone = () => () => {};
const browserZoneSnapshot = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export function CalendarNavigation({ p, navigate }: {
  p: CalendarScreenProps;
  navigate: CalendarNavigate;
}) {
  const browserZone = useSyncExternalStore(
    subscribeZone,
    browserZoneSnapshot,
    () => p.viewerZone,
  );
  const move = (amount: number) => {
    const d = new Date(`${p.date}T12:00Z`);
    if (p.view === "month") {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + amount);
    } else
      d.setUTCDate(
        d.getUTCDate() +
          amount * (p.view === "day" ? 1 : p.view === "week" ? 7 : 30),
      );
    navigate(d.toISOString().slice(0, 10));
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            aria-label="Previous period"
            onClick={() => move(-1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              navigate(
                zonedDatetimeLocalValue(new Date(), p.zone).slice(0, 10),
              )
            }
          >
            Today
          </Button>
          <Button
            variant="secondary"
            aria-label="Next period"
            onClick={() => move(1)}
          >
            Next
          </Button>
        </div>
        <Field label="Date">
          <Input
            type="date"
            value={p.date}
            onChange={(e) => {
              if (e.target.value) navigate(e.target.value);
            }}
          />
        </Field>
        <Field label="Time zone">
          <Dropdown
            value={p.zone}
            onChange={(e) => navigate(p.date, p.view, e.target.value)}
          >
            {[
              ...new Set([
                p.workspaceZone,
                p.viewerZone,
                browserZone,
                p.zone,
                "UTC",
              ]),
            ].map((z) => (
              <option key={z} value={z}>
                {z === p.workspaceZone
                  ? `Workspace · ${z}`
                  : `My view · ${z}`}
              </option>
            ))}
          </Dropdown>
        </Field>
      </div>
      <nav aria-label="Calendar views" className="flex flex-wrap gap-2">
        {["day", "week", "month", "agenda"].map((view) => (
          <Button
            key={view}
            variant="quiet"
            aria-pressed={p.view === view}
            onClick={() => navigate(p.date, view)}
            className={
              p.view === view ? "border-b-2 border-accent rounded-none" : ""
            }
          >
            {view[0].toUpperCase() + view.slice(1)}
          </Button>
        ))}
      </nav>
    </>
  );
}
