-- CreateEnum
CREATE TYPE "FundingKind" AS ENUM ('OPPORTUNITY', 'FUNDER', 'GRANT', 'INSTALMENT', 'REPORT', 'DELIVERABLE', 'DONATION', 'CAMPAIGN', 'PLEDGE', 'DONOR', 'PROGRAMME', 'KPI', 'IMPACT_ENTRY', 'RUNWAY', 'TOOL_ACCOUNT', 'ACCESS_REVIEW', 'RECEIPT_SETTINGS');

-- CreateTable
CREATE TABLE "FundingRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "FundingKind" NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" TEXT,
    "parentId" TEXT,
    "fundId" TEXT,
    "contactId" TEXT,
    "organisationId" TEXT,
    "dateOn" DATE,
    "dueOn" DATE,
    "endsOn" DATE,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "details" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "thankedAt" TIMESTAMP(3),
    "thankedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedById" TEXT,
    "receiptNumber" TEXT,
    "receiptFileId" TEXT,
    "receiptEmailedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dateOn" DATE NOT NULL,
    "summary" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_kind_archivedAt_dueOn_idx" ON "FundingRecord"("workspaceId", "kind", "archivedAt", "dueOn");

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_parentId_idx" ON "FundingRecord"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_ownerId_idx" ON "FundingRecord"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_fundId_idx" ON "FundingRecord"("workspaceId", "fundId");

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_contactId_idx" ON "FundingRecord"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "FundingRecord_workspaceId_organisationId_idx" ON "FundingRecord"("workspaceId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRecord_workspaceId_id_key" ON "FundingRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRecord_workspaceId_kind_key_key" ON "FundingRecord"("workspaceId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRecord_workspaceId_receiptNumber_key" ON "FundingRecord"("workspaceId", "receiptNumber");

-- CreateIndex
CREATE INDEX "FundingAttachment_workspaceId_recordId_idx" ON "FundingAttachment"("workspaceId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingAttachment_workspaceId_fileId_key" ON "FundingAttachment"("workspaceId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingAnalyticsSnapshot_workspaceId_dateOn_key" ON "FundingAnalyticsSnapshot"("workspaceId", "dateOn");

-- AddForeignKey
ALTER TABLE "FundingRecord" ADD CONSTRAINT "FundingRecord_workspaceId_fundId_fkey" FOREIGN KEY ("workspaceId", "fundId") REFERENCES "FinanceFund"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRecord" ADD CONSTRAINT "FundingRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRecord" ADD CONSTRAINT "FundingRecord_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "FundingRecord"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAttachment" ADD CONSTRAINT "FundingAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAttachment" ADD CONSTRAINT "FundingAttachment_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "FundingRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAttachment" ADD CONSTRAINT "FundingAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAnalyticsSnapshot" ADD CONSTRAINT "FundingAnalyticsSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

