"use client";

import { Form } from "./SecretForm";
import { roleLabels } from "./secretRoleLabels";
import { CheckboxCard } from "@/components/ui/choice";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import { ROLES } from "@/lib/secrets/values";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderAccessSection(state: SecretsSectionState) {
  const {
    view,
    section,
    busy,
    env,
    project,
    environmentId,
    admin,
    memberName,
    act,
  } = state;
  return (
    section === "Access" && admin ? (
      <>
        <Card>
          <h2 className="mb-4 text-h3">Member access</h2>
          <p className="mb-4 text-body-ui">
            Production ignores project grants. Give explicit production
            access only to the people who need it. Workspace admins retain
            administrative access.
          </p>
          <Form
            onSave={async (v) =>
              act("grant", {
                projectId: project.id,
                environmentId: v.scope,
                userId: v.userId,
                role: v.role,
              })
            }
          >
            <Field label="Member">
              <Dropdown name="userId">
                {view.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name ?? m.user.email}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Scope">
              <Dropdown name="scope">
                <option value={environmentId}>This environment</option>
                {view.canManage ? (
                  <option value="">Project (non-production)</option>
                ) : null}
              </Dropdown>
            </Field>
            <Field label="Permission">
              <Dropdown name="role">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Button variant="primary" type="submit" disabled={busy}>Save access</Button>
          </Form>
        </Card>
        {view.grants.map((g) => (
          <p key={g.id}>
            {memberName(g.userId)} ·{" "}
            {g.environmentId ? env.name : "Project"} ·{" "}
            {g.role.toLowerCase()}
          </p>
        ))}
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="min-h-11 cursor-pointer">
            Edit this environment
          </summary>
          <Form
            onSave={async (v) =>
              act("environment", {
                id: env.id,
                projectId: project.id,
                name: v.name,
                slug: v.slug,
                position: Number(v.position),
                production: env.production || v.production === "on",
                protected: v.protected === "on",
              })
            }
          >
            <Field label="Name">
              <Input name="name" defaultValue={env.name} required />
            </Field>
            <Field
              label="Slug"
              helperText="Changing the slug can break secret references."
            >
              <Input
                name="slug"
                defaultValue={env.slug}
                required
                pattern="[a-z][a-z0-9_-]*"
              />
            </Field>
            <Field label="Order">
              <Input
                name="position"
                type="number"
                min={0}
                max={1000}
                defaultValue={env.position}
              />
            </Field>
            <CheckboxCard
              label="Production environment"
              name="production"
              defaultChecked={env.production}
              disabled={env.production}
            />
            <CheckboxCard
              label="Require change approval"
              name="protected"
              defaultChecked={env.protected}
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              Save environment
            </Button>
          </Form>
        </details>
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="min-h-11 cursor-pointer">
            Add an environment
          </summary>
          <Form
            onSave={async (v) =>
              act("environment", {
                projectId: project.id,
                name: v.name,
                slug: v.slug,
                position: project.environments.length,
                production: v.production === "on",
                protected: v.protected === "on",
              })
            }
          >
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Slug">
              <Input name="slug" required pattern="[a-z][a-z0-9_-]*" />
            </Field>
            <CheckboxCard
              label="Production environment"
              name="production"
            />
            <CheckboxCard
              label="Require change approval"
              name="protected"
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              Add environment
            </Button>
          </Form>
        </details>
      </>
    ) : null
  );
}
