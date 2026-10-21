"use client";
import { IdentitySettings } from "./IdentitySettings";
import { Eye, EyeOff, Copy } from "lucide-react";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { secretsAction } from "@/app/actions/secrets";
import { CheckboxCard } from "@/components/ui/choice";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { zonedInputToIso } from "@/lib/timeZone";
import { formatDayTime, formatDate } from "@/lib/format/datetime";
import type {
  SecretsView,
  VersionRow,
  Preview,
  SnapshotDiff,
} from "@/lib/secrets/types";
import { lineDiff } from "@/lib/secrets/diff";
import { ROLES } from "@/lib/secrets/values";
const roleLabels = {
  NONE: "No access",
  KEYS: "Read key names",
  READ: "Read values",
  WRITE: "Write",
  ADMIN: "Admin",
};
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
function data(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form));
}
function Form({
  children,
  onSave,
}: {
  children: ReactNode;
  onSave: (
    values: Record<string, FormDataEntryValue>,
    form: HTMLFormElement,
  ) => Promise<unknown>;
}) {
  const [formError, setFormError] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setFormError("");
        void onSave(data(form), form).catch(() =>
          setFormError("Couldn't complete the action. Try again."),
        );
      }}
    >
      {children}
      {formError ? (
        <p role="alert" className="text-danger-fg">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
export function SecretsWorkspace({
  view,
  slug,
  timezone,
  initialSection = "Keys",
}: {
  view: SecretsView;
  slug: string;
  timezone: string;
  initialSection?: "Keys" | "History";
}) {
  const router = useRouter(),
    [section, setSection] = useState<string>(initialSection),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(""),
    [auditFrom, setAuditFrom] = useState(""),
    [auditUntil, setAuditUntil] = useState("");
  const revealEpoch = useRef(0);
  const [editorVisible, setEditorVisible] = useState(false);
  const [versionDiff, setVersionDiff] = useState<{ before: string; after: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({}),
    [issued, setIssued] = useState(""),
    [shareLink, setShareLink] = useState("");
  const [source, setSource] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [diff, setDiff] = useState<SnapshotDiff>([]);
  const [history, setHistory] = useState<{
    id: string;
    key: string;
    versions: VersionRow[];
    hasMore: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    key: string;
    value: string;
    loaded: boolean;
    comment: string;
    tags: string;
    ownerId: string;
    rotateEveryDays: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    operation: string;
    input: Record<string, unknown>;
  } | null>(null);
  const env = view.environment,
    project = view.project,
    environmentId = env?.id ?? "",
    path = view.path;
  const writable = !!env && ["WRITE", "ADMIN"].includes(env.accessRole),
    readable = !!env && ["READ", "WRITE", "ADMIN"].includes(env.accessRole),
    admin = env?.accessRole === "ADMIN";
  const auditStart = auditFrom
    ? zonedInputToIso(auditFrom + "T00:00", timezone)
    : null;
  const auditEnd = auditUntil
    ? zonedInputToIso(auditUntil + "T23:59", timezone)
    : null;
  const memberName = (id: string | null) => {
    if (!id) return "System or machine identity";
    if (id.startsWith("machine:")) return "Machine " + id.slice(8);
    const member = view.members.find(m => m.userId === id);
    return member ? member.user.name ?? member.user.email : "Former member";
  };
  useEffect(() => {
    const hide = () => {
      revealEpoch.current++;
      setRevealed({});
      setVersionDiff(null);
      setEditorVisible(false);
      setIssued("");
      setShareLink("");
      setEditing(current => current ? { ...current, value: "", loaded: false } : null);
    };
    const timer = setInterval(hide, 60000);
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("blur", hide);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    const epoch = revealEpoch;
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener("blur", hide);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const rotationPending = ["PENDING", "RUNNING"].includes(view.encryption?.lastJob?.status ?? "");
  useEffect(() => {
    if (!rotationPending) return;
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [rotationPending, router]);
  async function act(
    operation: string,
    input: Record<string, unknown> = {},
    refresh = true,
  ): Promise<unknown> {
    setError("");
    setMessage("");
    setBusy(true);
    const epoch = revealEpoch.current;
    try {
      const result = await secretsAction(slug, operation, {
        environmentId,
        ...input,
      });
      if (!result.ok) {
        setError(result.error);
        return undefined;
      }
      const pending =
        result.data &&
        typeof result.data === "object" &&
        "pending" in result.data &&
        result.data.pending;
      setMessage(
        pending
          ? "Change submitted for approval."
          : operation === "mfa"
            ? "Verified for five minutes."
            : "Done.",
      );
      if (refresh) router.refresh();
      if (["token", "share", "identity-credential"].includes(operation) && epoch !== revealEpoch.current) return undefined;
      return result.data ?? true;
    } catch {
      setError("Couldn't complete the action. Try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function valueRequest(
    input: Record<string, unknown>,
    download?: string,
  ) {
    setError("");
    setBusy(true);
    const epoch = revealEpoch.current;
    try {
      const response = await fetch(
        `/api/w/${encodeURIComponent(slug)}/secrets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environmentId, path, ...input }),
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Couldn't read this key.");
      }
      if (download) {
        const blob = await response.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = download;
        a.click();
        URL.revokeObjectURL(url);
        setMessage("Downloaded. Keep this file private.");
        return;
      }
      const result = await response.json();
      return epoch === revealEpoch.current && !document.hidden ? result : undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this key.");
    } finally {
      setBusy(false);
    }
  }
  async function reveal(key: string, cellEnvironmentId = environmentId) {
    const id = cellEnvironmentId === environmentId ? key : cellEnvironmentId + ":" + key;
    if (Object.hasOwn(revealed, id)) { setRevealed(r => { const next = { ...r }; delete next[id]; return next; }); return; }
    const result = await valueRequest({ key, environmentId: cellEnvironmentId, operation: "reveal" });
    if (result) setRevealed(r => ({ ...r, [id]: result.values[key] }));
  }
  async function copy(key: string) {
    const result = await valueRequest({ key, operation: "copy" });
    if (!result) return;
    const value = String(result.values[key]);
    try {
      await navigator.clipboard.writeText(value); setMessage("Copied. Clipboard clears after 30 seconds where supported.");
      setTimeout(() => { void navigator.clipboard.readText().then(current => current === value ? navigator.clipboard.writeText("") : undefined).catch(() => undefined); }, 30000);
    } catch { setError("Clipboard access is unavailable. Reveal and copy the value manually."); }
  }
  function edit(row: SecretsView["rows"][number]) {
    setEditorVisible(false);
    setEditing({ id: row.id, key: row.key, value: "", loaded: false, comment: row.comment, tags: row.tags.join(", "), ownerId: row.ownerId, rotateEveryDays: row.rotateEveryDays?.toString() ?? "" });
  }
  async function toggleEditor() {
    if (editing && !editing.loaded) {
      const id = editing.id;
      const result = await valueRequest({ key: editing.key, operation: "raw" });
      if (!result) return;
      setEditing(current => current?.id === id ? { ...current, value: result.values[editing.key], loaded: true } : current);
      setEditorVisible(true);
    } else setEditorVisible(visible => !visible);
  }
  function navigate(
    projectId: string,
    environment?: string,
    folder = "/",
    snapshotCursor?: string,
    keysCursor?: string,
  ) {
    revealEpoch.current++;
    setRevealed({});
    setVersionDiff(null);
    setEditing(null);
    setPreview(null);
    setSource("");
    setHistory(null);
    setDiff([]);
    router.push(
      `/w/${slug}/secrets?` +
        new URLSearchParams({
          project: projectId,
          ...(environment ? { environment } : {}),
          path: folder,
          ...(section === "History" ? { section: "history" } : {}),
          ...(snapshotCursor ? { snapshotCursor } : {}),
          ...(keysCursor ? { keysCursor } : {}),
        }),
    );
  }
  function table(headers: string[], body: ReactNode) {
    return (
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-body-ui">
          <thead className="bg-surface text-accent-text">
            <tr>
              {headers.map((h) => (
                <th key={h} className="p-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{body}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Secrets"
        description="Application keys for your team's projects and environments."
      />
      <p className="text-caption text-ink-muted">
        Values stay hidden until you reveal them. Production reveals and every
        member export need a fresh two-step code.
      </p>
      <div aria-live="polite" role="status">
        {busy ? (
          <p>Working…</p>
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
            <a className="text-accent-text underline" href="/account">
              Manage two-step verification
            </a>
          </details>
          <nav
            aria-label="Secrets sections"
            className="flex max-w-full gap-2 overflow-x-auto border-b border-line"
          >
            {sections
              .filter(
                (s) =>
                  (!["Access", "Machine identities", "Encryption", "Service tokens", "Security", "Audit"].includes(s) || admin) && (!["Machine identities", "Encryption"].includes(s) || view.canManage),
              )
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-current={section === s ? "page" : undefined}
                  onClick={() => {
                    revealEpoch.current++; setRevealed({}); setEditing(null); setVersionDiff(null);
                    setSection(s);
                    setFilter("");
                  }}
                  className={`min-h-11 shrink-0 border-b-2 px-3 text-label ${section === s ? "border-accent text-ink" : "border-transparent text-ink-muted"}`}
                >
                  {s}
                </button>
              ))}
          </nav>
          {section === "Keys" ? (
            <>
              <Field label="Filter keys, tags or owner">
                <Input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </Field>
              {readable ? <Button variant="secondary" disabled={busy} aria-pressed={Object.keys(revealed).length > 0} onClick={async () => {
                if (Object.keys(revealed).length) { setRevealed({}); return; }
                const epoch = revealEpoch.current;
                const keys = view.rows.filter(r => !r.deletedAt && `${r.key} ${r.tags.join(" ")} ${memberName(r.ownerId)}`.toLowerCase().includes(filter.toLowerCase())).map(r => r.key);
                for (let offset = 0; offset < keys.length; offset += 500) {
                  if (epoch !== revealEpoch.current) break;
                  const result = await valueRequest({ operation: "reveal-view", keys: keys.slice(offset, offset + 500) });
                  if (!result) break;
                  setRevealed(r => ({ ...r, ...result.values }));
                }
              }}>{Object.keys(revealed).length ? "Hide values" : "Reveal values"}</Button> : null}
              {!view.rows.length ? (
                <EmptyState
                  patch
                  title="No keys in this folder yet. Add one for the application."
                  action={
                    writable ? (
                      <Button asChild>
                        <a href="#secret-editor">Add a key</a>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="grid gap-3">
                  {view.rows
                    .filter((r) =>
                      `${r.key} ${r.tags.join(" ")} ${memberName(r.ownerId)}`
                        .toLowerCase()
                        .includes(filter.toLowerCase()),
                    )
                    .map((row) => (
                      <Card key={row.id}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="break-all font-mono text-title">
                            {row.key}{" "}
                            {row.deletedAt ? <Chip>Deleted</Chip> : null}
                          </h2>
                          <div className="flex flex-wrap gap-2">
                            {readable && !row.deletedAt ? (
                              <>
                                <Button
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => void reveal(row.key)}
                                >
                                  {Object.hasOwn(revealed, row.key) ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
                                  {Object.hasOwn(revealed, row.key) ? "Hide" : "Reveal"}
                                </Button>
                                <Button variant="quiet" disabled={busy} onClick={() => void copy(row.key)} aria-label={`Copy ${row.key}`}><Copy aria-hidden size={18} />Copy</Button>
                                {writable ? (
                                  <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() => void edit(row)}
                                  >
                                    Edit
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                            <Button
                              variant="quiet"
                              disabled={busy}
                              onClick={async () => {
                                const versions = await act(
                                  "history",
                                  { secretId: row.id },
                                  false,
                                );
                                if (versions)
                                  setHistory({
                                    id: row.id,
                                    key: row.key,
                                    versions: versions as VersionRow[],
                                    hasMore:
                                      (versions as VersionRow[]).length === 200,
                                  });
                              }}
                            >
                              History
                            </Button>
                            {writable && !row.deletedAt ? (
                              <Button
                                variant="dangerQuiet"
                                onClick={() =>
                                  setConfirm({
                                    title: `Delete ${row.key}?`,
                                    operation: "change",
                                    input: {
                                      changes: [
                                        { key: row.key, path, delete: true },
                                      ],
                                    },
                                  })
                                }
                              >
                                Delete…
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {Object.hasOwn(revealed, row.key) ? (
                          <div className="mt-3">
                            <pre className="whitespace-pre-wrap break-all font-mono">
                              {revealed[row.key]}
                            </pre>
                            <Button
                              variant="quiet"
                              onClick={() =>
                                setRevealed((r) => {
                                  const next = { ...r };
                                  delete next[row.key];
                                  return next;
                                })
                              }
                            >
                              Hide value
                            </Button>
                          </div>
                        ) : (
                          <p
                            className="font-mono text-ink-muted"
                            aria-label="Value hidden"
                          >
                            ••••••••
                          </p>
                        )}
                        <p className="mt-2 break-words text-body-ui">
                          {row.comment}
                        </p>
                        <p className="text-caption text-ink-muted">
                          {memberName(row.ownerId)} ·{" "}
                          {row.tags.join(", ") || "No tags"} · Updated{" "}
                          {formatDate(row.updatedAt, timezone)}
                          {row.rotateEveryDays
                            ? ` · Rotate every ${row.rotateEveryDays} days`
                            : ""}
                        </p>
                      </Card>
                    ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {view.keysCursor ? (
                  <Button variant="secondary" onClick={() => navigate(project.id, environmentId, path)}>
                    First keys
                  </Button>
                ) : null}
                {view.nextKeysCursor ? (
                  <Button variant="secondary" onClick={() => navigate(project.id, environmentId, path, undefined, view.nextKeysCursor)}>
                    Show more
                  </Button>
                ) : null}
              </div>
              {history ? (
                <Card>
                  <h2 className="text-title">{history.key} history</h2>
                  <p className="my-3 font-mono" aria-label="Version values hidden">{versionDiff ? "Versions revealed" : "••••••••"}</p>
                  <Form onSave={async v => {
                    const before = await valueRequest({ operation: "version", secretId: history.id, versionId: v.before });
                    const after = await valueRequest({ operation: "version", secretId: history.id, versionId: v.after });
                    if (before && after) setVersionDiff({ before: before.value, after: after.value });
                  }}><Field label="Earlier version"><Dropdown name="before">{history.versions.map(v => <option key={v.id} value={v.id}>{formatDayTime(v.createdAt, timezone)}</option>)}</Dropdown></Field><Field label="Later version"><Dropdown name="after">{history.versions.map(v => <option key={v.id} value={v.id}>{formatDayTime(v.createdAt, timezone)}</option>)}</Dropdown></Field><Button type="submit" variant="secondary" disabled={busy || history.versions.length < 2}>Reveal version diff</Button></Form>
                  {versionDiff ? <div className="my-4"><pre className="whitespace-pre-wrap break-all font-mono">{lineDiff(versionDiff.before, versionDiff.after).map(l => `${l.kind === "add" ? "+" : l.kind === "remove" ? "−" : " "} ${l.text}`).join("\n")}</pre><Button variant="quiet" onClick={() => setVersionDiff(null)}>Hide diff</Button></div> : null}
                  {history.versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3"
                    >
                      <span>
                        {formatDayTime(v.createdAt, timezone)} ·{" "}
                        {memberName(v.createdById)} ·{" "}
                        {v.deleted ? "Deleted" : "Saved"}
                      </span>
                      <div className="flex gap-2">
                        {readable ? (
                          <Button
                            variant="quiet"
                            onClick={async () => {
                              const result = await valueRequest({
                                operation: "version",
                                secretId: history.id,
                                versionId: v.id,
                              });
                              if (result)
                                setRevealed((r) => ({
                                  ...r,
                                  [history.key]: result.value,
                                }));
                            }}
                          >
                            Reveal version
                          </Button>
                        ) : null}
                        {writable ? (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setConfirm({
                                title: "Restore this version?",
                                operation: "restore",
                                input: {
                                  secretId: history.id,
                                  versionId: v.id,
                                },
                              })
                            }
                          >
                            Restore…
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {history.hasMore ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        const result = await act(
                          "history",
                          {
                            secretId: history.id,
                            cursor: history.versions.at(-1)?.id,
                          },
                          false,
                        );
                        if (Array.isArray(result)) {
                          const batch = result as VersionRow[];
                          setHistory((h) =>
                            h
                              ? {
                                  ...h,
                                  versions: [...h.versions, ...batch],
                                  hasMore: batch.length === 200,
                                }
                              : h,
                          );
                        }
                      }}
                    >
                      Older versions
                    </Button>
                  ) : null}
                </Card>
              ) : null}
              {writable ? (
                <Card id="secret-editor">
                  <h2 className="mb-4 text-h3">
                    {editing ? `Edit ${editing.key}` : "Add a key"}
                  </h2>
                  <Form
                    key={editing?.id ?? "new"}
                    onSave={async (v, form) => {
                      if (editing && !editing.loaded) { setError("Reveal the current value before editing it."); return; }
                      const result = await act("change", {
                        changes: [
                          {
                            key: v.key,
                            value: v.value,
                            path,
                            comment: v.comment,
                            tags: String(v.tags)
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                            ownerId: v.ownerId,
                            rotateEveryDays: v.rotateEveryDays
                              ? Number(v.rotateEveryDays)
                              : null,
                          },
                        ],
                      });
                      if (result) {
                        form.reset();
                        setEditing(null);
                      }
                    }}
                  >
                    <Field label="Key">
                      <Input
                        name="key"
                        pattern="[A-Z_][A-Z0-9_]*"
                        maxLength={128}
                        required
                        defaultValue={editing?.key}
                        readOnly={!!editing}
                        autoComplete="off"
                      />
                    </Field>
                    {!editorVisible ? <p className="font-mono" aria-label="Editor value hidden">••••••••</p> : null}
                    <Button type="button" variant="quiet" aria-pressed={editorVisible} disabled={busy} onClick={() => void toggleEditor()}>{editorVisible ? "Hide editor value" : "Show editor value"}</Button>
                    <Field
                      label="Value"
                      helperText={
                        "References: ${KEY} or ${production.api.KEY}. Reference access is checked on every read."
                      }
                    >
                      <Textarea
                        key={editing ? `${editing.id}:${editing.loaded}` : "new"}
                        name="value"
                        className="font-mono"
                        maxLength={20000}
                        defaultValue={editing?.value}
                        hidden={!editorVisible}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="Comment"
                      optional
                      helperText="Keep credentials in the Value field."
                    >
                      <Textarea
                        name="comment"
                        maxLength={2000}
                        defaultValue={editing?.comment}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tags" optional>
                        <Input
                          name="tags"
                          defaultValue={editing?.tags}
                          placeholder="api, website"
                        />
                      </Field>
                      <Field label="Rotation interval in days" optional>
                        <Input
                          type="number"
                          name="rotateEveryDays"
                          min={1}
                          max={3650}
                          defaultValue={editing?.rotateEveryDays}
                        />
                      </Field>
                    </div>
                    <Field label="Owner">
                      <Dropdown
                        name="ownerId"
                        defaultValue={
                          editing?.ownerId ?? view.members[0]?.userId
                        }
                      >
                        {view.members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.user.name ?? m.user.email}
                          </option>
                        ))}
                      </Dropdown>
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="primary" type="submit" disabled={busy || (editing !== null && !editing.loaded)}>
                        {env.protected ? "Request change" : "Save key"}
                      </Button>
                      {editing ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditing(null)}
                        >
                          Cancel edit
                        </Button>
                      ) : null}
                    </div>
                  </Form>
                </Card>
              ) : null}
              {writable ? (
                <details className="rounded-xl border border-line p-4">
                  <summary className="min-h-11 cursor-pointer">
                    Add a folder
                  </summary>
                  <Form onSave={async (v) => act("folder", { path: v.path })}>
                    <Field label="Folder path">
                      <Input name="path" defaultValue="/api" required />
                    </Field>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Create folder
                    </Button>
                  </Form>
                </details>
              ) : null}
            </>
          ) : null}
          {section === "Compare" ? (
            <>
              <h2 className="text-h3">Keys across environments</h2>
              <p className="text-body-ui text-ink-muted">
                Only environments you can list appear here. Missing keys can
                prevent deployments.
              </p>
              {table(
                ["Key", ...project.environments.map((e) => e.name)],
                view.comparison.map((r) => (
                  <tr key={r.key}>
                    <th className="p-3 font-mono">{r.key}</th>
                    {project.environments.map((e) => (
                      <td key={e.id} className="p-3">
                        {r.environmentIds.includes(e.id) && ["READ", "WRITE", "ADMIN"].includes(e.accessRole) ? <div className="grid gap-2"><pre className="max-w-64 whitespace-pre-wrap break-all font-mono">{revealed[e.id === environmentId ? r.key : e.id + ":" + r.key] ?? "••••••••"}</pre><Button variant="quiet" disabled={busy} aria-label={`Reveal ${r.key} in ${e.name}`} onClick={() => void reveal(r.key, e.id)}>Show / hide</Button></div> : null}
                        <Chip
                          tone={
                            r.environmentIds.includes(e.id)
                              ? "success"
                              : "warning"
                          }
                        >
                          {r.environmentIds.includes(e.id)
                            ? "Defined"
                            : "Missing"}
                        </Chip>
                      </td>
                    ))}
                  </tr>
                )),
              )}
            </>
          ) : null}
          {section === "History" ? (
            <>
              {writable ? (
                <Form onSave={async (v) => act("snapshot", { label: v.label })}>
                  <Field label="Snapshot name">
                    <Input
                      name="label"
                      maxLength={100}
                      required
                      placeholder="Before the website deployment"
                    />
                  </Field>
                  <Button type="submit" variant="secondary" disabled={busy}>
                    Take snapshot
                  </Button>
                </Form>
              ) : null}
              {view.snapshots.length ? (
                view.snapshots.map((s) => (
                  <Card key={s.id}>
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <h2 className="text-title">
                          {s.label} · Revision {s.revision}
                        </h2>
                        <p>
                          {formatDayTime(s.createdAt, timezone)} ·{" "}
                          {memberName(s.createdById)}
                        </p>
                      </div>
                      {writable ? (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={async () => {
                              const result = await act(
                                "diff",
                                { snapshotId: s.id },
                                false,
                              );
                              if (result) setDiff(result as SnapshotDiff);
                            }}
                          >
                            Compare
                          </Button>
                          <Button
                            variant="dangerOutline"
                            onClick={() =>
                              setConfirm({
                                title: "Restore this environment snapshot?",
                                operation: "rollback",
                                input: { snapshotId: s.id },
                              })
                            }
                          >
                            Restore…
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                ))
              ) : (
                <EmptyState title="No snapshots yet. Save a key or take a snapshot." />
              )}
              <div className="flex flex-wrap gap-2">
                {view.snapshotCursor ? (
                  <Button
                    variant="secondary"
                    onClick={() => navigate(project.id, environmentId, path)}
                  >
                    Newest snapshots
                  </Button>
                ) : null}
                {view.snapshots.length === 100 ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      navigate(
                        project.id,
                        environmentId,
                        path,
                        view.snapshots.at(-1)?.id,
                      )
                    }
                  >
                    Older snapshots
                  </Button>
                ) : null}
              </div>
              {diff.length ? (
                <Card>
                  <h2 className="text-title">
                    Changes from current environment to selected snapshot
                  </h2>
                  {diff.map((d) => (
                    <p key={d.path + d.key} className="break-all">
                      {d.path} / {d.key} · {d.operation}
                    </p>
                  ))}
                </Card>
              ) : null}
              <h2 className="text-h3">Protected changes</h2>
              <a
                className="text-accent-text underline"
                href={`/w/${slug}/requests/approvals`}
              >
                Open approvals
              </a>
              {view.changes.length ? (
                view.changes.map((c) => (
                  <Card key={c.id}>
                    <p>
                      {c.status.toLowerCase()} · Revision {c.revision} ·{" "}
                      {memberName(c.createdById)}
                    </p>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-caption">
                      {JSON.stringify(c.diff, null, 2)}
                    </pre>
                  </Card>
                ))
              ) : (
                <p>No change requests yet.</p>
              )}
            </>
          ) : null}
          {section === "Import and export" ? (
            <>
              {writable ? (
                <Card>
                  <h2 className="mb-4 text-h3">Import an environment file</h2>
                  <div
                    className="grid gap-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && f.size <= 200000) {
                        setSource(await f.text());
                        setPreview(null);
                      } else setError("Use an environment file under 200 KB.");
                    }}
                  >
                    <Field label="Choose a .env file or drop it here">
                      <Input
                        type="file"
                        accept=".env,text/plain"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f && f.size <= 200000) {
                            setSource(await f.text());
                            setPreview(null);
                          } else
                            setError("Use an environment file under 200 KB.");
                        }}
                      />
                    </Field>
                    <Field label="Or paste KEY=value lines">
                      <Textarea
                        value={source}
                        maxLength={200000}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          setSource(e.target.value);
                          setPreview(null);
                        }}
                      />
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={busy || !source}
                      onClick={async () => {
                        const result = await act(
                          "preview",
                          { path, source },
                          false,
                        );
                        if (result) setPreview(result as Preview);
                      }}
                    >
                      Preview import
                    </Button>
                    {preview ? (
                      <>
                        <ul>
                          {preview.diff.map((d) => (
                            <li key={d.key}>
                              {d.key} · {d.operation}
                            </li>
                          ))}
                        </ul>
                        <Button
                          disabled={busy}
                          onClick={async () => {
                            const result = await act("import", {
                              path,
                              source,
                              revision: preview.revision,
                            });
                            if (result) {
                              setSource("");
                              setPreview(null);
                            }
                          }}
                        >
                          {env.protected ? "Request import" : "Apply import"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </Card>
              ) : null}
              {readable ? (
                <Card>
                  <h2 className="mb-4 text-h3">Export resolved secrets</h2>
                  <p className="mb-4 text-body-ui">
                    Verify a fresh code above. The downloaded file contains
                    secret values.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["env", "json", "yaml"].map((format) => (
                      <Button
                        key={format}
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void valueRequest(
                            { operation: "export", format },
                            format === "env" ? ".env" : `secrets.${format}`,
                          )
                        }
                      >
                        Export {format}
                      </Button>
                    ))}
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}
          {section === "Access" && admin ? (
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
              <details className="rounded-xl border border-line p-4">
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
              <details className="rounded-xl border border-line p-4">
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
          ) : null}
          {section === "Machine identities" && admin ? <IdentitySettings view={view} act={act} busy={busy} /> : null}
          {section === "Encryption" && admin && view.encryption ? <Card>
            <h2 className="mb-4 text-h3">Encryption hierarchy</h2>
            <p>Root → workspace key → project data key → secret values. Keys stay inside the server.</p>
            <dl className="my-4 grid gap-3 sm:grid-cols-2"><div><dt>Root key version</dt><dd>{view.encryption.rootVersion}</dd></div><div><dt>Workspace key</dt><dd className="break-all">Version {view.encryption.workspaceVersion} · {view.encryption.workspaceFingerprint}</dd></div><div><dt>Project data key</dt><dd className="break-all">Version {view.encryption.projectVersion} · {view.encryption.projectFingerprint}</dd></div><div><dt>Algorithm</dt><dd>{view.encryption.algorithm}</dd></div><div><dt>Project key created / rotated</dt><dd>{formatDayTime(view.encryption.createdAt, timezone)}</dd></div><div><dt>Workspace key created / rotated</dt><dd>{formatDayTime(view.encryption.workspaceCreatedAt, timezone)}</dd></div></dl>
            {view.encryption.lastJob ? <p role="status">Last {view.encryption.lastJob.kind} rotation: {view.encryption.lastJob.status.toLowerCase()} · {view.encryption.lastJob.processed} of {view.encryption.lastJob.total} records · {formatDayTime(view.encryption.lastJob.createdAt, timezone)}</p> : <p>No rotations yet.</p>}
            <p className="my-3 text-ink-muted">Verify a fresh two-step code above before rotating. Existing values remain available while the background job runs.</p>
            <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy} onClick={() => setConfirm({ title: "Rotate this project data key?", operation: "rotate-key", input: { projectId: project.id, kind: "project" } })}>Rotate data key…</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirm({ title: "Rotate the workspace key?", operation: "rotate-key", input: { projectId: project.id, kind: "workspace" } })}>Rotate workspace key…</Button></div>
          </Card> : null}
          {section === "Service tokens" && admin ? (
            <>
              <Card>
                <h2 className="mb-4 text-h3">Legacy service tokens</h2><p className="mb-4">Move applications to Machine identities for short-lived access tokens. Existing service tokens continue to work.</p>
                <Form
                  onSave={async (v, form) => {
                    const result = await act("token", {
                      name: v.name,
                      path: v.path,
                      writable: v.writable === "on",
                      expiresAt: v.expiresAt
                        ? new Date(String(v.expiresAt)).toISOString()
                        : null,
                      ipAllowlist: String(v.ipAllowlist)
                        .split(/[\s,]+/)
                        .filter(Boolean),
                    });
                    if (
                      result &&
                      typeof result === "object" &&
                      "issuedCredential" in result
                    ) {
                      setIssued(String(result.issuedCredential));
                      form.reset();
                    }
                  }}
                >
                  <Field label="Name">
                    <Input name="name" required maxLength={100} />
                  </Field>
                  <Field label="Exact folder path">
                    <Input name="path" defaultValue={path} required />
                  </Field>
                  <Field label="Expires on" optional>
                    <Input type="date" name="expiresAt" />
                  </Field>
                  <Field label="IP addresses or CIDR ranges" optional>
                    <Textarea name="ipAllowlist" placeholder="One per line" />
                  </Field>
                  <CheckboxCard label="Allow writes" name="writable" />
                  <Button variant="primary" type="submit" disabled={busy}>Create token</Button>
                </Form>
                {issued ? (
                  <div className="mt-4">
                    <p>Copy this token now. It is shown only once.</p>
                    <pre className="whitespace-pre-wrap break-all">
                      {issued}
                    </pre>
                    <Button variant="quiet" onClick={() => setIssued("")}>
                      Hide token
                    </Button>
                  </div>
                ) : null}
              </Card>
              {view.tokens.map((t) => (
                <Card key={t.id}>
                  <h2 className="text-title">{t.name}</h2>
                  <p>
                    {t.path} · {t.writable ? "Read and write" : "Read only"} ·{" "}
                    {t.expiresAt
                      ? `Expires ${formatDate(t.expiresAt, timezone)}`
                      : "No expiry"}{" "}
                    ·{" "}
                    {t.lastUsedAt
                      ? `Used ${formatDate(t.lastUsedAt, timezone)}`
                      : "Never used"}
                  </p>
                  <Chip>
                    {t.revokedAt
                      ? "Revoked"
                      : t.expiresAt &&
                          new Date(t.expiresAt).getTime() <= Date.now()
                        ? "Expired"
                        : "Active"}
                  </Chip>
                  {!t.revokedAt ? (
                    <Button
                      variant="dangerQuiet"
                      onClick={() =>
                        setConfirm({
                          title: "Revoke this service token?",
                          operation: "revoke-token",
                          input: { id: t.id },
                        })
                      }
                    >
                      Revoke…
                    </Button>
                  ) : null}
                </Card>
              ))}
              <pre className="overflow-x-auto rounded-xl bg-surface p-4 text-caption">
                {'curl -fsSL -H "Authorization: Bearer $SWW_SECRETS_TOKEN" \\\n  "https://workspace.example.org/api/v1/secrets?project=' +
                  project.id +
                  "&environment=" +
                  env.slug +
                  '&path=/&format=env" > .env'}
              </pre>
            </>
          ) : null}
          {section === "Sharing" ? (
            <Card>
              <h2 className="mb-4 text-h3">Share secret text</h2>
              <p className="mb-4 text-body-ui">
                Paste a single secret or text. Your browser encrypts it; the key
                stays in the link fragment. Send the entire link privately.
              </p>
              {readable ? (
                <Form
                  onSave={async (v, form) => {
                    const key = await crypto.subtle.generateKey(
                        { name: "AES-GCM", length: 256 },
                        true,
                        ["encrypt"],
                      ),
                      iv = crypto.getRandomValues(new Uint8Array(12));
                    const encrypted = await crypto.subtle.encrypt(
                      { name: "AES-GCM", iv },
                      key,
                      new TextEncoder().encode(String(v.text)),
                    );
                    const encode = (a: ArrayBuffer | Uint8Array) =>
                      btoa(
                        String.fromCharCode(
                          ...new Uint8Array(
                            a instanceof Uint8Array
                              ? (a.buffer as ArrayBuffer)
                              : a,
                          ),
                        ),
                      )
                        .replaceAll("+", "-")
                        .replaceAll("/", "_")
                        .replace(/=+$/, "");
                    const raw = await crypto.subtle.exportKey("raw", key),
                      ciphertext = encode(iv) + "." + encode(encrypted);
                    const result = await act("share", {
                      ciphertext,
                      hours: Number(v.hours),
                      views: Number(v.views),
                    });
                    if (
                      result &&
                      typeof result === "object" &&
                      "shareCapability" in result
                    ) {
                      setShareLink(
                        `${location.origin}/share#${result.shareCapability}.${encode(raw)}`,
                      );
                      form.reset();
                    }
                  }}
                >
                  <Field label="Secret text">
                    <Textarea
                      name="text"
                      required
                      maxLength={20000}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="Expires in hours">
                    <Input
                      type="number"
                      name="hours"
                      min={1}
                      max={168}
                      defaultValue={24}
                    />
                  </Field>
                  <Field label="Allowed views">
                    <Input
                      type="number"
                      name="views"
                      min={1}
                      max={20}
                      defaultValue={1}
                    />
                  </Field>
                  <Button variant="primary" type="submit" disabled={busy}>Create private link</Button>
                </Form>
              ) : (
                <p>Read values access is required to share.</p>
              )}
              {shareLink ? (
                <div className="mt-4">
                  <p>Copy the whole link now.</p>
                  <pre className="whitespace-pre-wrap break-all">
                    {shareLink}
                  </pre>
                </div>
              ) : null}
            </Card>
          ) : null}
          {section === "Security" && view.overview ? (
            <Card>
              <h2 className="mb-4 text-h3">{project.name} security overview</h2>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt>Keys overdue for rotation</dt>
                  <dd>
                    {view.overview.overdue.length} ·{" "}
                    {view.overview.overdue.join(", ") || "None"}
                  </dd>
                </div>
                <div>
                  <dt>Active tokens without expiry</dt>
                  <dd>{view.overview.tokensWithoutExpiry}</dd>
                </div>
                <div>
                  <dt>Unused tokens (30 days)</dt>
                  <dd>{view.overview.unusedTokens}</dd>
                </div>
                <div>
                  <dt>Recent reveals</dt>
                  <dd>{view.overview.recentReveals.length}</dd>
                </div>
              </dl>
              <p className="mt-4 text-caption text-ink-muted">
                Across environments you administer.
              </p>
              {view.overview.recentReveals.slice(0, 10).map((e) => (
                <p key={e.id} className="text-caption">
                  {formatDayTime(e.createdAt, timezone)} ·{" "}
                  {memberName(e.actorId)} · {e.action}
                </p>
              ))}
              {view.overview.productionHolders.length ? (
                <>
                  <h3 className="mt-6 text-title">Production access holders</h3>
                  <ul>
                    {view.overview.productionHolders.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          ) : null}
          {section === "Audit" && admin ? (
            <>
              <Field label="Filter audit actions">
                <Input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From date" optional>
                  <Input
                    type="date"
                    value={auditFrom}
                    onChange={(e) => setAuditFrom(e.target.value)}
                  />
                </Field>
                <Field label="To date" optional>
                  <Input
                    type="date"
                    value={auditUntil}
                    onChange={(e) => setAuditUntil(e.target.value)}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void valueRequest(
                    {
                      operation: "audit",
                      projectId: project.id,
                      environmentId: "",
                      from: auditFrom,
                      until: auditUntil,
                      ...(filter ? { action: filter } : {}),
                    },
                    "secrets-audit.csv",
                  )
                }
              >
                Export project audit CSV
              </Button>
              <p className="text-caption text-ink-muted">
                Recent activity in this environment. Project CSV includes every
                environment you administer.
              </p>
              {table(
                ["When", "Action", "Member"],
                view.audit
                  .filter(
                    (a) =>
                      a.action.includes(filter) &&
                      (!auditStart ||
                        new Date(a.createdAt).getTime() >=
                          new Date(auditStart).getTime()) &&
                      (!auditEnd ||
                        new Date(a.createdAt).getTime() <
                          new Date(auditEnd).getTime() + 60000),
                  )
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="p-3">
                        {formatDayTime(a.createdAt, timezone)}
                      </td>
                      <td className="p-3">{a.action}</td>
                      <td className="p-3">{memberName(a.actorId)}</td>
                    </tr>
                  )),
              )}
            </>
          ) : null}
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
            <Button variant="primary" type="submit" disabled={busy}>Create project</Button>
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
    </div>
  );
}
