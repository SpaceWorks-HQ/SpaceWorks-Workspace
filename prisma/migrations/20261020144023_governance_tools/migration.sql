-- CreateEnum
CREATE TYPE "GovernanceKind" AS ENUM ('LEGAL_ENTITY', 'OBLIGATION', 'COMMITTEE', 'TERM', 'MINUTES', 'RESOLUTION', 'CONFLICT', 'AGM_ITEM', 'VENDOR', 'CONTRACT');

-- CreateTable
CREATE TABLE "GovernanceRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "GovernanceKind" NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "ownerId" TEXT,
    "parentId" TEXT,
    "organisationId" TEXT,
    "meetingId" TEXT,
    "number" INTEGER,
    "dueOn" DATE,
    "startsOn" DATE,
    "endsOn" DATE,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceBankChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "bankEnc" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceBankChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovernanceRecord_workspaceId_kind_archivedAt_dueOn_idx" ON "GovernanceRecord"("workspaceId", "kind", "archivedAt", "dueOn");

-- CreateIndex
CREATE INDEX "GovernanceRecord_workspaceId_parentId_idx" ON "GovernanceRecord"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "GovernanceRecord_workspaceId_ownerId_idx" ON "GovernanceRecord"("workspaceId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceRecord_workspaceId_id_key" ON "GovernanceRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceRecord_workspaceId_kind_key_key" ON "GovernanceRecord"("workspaceId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceRecord_workspaceId_kind_number_key" ON "GovernanceRecord"("workspaceId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceRecord_workspaceId_organisationId_key" ON "GovernanceRecord"("workspaceId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceAttachment_workspaceId_fileId_key" ON "GovernanceAttachment"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "GovernanceAttachment_workspaceId_recordId_idx" ON "GovernanceAttachment"("workspaceId", "recordId");

-- CreateIndex
CREATE INDEX "GovernanceBankChange_workspaceId_vendorId_createdAt_idx" ON "GovernanceBankChange"("workspaceId", "vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "GovernanceRecord" ADD CONSTRAINT "GovernanceRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceRecord" ADD CONSTRAINT "GovernanceRecord_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "GovernanceRecord"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceRecord" ADD CONSTRAINT "GovernanceRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceRecord" ADD CONSTRAINT "GovernanceRecord_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceAttachment" ADD CONSTRAINT "GovernanceAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceAttachment" ADD CONSTRAINT "GovernanceAttachment_workspaceId_recordId_fkey" FOREIGN KEY ("workspaceId", "recordId") REFERENCES "GovernanceRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceAttachment" ADD CONSTRAINT "GovernanceAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceBankChange" ADD CONSTRAINT "GovernanceBankChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceBankChange" ADD CONSTRAINT "GovernanceBankChange_workspaceId_vendorId_fkey" FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "GovernanceRecord"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
