import type { SecretRole } from "./values";
/** Metadata-only contracts. No persistence modules are imported by renderers. */
export type EnvironmentView = {
  id: string;
  name: string;
  slug: string;
  production: boolean;
  protected: boolean;
  position: number;
  revision: number;
  accessRole: SecretRole;
};
export type SecretProjectView = {
  id: string;
  name: string;
  slug: string;
  environments: EnvironmentView[];
};
export type SecretMetadata = {
  id: string;
  key: string;
  path: string;
  deletedAt: Date | null;
  comment: string;
  tags: string[];
  ownerId: string;
  rotateEveryDays: number | null;
  rotatedAt: Date;
  updatedAt: Date;
};
export type AuditRow = {
  id: string;
  action: string;
  actorId: string | null;
  targetId: string | null;
  createdAt: Date;
};
export type SecretsView = {
  projects: SecretProjectView[];
  project: SecretProjectView | null;
  environment: EnvironmentView | null;
  path: string;
  rows: SecretMetadata[];
  keysCursor?: string;
  nextKeysCursor?: string;
  comparison: { key: string; environmentIds: string[] }[];
  folders: { path: string }[];
  snapshotCursor?: string;
  snapshots: {
    id: string;
    label: string;
    revision: number;
    createdAt: Date;
    createdById: string;
  }[];
  changes: {
    id: string;
    status: string;
    diff: unknown;
    revision: number;
    createdAt: Date;
    createdById: string;
  }[];
  grants: { id: string; environmentId: string; userId: string; role: string }[];
  tokens: {
    id: string;
    name: string;
    path: string;
    writable: boolean;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    ipAllowlist: string[];
  }[];
  encryption: { algorithm: string; rootVersion: number; workspaceVersion: number; workspaceFingerprint: string; projectVersion: number; projectFingerprint: string; createdAt: Date; workspaceCreatedAt: Date; lastJob: { id: string; kind: string; status: string; processed: number; total: number; createdAt: Date; finishedAt: Date | null } | null } | null;
  identities: { id: string; name: string; clientId: string; accessTtl: number; maxTtl: number; tokenUses: number | null; secretUses: number | null; secretTtl: number | null; loginIps: string[]; tokenIps: string[]; failureLimit: number; lockoutSeconds: number; lockedUntil: Date | null; revokedAt: Date | null; permissions: { environmentId: string; path: string; role: string }[]; clientSecretMetadata: { id: string; remainingUses: number | null; expiresAt: Date | null; revokedAt: Date | null }[]; tokens: { id: string; expiresAt: Date; remainingUses: number | null }[] }[];
  audit: AuditRow[];
  members: {
    userId: string;
    role: string;
    user: { name: string | null; email: string };
  }[];
  canManage: boolean;
  overview: {
    overdue: string[];
    tokensWithoutExpiry: number;
    unusedTokens: number;
    recentReveals: {
      id: string;
      actorId: string | null;
      action: string;
      environmentId: string | null;
      createdAt: Date;
    }[];
    productionHolders: string[];
  } | null;
};
export type VersionRow = {
  id: string;
  createdAt: Date | string;
  createdById: string;
  deleted: boolean;
};
export type Preview = {
  revision: number;
  diff: { key: string; operation: string }[];
};
export type SnapshotDiff = { key: string; path: string; operation: string }[];
