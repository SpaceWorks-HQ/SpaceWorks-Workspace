// Generated from app/w/[workspaceSlug]/documents/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/documents/service";
import { label, financialYear } from "@/lib/documents/rules";
import { type DocumentField } from "@/components/documents/DocumentForm";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (name: string, title: string, value?: string): DocumentField => ({
  name,
  label: title,
  value,
});
const dates: DocumentField[] = [
  { name: "validFrom", label: "Valid from", type: "date", required: true },
  { name: "validTo", label: "Valid to", type: "date", required: true },
];
export async function loadPage({
  params,
}: PageProps<"/w/[workspaceSlug]/documents/settings">) {
const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    settings = await getSettings(actor),
    { profile, references } = settings;
const [series, assets, filingRows, preArnRows] = await Promise.all([
    prisma.documentSeries.findMany({
      where: { workspaceId: actor.workspace.id },
      orderBy: { financialYear: "desc" },
    }),
    prisma.documentFile.findMany({
      where: {
        workspaceId: actor.workspace.id,
        documentId: null,
        kind: "PROFILE",
      },
      include: { file: { select: { filename: true } } },
    }),
    prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "FILING_BATCH" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "PRE_ARN" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
const registrations = references
      .filter((r) => r.kind === "REGISTRATION")
      .map((r) => ({ id: r.id, name: r.name })),
    assetOptions = assets.map((a) => ({ id: a.fileId, name: a.file.filename }));
return viewDto({ workspaceSlug, actor, profile, references, series, assets, filingRows, preArnRows, registrations, assetOptions } as const);
}
