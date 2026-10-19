import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { templateWhere } from "@/lib/templates/service";
import { templateAction } from "@/app/actions/templates";
import {
  collaborationChoices,
  optionalChoice,
  options,
} from "@/lib/meetings/choices";
import { admin, jsonObject } from "@/lib/meetings/core";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Templates" };
export default async function TemplatesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/templates">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const [templates, choices] = await Promise.all([
    prisma.template.findMany({
      where: await templateWhere(actor),
      orderBy: { name: "asc" },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Templates"
      description="Keep a useful starting point for documents, projects, tasks and meetings."
    >
      <Disclosure title="Create a template" open={!templates.length}>
        <ActionForm
          slug={workspaceSlug}
          action={templateAction}
          hidden={{ op: "create" }}
          label="Save template"
          primary
          reset
          fields={[
            { name: "name", label: "Template name", required: true },
            {
              name: "kind",
              label: "For",
              type: "select",
              options: options(["DOC", "PROJECT", "TASK", "MEETING"]),
              required: true,
            },
            { name: "description", label: "When to use it", type: "textarea" },
            { name: "title", label: "Starting title", required: true },
            {
              name: "text",
              label: "Starting content",
              type: "textarea",
              help: "Use {{date}}, {{author}} and {{workspace}}. For meetings, put one agenda topic on each line.",
            },
            {
              name: "scope",
              label: "Who can use it",
              type: "select",
              options: options(["WORKSPACE", "TEAM", "PRIVATE"]),
            },
            {
              name: "teamId",
              label: "Team",
              type: "select",
              options: [optionalChoice(), ...choices.teams],
            },
          ]}
        />
      </Disclosure>
      {templates.map((t) => (
        <Section key={t.id} title={t.name}>
          <div className="flex gap-2">
            <Chip>{t.kind.toLowerCase()}</Chip>
            <Chip>{t.scope.toLowerCase()}</Chip>
          </div>
          <TextBody>{t.description}</TextBody>
          <details>
            <summary className="min-h-11 cursor-pointer text-accent-text">
              Preview template
            </summary>
            <h3 className="text-title">
              {String(jsonObject(t.content).title ?? "")}
            </h3>
            <TextBody>{String(jsonObject(t.content).text ?? "")}</TextBody>
          </details>
          {t.kind === "MEETING" ? (
            <a
              className="inline-flex min-h-11 items-center text-accent-text underline"
              href={`/w/${workspaceSlug}/meetings`}
            >
              Use when scheduling a meeting
            </a>
          ) : t.scope === "WORKSPACE" && !t.teamId ? (
            <ActionForm
              slug={workspaceSlug}
              action={templateAction}
              hidden={{ op: "apply", templateId: t.id }}
              label={`Create ${t.kind === "DOC" ? "document" : t.kind.toLowerCase()} from template`}
              fields={
                t.kind === "PROJECT"
                  ? [{ name: "key", label: "New project key", required: true }]
                  : t.kind === "TASK"
                    ? [
                        {
                          name: "projectId",
                          label: "Project",
                          type: "select",
                          options: [
                            optionalChoice("No project"),
                            ...choices.projects.map((p) => ({
                              value: p.id,
                              label: p.name,
                            })),
                          ],
                        },
                      ]
                    : []
              }
            />
          ) : (
            <p className="text-caption text-ink-muted">
              Restricted templates can be previewed here. Use a workspace
              template to create shared work.
            </p>
          )}
          {admin(actor) || t.createdById === actor.user.id ? (
            <>
              <details>
                <summary className="min-h-11 cursor-pointer text-accent-text">
                  Edit template
                </summary>
                <ActionForm
                  slug={workspaceSlug}
                  action={templateAction}
                  hidden={{ op: "edit", templateId: t.id }}
                  label="Save template"
                  fields={[
                    {
                      name: "name",
                      label: "Template name",
                      value: t.name,
                      required: true,
                    },
                    {
                      name: "description",
                      label: "When to use it",
                      type: "textarea",
                      value: t.description ?? "",
                    },
                    {
                      name: "title",
                      label: "Starting title",
                      value: String(jsonObject(t.content).title ?? ""),
                      required: true,
                    },
                    {
                      name: "text",
                      label: "Starting content",
                      type: "textarea",
                      value: String(jsonObject(t.content).text ?? ""),
                    },
                  ]}
                />
              </details>
              <ActionForm
                slug={workspaceSlug}
                action={templateAction}
                hidden={{ op: "delete", templateId: t.id }}
                label="Delete template…"
                destructive
                confirm="Delete this template? Existing work will stay available."
              />
            </>
          ) : null}
        </Section>
      ))}
    </CollaborationShell>
  );
}
