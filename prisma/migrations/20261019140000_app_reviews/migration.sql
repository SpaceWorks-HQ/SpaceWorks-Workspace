-- CreateEnum
CREATE TYPE "AppReviewPlatform" AS ENUM ('APPLE', 'GOOGLE');

-- CreateEnum
CREATE TYPE "AppReviewReplyStatus" AS ENUM ('NONE', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AppReviewPublishState" AS ENUM ('PUBLISHED', 'PENDING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AppReviewPostStatus" AS ENUM ('NONE', 'POSTING', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AppReviewStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'IGNORED');

-- CreateEnum
CREATE TYPE "AppReviewReplySource" AS ENUM ('WORKSPACE', 'SLACK');

-- AlterEnum
ALTER TYPE "RuleScopeType" ADD VALUE 'REVIEWED_APP';

-- CreateTable
CREATE TABLE "AppStoreAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "AppReviewPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "issuerIdEnc" TEXT,
    "keyIdEnc" TEXT,
    "privateKeyP8Enc" TEXT,
    "serviceAccountJsonEnc" TEXT,
    "proxyUrlEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppStoreAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewedApp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "AppReviewPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "appIdentifier" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pollLeaseUntil" TIMESTAMP(3),
    "pollLeaseToken" TEXT,
    "lastError" TEXT,
    "allowNoProxy" BOOLEAN NOT NULL DEFAULT false,
    "proxyUrlEnc" TEXT,
    "slackChannelId" TEXT,
    "linkedServiceId" TEXT,
    "linkedProjectId" TEXT,
    "translationLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewedApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "platform" "AppReviewPlatform" NOT NULL,
    "externalReviewId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "language" TEXT,
    "territory" TEXT,
    "appVersion" TEXT,
    "storeCreatedAt" TIMESTAMP(3) NOT NULL,
    "storeUpdatedAt" TIMESTAMP(3) NOT NULL,
    "replyBody" TEXT,
    "replyStatus" "AppReviewReplyStatus" NOT NULL DEFAULT 'NONE',
    "replyExternalId" TEXT,
    "replySentAt" TIMESTAMP(3),
    "replyPublishState" "AppReviewPublishState" NOT NULL DEFAULT 'UNKNOWN',
    "replyCheckedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "slackChannelId" TEXT,
    "slackMessageTs" TEXT,
    "slackPostStatus" "AppReviewPostStatus" NOT NULL DEFAULT 'NONE',
    "slackPostAttemptAt" TIMESTAMP(3),
    "status" "AppReviewStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReviewReplyAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "source" "AppReviewReplySource" NOT NULL,
    "actorId" TEXT,
    "triggerKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "AppReviewReplyStatus" NOT NULL DEFAULT 'SENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AppReviewReplyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReviewSlackConfig" (
    "workspaceId" TEXT NOT NULL,
    "botTokenEnc" TEXT NOT NULL,
    "signingSecretEnc" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "replyTriggerEmoji" TEXT NOT NULL DEFAULT 'white_check_mark',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppReviewSlackConfig_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AppReviewSlackEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageTs" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AppReviewSlackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReviewSlackMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AppReviewSlackMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppStoreAccount_workspaceId_active_idx" ON "AppStoreAccount"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreAccount_workspaceId_id_platform_key" ON "AppStoreAccount"("workspaceId", "id", "platform");

-- CreateIndex
CREATE INDEX "ReviewedApp_workspaceId_active_nextPollAt_idx" ON "ReviewedApp"("workspaceId", "active", "nextPollAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedApp_workspaceId_platform_appIdentifier_key" ON "ReviewedApp"("workspaceId", "platform", "appIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedApp_workspaceId_id_platform_key" ON "ReviewedApp"("workspaceId", "id", "platform");

-- CreateIndex
CREATE INDEX "AppReview_workspaceId_status_storeCreatedAt_idx" ON "AppReview"("workspaceId", "status", "storeCreatedAt");

-- CreateIndex
CREATE INDEX "AppReview_workspaceId_rating_idx" ON "AppReview"("workspaceId", "rating");

-- CreateIndex
CREATE INDEX "AppReview_workspaceId_replyStatus_replyPublishState_idx" ON "AppReview"("workspaceId", "replyStatus", "replyPublishState");

-- CreateIndex
CREATE INDEX "AppReview_workspaceId_slackChannelId_slackMessageTs_idx" ON "AppReview"("workspaceId", "slackChannelId", "slackMessageTs");

-- CreateIndex
CREATE UNIQUE INDEX "AppReview_workspaceId_appId_externalReviewId_key" ON "AppReview"("workspaceId", "appId", "externalReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "AppReview_workspaceId_id_key" ON "AppReview"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AppReviewReplyAttempt_workspaceId_reviewId_createdAt_idx" ON "AppReviewReplyAttempt"("workspaceId", "reviewId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppReviewReplyAttempt_workspaceId_triggerKey_key" ON "AppReviewReplyAttempt"("workspaceId", "triggerKey");

-- CreateIndex
CREATE INDEX "AppReviewSlackEvent_workspaceId_status_createdAt_idx" ON "AppReviewSlackEvent"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppReviewSlackEvent_workspaceId_externalEventId_key" ON "AppReviewSlackEvent"("workspaceId", "externalEventId");

-- CreateIndex
CREATE INDEX "AppReviewSlackMember_workspaceId_userId_idx" ON "AppReviewSlackMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppReviewSlackMember_workspaceId_slackUserId_key" ON "AppReviewSlackMember"("workspaceId", "slackUserId");

-- AddForeignKey
ALTER TABLE "AppStoreAccount" ADD CONSTRAINT "AppStoreAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedApp" ADD CONSTRAINT "ReviewedApp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedApp" ADD CONSTRAINT "ReviewedApp_workspaceId_accountId_platform_fkey" FOREIGN KEY ("workspaceId", "accountId", "platform") REFERENCES "AppStoreAccount"("workspaceId", "id", "platform") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_workspaceId_appId_platform_fkey" FOREIGN KEY ("workspaceId", "appId", "platform") REFERENCES "ReviewedApp"("workspaceId", "id", "platform") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReviewReplyAttempt" ADD CONSTRAINT "AppReviewReplyAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReviewReplyAttempt" ADD CONSTRAINT "AppReviewReplyAttempt_workspaceId_reviewId_fkey" FOREIGN KEY ("workspaceId", "reviewId") REFERENCES "AppReview"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReviewSlackConfig" ADD CONSTRAINT "AppReviewSlackConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReviewSlackEvent" ADD CONSTRAINT "AppReviewSlackEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReviewSlackMember" ADD CONSTRAINT "AppReviewSlackMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_rating_check" CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "ReviewedApp" ADD CONSTRAINT "ReviewedApp_interval_check" CHECK ("pollIntervalMinutes" BETWEEN 5 AND 1440);

CREATE INDEX "AppReview_workspaceId_storeCreatedAt_idx" ON "AppReview"("workspaceId", "storeCreatedAt");
CREATE INDEX "AppReview_workspaceId_appId_storeCreatedAt_idx" ON "AppReview"("workspaceId", "appId", "storeCreatedAt");
