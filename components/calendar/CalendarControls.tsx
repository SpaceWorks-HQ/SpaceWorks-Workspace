"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import { LAYERS, csvCell, type Layer } from "@/lib/calendar/algorithms";
import { syncCalendarGoogleAction, connectCalendarGoogleAction } from "@/app/actions/calendar";
import { CalendarNavigation } from "./CalendarNavigation";
import type { CalendarItem, CalendarScreenProps, CalendarMutationRunner, CalendarNavigate } from "./CalendarTypes";

export function CalendarControls({
  p,
  guest,
  items,
  pending,
  layers,
  setLayers,
  query,
  setQuery,
  person,
  setPerson,
  team,
  setTeam,
  project,
  setProject,
  mine,
  setMine,
  setMessage,
  run,
  navigate,
}: {
  p: CalendarScreenProps;
  guest: boolean;
  items: CalendarItem[];
  pending: boolean;
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
  query: string;
  setQuery: (query: string) => void;
  person: string;
  setPerson: (person: string) => void;
  team: string;
  setTeam: (team: string) => void;
  project: string;
  setProject: (project: string) => void;
  mine: boolean;
  setMine: (mine: boolean) => void;
  setMessage: (message: string) => void;
  run: CalendarMutationRunner;
  navigate: CalendarNavigate;
}) {
  const exportCsv = () => {
    const text = [
      ["Layer", "Title", "Starts", "Ends", "Time zone", "Status"],
      ...items.map((i) => [
        LAYERS[i.layer],
        i.title,
        i.start,
        i.end,
        p.zone,
        i.status ?? "",
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-calendar.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card className="space-y-4">
      <CalendarNavigation p={p} navigate={navigate} />
      <fieldset>
        <legend className="text-label">Layers</legend>
        <div className="flex flex-wrap gap-x-4">
          {(Object.entries(LAYERS) as [Layer, string][])
            .filter(
              ([key]) =>
                (key !== "google" || p.googleConnected) &&
                (!guest || ["meeting", "task", "reminder"].includes(key)),
            )
            .map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-11 items-center gap-2 text-body-ui"
              >
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={layers.includes(key)}
                  onChange={(e) =>
                    setLayers(
                      e.target.checked
                        ? [...layers, key]
                        : layers.filter((l) => l !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        {!guest && (
          <>
            <Field label="Person">
              <Dropdown
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Everyone I can see</option>
                {p.data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name ?? "Member"}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Team">
              <Dropdown
                value={team}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">All visible teams</option>
                {p.data.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Project">
              <Dropdown
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">All visible projects</option>
                {p.data.projects.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Dropdown>
            </Field>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          Only mine
        </label>
        {!guest && (
          <Button
            variant="quiet"
            onClick={() => {
              const own = p.data.teams.find((t) =>
                t.members.some((m) => m.userId === p.viewerId),
              );
              if (own) setTeam(own.id);
              else setMessage("You have no team yet.");
            }}
          >
            My team
          </Button>
        )}
        <Button variant="quiet" onClick={exportCsv}>
          Export CSV
        </Button>
        <Link
          className="inline-flex min-h-11 items-center text-accent-text underline"
          href={`/w/${p.slug}/calendar/subscribe`}
        >
          Personal ICS feed
        </Link>
        {!guest && (
          <>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() =>
                run(
                  async () => {
                    if (p.googleConnected) {
                      const r = await syncCalendarGoogleAction(p.slug);
                      if (r.ok && r.data?.failed)
                        return {
                          ok: false,
                          error:
                            "Some Google events could not sync. Try again.",
                        };
                      if (r.ok)
                        setMessage(`Synced ${r.data?.synced ?? 0} meetings.`);
                      return r;
                    }
                    const r = await connectCalendarGoogleAction(p.slug);
                    if (r.ok && r.data) window.location.assign(r.data);
                    return r;
                  },
                  p.googleConnected
                    ? "Google sync finished."
                    : "Opening Google",
                )
              }
            >
              {p.googleConnected
                ? "Sync my Google Calendar"
                : "Connect my Google Calendar"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
