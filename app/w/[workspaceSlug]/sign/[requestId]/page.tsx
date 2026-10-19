import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { signatureView } from "@/lib/signatures/service";
import { admin } from "@/lib/meetings/core";
import { sanitizeDocHtml } from "@/lib/docs/sanitize";
import { formatDayTime } from "@/lib/format/datetime";
import { signatureAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import { CollaborationShell, Section } from "@/components/meetings/Structure";
import { Callout, Chip } from "@/components/ui/display";
export const metadata = { title: "Acknowledge a document" };
export default async function SignaturePage({
  params,
}: PageProps<"/w/[workspaceSlug]/sign/[requestId]">) {
  const { workspaceSlug, requestId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const request = await signatureView(actor, requestId);
  if (!request) notFound();
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={request.title}
      description="Review this saved version before acknowledging it. Your name, timestamp and a hash of your IP address will be recorded."
    >
      <Chip>{request.status.toLowerCase()}</Chip>
      {!request.currentMatches && request.status === "PENDING" ? (
        <Callout tone="warning" title="The document changed.">
          Ask for a new request before acknowledging the current version.
        </Callout>
      ) : null}
      <Section title="Saved document version">
        <div
          className="yy-prose max-w-full overflow-x-auto break-words"
          dangerouslySetInnerHTML={{ __html: sanitizeDocHtml(request.html) }}
        />
        <p className="break-all text-caption text-ink-muted">
          Content fingerprint: {request.contentHash}
        </p>
        <a
          className="inline-flex min-h-11 items-center text-accent-text underline"
          href={`/w/${workspaceSlug}/docs/${request.docId}`}
        >
          Open current document
        </a>
      </Section>
      {request.status === "SIGNED" ? (
        <Section title="Acknowledgement recorded">
          <p>
            {request.typedName} ·{" "}
            {request.signedAt
              ? formatDayTime(request.signedAt, actor.workspace.timezone)
              : ""}
          </p>
        </Section>
      ) : request.status === "PENDING" &&
        request.currentMatches &&
        request.signerUserId === actor.user.id ? (
        <>
          <Section title="Your acknowledgement">
            <ActionForm
              slug={workspaceSlug}
              action={signatureAction}
              hidden={{ op: "sign", requestId }}
              label="Acknowledge document"
              primary
              fields={[
                { name: "typedName", label: "Your full name", required: true },
                {
                  name: "acknowledge",
                  label:
                    "I have read this saved document version and acknowledge it.",
                  type: "checkbox",
                  required: true,
                },
              ]}
            />
          </Section>
          <ActionForm
            slug={workspaceSlug}
            action={signatureAction}
            hidden={{ op: "decline", requestId }}
            label="Decline request…"
            destructive
            confirm="Decline this acknowledgement request?"
          />
        </>
      ) : null}
      {request.status === "PENDING" &&
      (admin(actor) || request.createdById === actor.user.id) ? (
        <ActionForm
          slug={workspaceSlug}
          action={signatureAction}
          hidden={{ op: "remind", requestId }}
          label="Send reminder"
        />
      ) : null}
    </CollaborationShell>
  );
}
