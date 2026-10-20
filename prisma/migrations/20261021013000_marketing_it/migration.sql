-- AlterTable
ALTER TABLE "BackupRun" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "MarketingItRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" TEXT,
    "assetId" TEXT,
    "subscriptionId" TEXT,
    "dateOn" DATE,
    "dueOn" DATE,
    "reminderDays" INTEGER NOT NULL DEFAULT 1,
    "details" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingItRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingItAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fromLibrary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingItAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingItEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingItEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingItReviewItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingItReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingItRecord_workspaceId_kind_archivedAt_dueOn_idx" ON "MarketingItRecord"("workspaceId", "kind", "archivedAt", "dueOn");

-- CreateIndex
CREATE INDEX "MarketingItRecord_workspaceId_ownerId_idx" ON "MarketingItRecord"("workspaceId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingItRecord_workspaceId_id_key" ON "MarketingItRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingItRecord_workspaceId_assetId_key" ON "MarketingItRecord"("workspaceId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingItRecord_workspaceId_subscriptionId_key" ON "MarketingItRecord"("workspaceId", "subscriptionId");

-- CreateIndex
CREATE INDEX "MarketingItAttachment_workspaceId_fileId_idx" ON "MarketingItAttachment"("workspaceId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingItAttachment_workspaceId_recordId_fileId_key" ON "MarketingItAttachment"("workspaceId", "recordId", "fileId");

-- CreateIndex
CREATE INDEX "MarketingItEvent_workspaceId_recordId_createdAt_idx" ON "MarketingItEvent"("workspaceId", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingItReviewItem_workspaceId_recordId_idx" ON "MarketingItReviewItem"("workspaceId", "recordId");

-- CreateIndex
CREATE INDEX "MarketingItReviewItem_workspaceId_userId_idx" ON "MarketingItReviewItem"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingItReviewItem_workspaceId_recordId_userId_sourceTyp_key" ON "MarketingItReviewItem"("workspaceId", "recordId", "userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BackupRun_workspaceId_startedAt_idx" ON "BackupRun"("workspaceId", "startedAt");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItRecord" ADD CONSTRAINT "MarketingItRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItAttachment" ADD CONSTRAINT "MarketingItAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItAttachment" ADD CONSTRAINT "MarketingItAttachment_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MarketingItRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItAttachment" ADD CONSTRAINT "MarketingItAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItEvent" ADD CONSTRAINT "MarketingItEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItEvent" ADD CONSTRAINT "MarketingItEvent_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MarketingItRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItReviewItem" ADD CONSTRAINT "MarketingItReviewItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingItReviewItem" ADD CONSTRAINT "MarketingItReviewItem_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "MarketingItRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

