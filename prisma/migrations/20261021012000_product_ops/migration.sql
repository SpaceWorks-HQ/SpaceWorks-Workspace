-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('ROADMAP', 'RELEASE', 'ISSUE', 'QA_RUN', 'ESTIMATE', 'PROTOTYPE', 'TEST', 'CHANGE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApprovalSubjectType" ADD VALUE 'PRODUCT_RELEASE';
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'PRODUCT_CHANGE';

-- CreateTable
CREATE TABLE "ProductRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" TEXT,
    "projectId" TEXT,
    "releaseId" TEXT,
    "parentId" TEXT,
    "fundingId" TEXT,
    "budgetId" TEXT,
    "fundId" TEXT,
    "dueOn" DATE,
    "dateOn" DATE,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notes" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approvalId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "changelogId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEstimateRevision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEstimateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRecord_workspaceId_kind_archivedAt_dueOn_idx" ON "ProductRecord"("workspaceId", "kind", "archivedAt", "dueOn");

-- CreateIndex
CREATE INDEX "ProductRecord_workspaceId_projectId_idx" ON "ProductRecord"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "ProductRecord_workspaceId_releaseId_idx" ON "ProductRecord"("workspaceId", "releaseId");

-- CreateIndex
CREATE INDEX "ProductRecord_workspaceId_parentId_idx" ON "ProductRecord"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "ProductRecord_workspaceId_ownerId_idx" ON "ProductRecord"("workspaceId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecord_workspaceId_id_key" ON "ProductRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEstimateRevision_workspaceId_recordId_version_key" ON "ProductEstimateRevision"("workspaceId", "recordId", "version");

-- CreateIndex
CREATE INDEX "ProductAttachment_workspaceId_recordId_idx" ON "ProductAttachment"("workspaceId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttachment_workspaceId_fileId_key" ON "ProductAttachment"("workspaceId", "fileId");

-- AddForeignKey
ALTER TABLE "ProductRecord" ADD CONSTRAINT "ProductRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecord" ADD CONSTRAINT "ProductRecord_workspaceId_releaseId_fkey" FOREIGN KEY ("workspaceId", "releaseId") REFERENCES "ProductRecord"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecord" ADD CONSTRAINT "ProductRecord_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "ProductRecord"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEstimateRevision" ADD CONSTRAINT "ProductEstimateRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEstimateRevision" ADD CONSTRAINT "ProductEstimateRevision_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "ProductRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttachment" ADD CONSTRAINT "ProductAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttachment" ADD CONSTRAINT "ProductAttachment_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "ProductRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttachment" ADD CONSTRAINT "ProductAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

