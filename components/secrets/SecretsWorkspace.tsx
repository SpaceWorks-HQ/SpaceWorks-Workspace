"use client";

import { Form } from "./SecretForm";
import { IdentitySettings } from "./IdentitySettings";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { ListLayout } from "@/components/ui/layouts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useSecretsWorkspace, type SecretsWorkspaceProps } from "./useSecretsWorkspace";
import { renderKeysSection } from "./KeysSection";
import { renderCompareSection } from "./CompareSection";
import { renderHistorySection } from "./HistorySection";
import { renderImportExportSection } from "./ImportExportSection";
import { renderAccessSection } from "./AccessSection";
import { renderEncryptionSection } from "./EncryptionSection";
import { renderServiceTokensSection } from "./ServiceTokensSection";
import { renderSharingSection } from "./SharingSection";
import { renderSecuritySection } from "./SecuritySection";
import { renderAuditSection } from "./AuditSection";
import { roleLabels } from "./secretRoleLabels";

const sections = [
  "Keys",
  "Compare",
  "History",
  "Import and export",
  "Access",
  "Machine identities",
  "Encryption",
  "Service tokens",
  "Sharing",
  "Security",
  "Audit",
];
export function SecretsWorkspace(props: SecretsWorkspaceProps) {
  const state = useSecretsWorkspace(props);
  const {
    view,
    section,
    changeSection,
    message,
    error,
    busy,
    confirm,
    setConfirm,
    env,
    project,
    environmentId,
    path,
    admin,
    act,
    navigate,
  } = state;
  return (
    <ListLayout header={
      <PageHeader title="Secrets" description="Application keys for your team's projects and environments." />
    }>
      <p className="text-caption text-ink-muted">
        Values stay hidden until you reveal them. Production reveals and every
        member export need a fresh two-step code.
      </p>
      <div aria-live="polite" role="status">
        {busy ? (
          <p>Working</p>
        ) : message ? (
          <p className="text-success-fg">{message}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      ) : null}
      {!view.projects.length ? (
        <EmptyState
          patch
          title="No secret projects yet. Start one for your next deployment."
          action={
            view.canManage ? (
              <Button asChild>
                <a href="#create-project">Create a project</a>
              </Button>
            ) : (
              <p>Ask a workspace admin for access.</p>
            )
          }
        />
      ) : (
        <Card className="grid gap-4 sm:grid-cols-3">
          <Field label="Project">
            <Dropdown
              value={project?.id ?? ""}
              onChange={(e) => navigate(e.target.value)}
            >
              {view.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Environment">
            <Dropdown
              value={environmentId}
              onChange={(e) => navigate(project!.id, e.target.value)}
            >
              {project?.environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.production ? " · Production" : ""}
                </option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Folder">
            <Dropdown
              value={path}
              onChange={(e) =>
                navigate(project!.id, environmentId, e.target.value)
              }
            >
              {[
                ...new Set(["/", ...view.folders.map((f) => f.path), path]),
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Dropdown>
          </Field>
        </Card>
      )}
      {env && project ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Chip>{roleLabels[env.accessRole]} access</Chip>
            {env.protected ? (
              <Chip tone="warning">Approval required</Chip>
            ) : null}
            <span className="break-all text-caption text-ink-muted">
              Project ID: {project.id}
            </span>
          </div>
          <details className="rounded-xl border border-line bg-panel p-4">
            <summary className="min-h-11 cursor-pointer text-label">
              Verify two-step code
            </summary>
            <Form
              onSave={async (v, form) => {
                await act("mfa", { code: v.code }, false);
                form.reset();
              }}
            >
              <Field label="Authenticator code">
                <Input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={busy}>
                Verify code
              </Button>
            </Form>
            <a className="inline-flex min-h-11 items-center text-accent-text underline" href="/account">
              Manage two-step verification
            </a>
          </details>
          <Tabs value={section} onValueChange={changeSection}>
            <TabsList aria-label="Secrets sections">
              {sections.filter(s =>
                (!["Access", "Machine identities", "Encryption", "Service tokens", "Security", "Audit"].includes(s) || admin) &&
                (!["Machine identities", "Encryption"].includes(s) || view.canManage)
              ).map(s => <TabsTrigger key={s} value={s}>{s}</TabsTrigger>)}
            </TabsList>
            <TabsContent value={section} className="space-y-6">
              {renderKeysSection({ ...state, env, project })}
              {renderCompareSection({ ...state, env, project })}
              {renderHistorySection({ ...state, env, project })}
              {renderImportExportSection({ ...state, env, project })}
              {renderAccessSection({ ...state, env, project })}
              {section === "Machine identities" && admin ? <IdentitySettings view={view} act={act} busy={busy} /> : null}
              {renderEncryptionSection({ ...state, env, project })}
              {renderServiceTokensSection({ ...state, env, project })}
              {renderSharingSection({ ...state, env, project })}
              {renderSecuritySection({ ...state, env, project })}
              {renderAuditSection({ ...state, env, project })}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
      {view.canManage ? (
        <details
          id="create-project"
          className="rounded-xl border border-line bg-panel p-5"
          open={!view.projects.length}
        >
          <summary className="min-h-11 cursor-pointer text-title">
            Create a secret project
          </summary>
          <Form
            onSave={async (v, form) => {
              const id = await act("project", { name: v.name, slug: v.slug });
              if (typeof id === "string") {
                form.reset();
                navigate(id);
              }
            }}
          >
            <Field label="Project name">
              <Input name="name" required maxLength={100} />
            </Field>
            <Field label="Project slug">
              <Input
                name="slug"
                required
                pattern="[a-z][a-z0-9_-]*"
                maxLength={50}
              />
            </Field>
            <Button variant={view.projects.length ? "secondary" : "primary"} type="submit" disabled={busy}>Create project</Button>
          </Form>
        </details>
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? "Confirm change"}
        message={
          env?.protected &&
          ["change", "rollback", "restore"].includes(confirm?.operation ?? "")
            ? "This will submit a change request for independent approval."
            : "This change will be recorded in history."
        }
        confirmLabel="Confirm change"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            const result = await act(confirm.operation, confirm.input);
            if (result) setConfirm(null);
          }
        }}
      />
    </ListLayout>
  );
}
