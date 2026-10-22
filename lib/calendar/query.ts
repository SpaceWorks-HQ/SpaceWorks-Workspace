import "server-only";

import type { Actor } from "@/lib/meetings/core";
import type { Layer } from "./algorithms";
import { loadCalendarRecords } from "./query/records";
import { mapCalendar } from "./query/mappers";

export type CalendarItem = {
  id: string;
  sourceId: string;
  layer: Layer;
  title: string;
  start: string;
  end: string;
  url: string;
  people: string[];
  teamId: string | null;
  projectId: string | null;
  mine: boolean;
  taskNumber?: number;
  editable?: boolean;
  status?: string;
  avatars?: { name: string; image: string | null }[];
};
export async function loadCalendar(actor: Actor, start: Date, end: Date) {
  return mapCalendar(actor, start, end, await loadCalendarRecords(actor, start, end));
}
