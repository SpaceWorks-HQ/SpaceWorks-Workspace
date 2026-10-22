import type { WorkspaceRole } from "@prisma/client";
import type { CalendarItem } from "@/lib/calendar/query";
import type { CalendarData } from "./CalendarScreen";

export type { CalendarItem };
export type { CalendarData } from "./CalendarScreen";
export type CalendarScreenProps = {
  data: CalendarData;
  assigned: { id: string; title: string; number: number; dueAt: string }[];
  slug: string;
  viewerId: string;
  role: WorkspaceRole;
  workspaceZone: string;
  viewerZone: string;
  zone: string;
  date: string;
  view: string;
  firstDay: string;
  dayCount: number;
  googleConnected: boolean;
  googleError: boolean;
};

export type CalendarMutationRunner = (
  fn: () => Promise<{ ok: boolean; error?: string }>,
  success: string,
) => void;

export type CalendarNavigate = (date?: string, view?: string, zone?: string) => void;
