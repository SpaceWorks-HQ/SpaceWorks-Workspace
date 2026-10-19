import { z } from "zod";
import { idSchema } from "@/lib/validation";

/** Brand colour tokens a team may use (never a hex value). */
export const TEAM_COLORS = ["teal", "citron", "orange", "sky", "yellow", "ink"] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];

export const TEAM_COLOR_LABELS: Record<TeamColor, string> = {
  teal: "Maker Teal",
  citron: "Citron",
  orange: "Workshop Orange",
  sky: "Sky Blue",
  yellow: "Warm Yellow",
  ink: "Deep Ink",
};

/** Swatch classes per token (decoration only; names always carry the meaning). */
export const TEAM_COLOR_CLASSES: Record<TeamColor, string> = {
  teal: "bg-sw-teal",
  citron: "bg-sw-citron",
  orange: "bg-sw-orange",
  sky: "bg-sw-sky",
  yellow: "bg-sw-yellow",
  ink: "bg-sw-ink",
};

export function teamColorClass(color: string | null | undefined) {
  return (TEAM_COLORS as readonly string[]).includes(color ?? "") ? TEAM_COLOR_CLASSES[color as TeamColor] : "bg-emphasis";
}

export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Give the team a name.").max(60, "Keep the name under 60 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .optional()
    .transform((value) => value || null),
  color: z.union([z.enum(TEAM_COLORS), z.literal("")]).optional().transform((value) => value || null),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});
export type TeamInput = z.input<typeof teamInputSchema>;

export const teamMemberInputSchema = z.object({
  teamId: idSchema,
  userId: idSchema,
  role: z.enum(["LEAD", "MEMBER"]).default("MEMBER"),
});

export const teamRefSchema = z.object({ teamId: idSchema });
export const teamMemberRefSchema = z.object({ teamId: idSchema, userId: idSchema });
export const archiveTeamSchema = z.object({ teamId: idSchema, archived: z.boolean() });
