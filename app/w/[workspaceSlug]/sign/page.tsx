import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { admin } from "@/lib/meetings/core";
import { collaborationChoices } from "@/lib/meetings/choices";
import { visibleDocsWhere } from "@/lib/docs/service";
import { signatureAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { Chip, EmptyState } from "@/components/ui/display";
export const metadata = { title: "Document acknowledgements" };
export default async function SignaturesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/sign">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const [requests, choices] = await Promise.all([
    prisma.signatureRequest.findMany({
      where: {
        workspaceId: actor.workspace.id,
        ...(admin(actor)
          ? {}
          : {
              OR: [
                { signerUserId: actor.user.id },
                { createdById: actor.user.id },
              ],
            }),
        doc: {
          ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
          archivedAt: null,
        },
      },
      select: {
        id: true,
        status: true,
        signerUserId: true,
        doc: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Document acknowledgements"
      description="Request a named acknowledgement of a fixed document version. This records consent inside Space Works; it is not a qualified electronic signature."
    >
      {canContribute(actor.membership) && choices.docs.length ? (
        <Disclosure title="Request an acknowledgement" open={!requests.length}>
          <ActionForm
            slug={workspaceSlug}
            action={signatureAction}
            hidden={{ op: "request" }}
            label="Request acknowledgement"
            primary
            navigateTo={`/w/${workspaceSlug}/sign/`}
            fields={[
              {
                name: "docId",
                label: "Document",
                type: "select",
                options: choices.docs.map((d) => ({
                  value: d.id,
                  label: d.title,
                })),
                required: true,
              },
              {
                name: "signerUserId",
                label: "Ask this member",
                type: "select",
                options: choices.members,
                required: true,
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {!requests.length ? (
        <EmptyState
          title="No acknowledgements yet. Request one for a shared document."
          action={
            <a
              className="text-accent-text underline"
              href={`/w/${workspaceSlug}/docs`}
            >
              Open documents
            </a>
          }
        />
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <EntryLink
              key={r.id}
              href={`/w/${workspaceSlug}/sign/${r.id}`}
              title={r.doc.title}
              meta={
                <>
                  <Chip>{r.status.toLowerCase()}</Chip>
                  <span>
                    {choices.members.find((m) => m.value === r.signerUserId)
                      ?.label ?? "Former member"}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </CollaborationShell>
  );
}
