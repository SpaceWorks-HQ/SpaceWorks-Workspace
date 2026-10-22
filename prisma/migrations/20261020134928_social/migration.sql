-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'RECONNECT', 'DISCONNECTED', 'DEMO');

-- CreateEnum
CREATE TYPE "SocialCommentStatus" AS ENUM ('NEW', 'SEEN', 'REPLIED', 'HIDDEN', 'DELETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationProvider" ADD VALUE 'SOCIAL_YOUTUBE';
ALTER TYPE "IntegrationProvider" ADD VALUE 'SOCIAL_META';
ALTER TYPE "IntegrationProvider" ADD VALUE 'SOCIAL_LINKEDIN';
ALTER TYPE "IntegrationProvider" ADD VALUE 'SOCIAL_X';

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "displayName" TEXT NOT NULL,
    "handle" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedById" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastMetricsAt" TIMESTAMP(3),
    "lastError" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMetricDaily" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SocialMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "text" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "latestMetrics" JSONB NOT NULL DEFAULT '{}',
    "likes" DOUBLE PRECISION,
    "comments" DOUBLE PRECISION,
    "shares" DOUBLE PRECISION,
    "views" DOUBLE PRECISION,
    "impressions" DOUBLE PRECISION,
    "reach" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorHandle" TEXT,
    "authorAvatarUrl" TEXT,
    "text" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SocialCommentStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "replyText" TEXT,
    "replyExternalId" TEXT,
    "repliedById" TEXT,
    "repliedAt" TIMESTAMP(3),
    "replyState" TEXT NOT NULL DEFAULT 'NONE',
    "operationToken" TEXT,
    "operationAt" TIMESTAMP(3),
    "lastReplyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialSyncLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SocialSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConnectionDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidatesEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConnectionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_workspaceId_status_nextSyncAt_idx" ON "SocialAccount"("workspaceId", "status", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_platform_externalId_key" ON "SocialAccount"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_id_key" ON "SocialAccount"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SocialMetricDaily_workspaceId_date_metric_idx" ON "SocialMetricDaily"("workspaceId", "date", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMetricDaily_workspaceId_accountId_date_metric_key" ON "SocialMetricDaily"("workspaceId", "accountId", "date", "metric");

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_publishedAt_idx" ON "SocialPost"("workspaceId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_workspaceId_accountId_externalId_key" ON "SocialPost"("workspaceId", "accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_workspaceId_accountId_id_key" ON "SocialPost"("workspaceId", "accountId", "id");

-- CreateIndex
CREATE INDEX "SocialComment_workspaceId_status_publishedAt_idx" ON "SocialComment"("workspaceId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "SocialComment_workspaceId_assigneeId_publishedAt_idx" ON "SocialComment"("workspaceId", "assigneeId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialComment_workspaceId_accountId_externalId_key" ON "SocialComment"("workspaceId", "accountId", "externalId");

-- CreateIndex
CREATE INDEX "SocialSyncLog_workspaceId_accountId_startedAt_idx" ON "SocialSyncLog"("workspaceId", "accountId", "startedAt");

-- CreateIndex
CREATE INDEX "SocialConnectionDraft_workspaceId_userId_expiresAt_idx" ON "SocialConnectionDraft"("workspaceId", "userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricDaily" ADD CONSTRAINT "SocialMetricDaily_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricDaily" ADD CONSTRAINT "SocialMetricDaily_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "SocialAccount"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "SocialAccount"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "SocialAccount"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_workspaceId_accountId_postId_fkey" FOREIGN KEY ("workspaceId", "accountId", "postId") REFERENCES "SocialPost"("workspaceId", "accountId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSyncLog" ADD CONSTRAINT "SocialSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSyncLog" ADD CONSTRAINT "SocialSyncLog_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "SocialAccount"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConnectionDraft" ADD CONSTRAINT "SocialConnectionDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
