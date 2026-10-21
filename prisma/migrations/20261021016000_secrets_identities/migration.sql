-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "meetPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CalendarMeetingSync" ADD COLUMN     "meetPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "meetRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SecretAudit" ADD COLUMN     "secretKey" TEXT;

-- CreateTable
CREATE TABLE "SecretIdentity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "accessTtl" INTEGER NOT NULL DEFAULT 7200,
    "maxTtl" INTEGER NOT NULL DEFAULT 2592000,
    "tokenUses" INTEGER,
    "secretUses" INTEGER,
    "secretTtl" INTEGER,
    "loginIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failureLimit" INTEGER NOT NULL DEFAULT 3,
    "lockoutSeconds" INTEGER NOT NULL DEFAULT 300,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretIdentityPermission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "role" TEXT NOT NULL DEFAULT 'READ',

    CONSTRAINT "SecretIdentityPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretIdentityCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "remainingUses" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretIdentityCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretIdentityToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxExpiresAt" TIMESTAMP(3) NOT NULL,
    "remainingUses" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretIdentityToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "parentId" TEXT,
    "rootVersion" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "VaultKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretKeyRotation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SecretKeyRotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretIdentity_clientId_key" ON "SecretIdentity"("clientId");

-- CreateIndex
CREATE INDEX "SecretIdentity_workspaceId_projectId_idx" ON "SecretIdentity"("workspaceId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretIdentity_workspaceId_id_key" ON "SecretIdentity"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecretIdentityPermission_workspaceId_identityId_environment_key" ON "SecretIdentityPermission"("workspaceId", "identityId", "environmentId", "path");

-- CreateIndex
CREATE INDEX "SecretIdentityCredential_workspaceId_identityId_idx" ON "SecretIdentityCredential"("workspaceId", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretIdentityCredential_workspaceId_id_key" ON "SecretIdentityCredential"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecretIdentityToken_tokenHash_key" ON "SecretIdentityToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SecretIdentityToken_workspaceId_identityId_revokedAt_idx" ON "SecretIdentityToken"("workspaceId", "identityId", "revokedAt");

-- CreateIndex
CREATE INDEX "VaultKey_workspaceId_projectId_active_idx" ON "VaultKey"("workspaceId", "projectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "VaultKey_workspaceId_scope_version_key" ON "VaultKey"("workspaceId", "scope", "version");

-- CreateIndex
CREATE INDEX "SecretKeyRotation_workspaceId_projectId_createdAt_idx" ON "SecretKeyRotation"("workspaceId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "SecretIdentity" ADD CONSTRAINT "SecretIdentity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentity" ADD CONSTRAINT "SecretIdentity_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "SecretProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentityPermission" ADD CONSTRAINT "SecretIdentityPermission_workspaceId_identityId_fkey" FOREIGN KEY ("workspaceId", "identityId") REFERENCES "SecretIdentity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentityPermission" ADD CONSTRAINT "SecretIdentityPermission_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentityCredential" ADD CONSTRAINT "SecretIdentityCredential_workspaceId_identityId_fkey" FOREIGN KEY ("workspaceId", "identityId") REFERENCES "SecretIdentity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentityToken" ADD CONSTRAINT "SecretIdentityToken_workspaceId_identityId_fkey" FOREIGN KEY ("workspaceId", "identityId") REFERENCES "SecretIdentity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretIdentityToken" ADD CONSTRAINT "SecretIdentityToken_workspaceId_credentialId_fkey" FOREIGN KEY ("workspaceId", "credentialId") REFERENCES "SecretIdentityCredential"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultKey" ADD CONSTRAINT "VaultKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultKey" ADD CONSTRAINT "VaultKey_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "SecretProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretKeyRotation" ADD CONSTRAINT "SecretKeyRotation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretKeyRotation" ADD CONSTRAINT "SecretKeyRotation_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "SecretProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

