-- AlterEnum
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'SECRET_CHANGE';

-- CreateTable
CREATE TABLE "SecretProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretEnvironment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "production" BOOLEAN NOT NULL DEFAULT false,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SecretEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "SecretGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretFolder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,

    CONSTRAINT "SecretFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "key" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT NOT NULL,
    "rotateEveryDays" INTEGER,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSecretVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSecretVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretServiceToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "writable" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretServiceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretShare" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "capabilityHash" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "remainingViews" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CliDeviceCode" (
    "id" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'secrets',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "mfaAt" TIMESTAMP(3),
    "sessionVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CliDeviceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CliSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "mfaAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CliSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretProject_workspaceId_id_key" ON "SecretProject"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecretProject_workspaceId_slug_key" ON "SecretProject"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "SecretEnvironment_workspaceId_projectId_position_idx" ON "SecretEnvironment"("workspaceId", "projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SecretEnvironment_workspaceId_id_key" ON "SecretEnvironment"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecretEnvironment_workspaceId_projectId_slug_key" ON "SecretEnvironment"("workspaceId", "projectId", "slug");

-- CreateIndex
CREATE INDEX "SecretGrant_workspaceId_userId_idx" ON "SecretGrant"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretGrant_workspaceId_projectId_environmentId_userId_key" ON "SecretGrant"("workspaceId", "projectId", "environmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretFolder_workspaceId_environmentId_path_key" ON "SecretFolder"("workspaceId", "environmentId", "path");

-- CreateIndex
CREATE INDEX "ApplicationSecret_workspaceId_ownerId_rotatedAt_idx" ON "ApplicationSecret"("workspaceId", "ownerId", "rotatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSecret_workspaceId_id_key" ON "ApplicationSecret"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSecret_workspaceId_environmentId_path_key_key" ON "ApplicationSecret"("workspaceId", "environmentId", "path", "key");

-- CreateIndex
CREATE INDEX "ApplicationSecretVersion_workspaceId_secretId_createdAt_idx" ON "ApplicationSecretVersion"("workspaceId", "secretId", "createdAt");

-- CreateIndex
CREATE INDEX "SecretSnapshot_workspaceId_environmentId_createdAt_idx" ON "SecretSnapshot"("workspaceId", "environmentId", "createdAt");

-- CreateIndex
CREATE INDEX "SecretChange_workspaceId_environmentId_status_idx" ON "SecretChange"("workspaceId", "environmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SecretServiceToken_prefix_key" ON "SecretServiceToken"("prefix");

-- CreateIndex
CREATE INDEX "SecretServiceToken_workspaceId_environmentId_revokedAt_idx" ON "SecretServiceToken"("workspaceId", "environmentId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecretShare_capabilityHash_key" ON "SecretShare"("capabilityHash");

-- CreateIndex
CREATE INDEX "SecretShare_workspaceId_projectId_expiresAt_idx" ON "SecretShare"("workspaceId", "projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "SecretAudit_workspaceId_projectId_createdAt_idx" ON "SecretAudit"("workspaceId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SecretAudit_workspaceId_environmentId_action_idx" ON "SecretAudit"("workspaceId", "environmentId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "CliDeviceCode_deviceHash_key" ON "CliDeviceCode"("deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "CliDeviceCode_userCodeHash_key" ON "CliDeviceCode"("userCodeHash");

-- CreateIndex
CREATE INDEX "CliDeviceCode_expiresAt_idx" ON "CliDeviceCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CliSession_accessHash_key" ON "CliSession"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "CliSession_refreshHash_key" ON "CliSession"("refreshHash");

-- CreateIndex
CREATE INDEX "CliSession_userId_revokedAt_idx" ON "CliSession"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "SecretProject" ADD CONSTRAINT "SecretProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretEnvironment" ADD CONSTRAINT "SecretEnvironment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretEnvironment" ADD CONSTRAINT "SecretEnvironment_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "SecretProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretGrant" ADD CONSTRAINT "SecretGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretGrant" ADD CONSTRAINT "SecretGrant_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "SecretProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretFolder" ADD CONSTRAINT "SecretFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretFolder" ADD CONSTRAINT "SecretFolder_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSecret" ADD CONSTRAINT "ApplicationSecret_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSecret" ADD CONSTRAINT "ApplicationSecret_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSecretVersion" ADD CONSTRAINT "ApplicationSecretVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSecretVersion" ADD CONSTRAINT "ApplicationSecretVersion_workspaceId_secretId_fkey" FOREIGN KEY ("workspaceId", "secretId") REFERENCES "ApplicationSecret"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSnapshot" ADD CONSTRAINT "SecretSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSnapshot" ADD CONSTRAINT "SecretSnapshot_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretChange" ADD CONSTRAINT "SecretChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretChange" ADD CONSTRAINT "SecretChange_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretServiceToken" ADD CONSTRAINT "SecretServiceToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretServiceToken" ADD CONSTRAINT "SecretServiceToken_workspaceId_environmentId_fkey" FOREIGN KEY ("workspaceId", "environmentId") REFERENCES "SecretEnvironment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretShare" ADD CONSTRAINT "SecretShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretAudit" ADD CONSTRAINT "SecretAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CliSession" ADD CONSTRAINT "CliSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

