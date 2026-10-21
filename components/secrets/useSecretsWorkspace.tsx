"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH } from "@/components/ui/table";
import { zonedInputToIso } from "@/lib/timeZone";
import type {
  SecretsView,
  VersionRow,
  Preview,
  SnapshotDiff,
} from "@/lib/secrets/types";
import { useSecretRequests } from "./useSecretRequests";

export type SecretsWorkspaceProps = {
  view: SecretsView;
  slug: string;
  timezone: string;
  initialSection?: "Keys" | "History";
};

export function useSecretsWorkspace({
  view,
  slug,
  timezone,
  initialSection = "Keys",
}: SecretsWorkspaceProps) {
  const router = useRouter(),
    [section, setSection] = useState<string>(initialSection),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(""),
    [auditFrom, setAuditFrom] = useState(""),
    [auditUntil, setAuditUntil] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Keep token expiry labels current while the page stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
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
  const { act, valueRequest } = useSecretRequests({
    slug,
    environmentId,
    path,
    revealEpoch,
    router,
    setError,
    setMessage,
    setBusy,
  });
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
  function changeSection(next: string) {
    revealEpoch.current++;
    setRevealed({});
    setEditing(null);
    setVersionDiff(null);
    setSection(next);
    setFilter("");
  }
  function table(headers: string[], body: ReactNode) {
    if (Array.isArray(body) && !body.length) {
      return section === "Compare"
        ? <EmptyState patch title="No keys in this folder yet. Add one for the application." action={writable ? <Button variant="secondary" onClick={() => setSection("Keys")}>Add a key</Button> : undefined} />
        : <EmptyState patch title="No audit events match this view." action={filter || auditFrom || auditUntil ? <Button variant="secondary" onClick={() => { setFilter(""); setAuditFrom(""); setAuditUntil(""); }}>Clear filters</Button> : undefined} />;
    }
    return (
      <Table label={`${section} in ${env?.name ?? "Secrets"}`}>
        <THead><TR>{headers.map(h => <TH key={h} scope="col">{h}</TH>)}</TR></THead>
        <TBody>{body}</TBody>
      </Table>
    );
  }
  return {
    view,
    slug,
    timezone,
    section,
    changeSection,
    message,
    error,
    setError,
    busy,
    filter,
    setFilter,
    auditFrom,
    setAuditFrom,
    auditUntil,
    setAuditUntil,
    now,
    revealEpoch,
    editorVisible,
    versionDiff,
    setVersionDiff,
    revealed,
    setRevealed,
    issued,
    setIssued,
    shareLink,
    setShareLink,
    source,
    setSource,
    preview,
    setPreview,
    diff,
    setDiff,
    history,
    setHistory,
    editing,
    setEditing,
    confirm,
    setConfirm,
    env,
    project,
    environmentId,
    path,
    writable,
    readable,
    admin,
    auditStart,
    auditEnd,
    memberName,
    act,
    valueRequest,
    reveal,
    copy,
    edit,
    toggleEditor,
    navigate,
    table,
  };
}

export type SecretsSectionState = ReturnType<typeof useSecretsWorkspace> & {
  env: NonNullable<SecretsView["environment"]>;
  project: NonNullable<SecretsView["project"]>;
};
