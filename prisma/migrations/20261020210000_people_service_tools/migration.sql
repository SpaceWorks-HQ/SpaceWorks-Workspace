-- CreateEnum
CREATE TYPE "HelpTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HelpTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SafetyReportKind" AS ENUM ('INJURY', 'NEAR_MISS', 'DAMAGE', 'HAZARD');

-- CreateEnum
CREATE TYPE "SafetyReportStatus" AS ENUM ('REPORTED', 'INVESTIGATING', 'FOLLOW_UP', 'CLOSED');

-- CreateEnum
CREATE TYPE "VolunteerLogStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "MemberProfile" ADD COLUMN     "engagementEnd" DATE,
ADD COLUMN     "engagementStart" DATE,
ADD COLUMN     "engagementType" TEXT NOT NULL DEFAULT 'VOLUNTEER';

-- CreateTable
CREATE TABLE "HelpTicket" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "HelpTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "HelpTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "handlerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpTicketComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpTicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "immediateAction" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "kind" "SafetyReportKind" NOT NULL,
    "status" "SafetyReportStatus" NOT NULL DEFAULT 'REPORTED',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyFollowUp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "minutes" INTEGER NOT NULL,
    "status" "VolunteerLogStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allowanceDays" INTEGER NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringOpening" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "engagementType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueOn" DATE,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'APPLIED',
    "notes" TEXT NOT NULL,
    "offer" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "dueOn" DATE,
    "onboardingRunId" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringInterview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "heldOn" DATE NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "HiringInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityLease" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "landlordContactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "rentMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "startsOn" DATE NOT NULL,
    "renewalOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpTicket_workspaceId_status_slaDueAt_idx" ON "HelpTicket"("workspaceId", "status", "slaDueAt");

-- CreateIndex
CREATE INDEX "HelpTicket_workspaceId_requesterId_createdAt_idx" ON "HelpTicket"("workspaceId", "requesterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpTicket_workspaceId_id_key" ON "HelpTicket"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HelpTicket_workspaceId_number_key" ON "HelpTicket"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "HelpTicket_workspaceId_requesterId_requestKey_key" ON "HelpTicket"("workspaceId", "requesterId", "requestKey");

-- CreateIndex
CREATE INDEX "HelpTicketComment_workspaceId_ticketId_createdAt_idx" ON "HelpTicketComment"("workspaceId", "ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SafetyReport_workspaceId_status_createdAt_idx" ON "SafetyReport"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SafetyReport_workspaceId_reporterId_createdAt_idx" ON "SafetyReport"("workspaceId", "reporterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyReport_workspaceId_id_key" ON "SafetyReport"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyReport_workspaceId_reporterId_requestKey_key" ON "SafetyReport"("workspaceId", "reporterId", "requestKey");

-- CreateIndex
CREATE INDEX "SafetyFollowUp_workspaceId_reportId_dueAt_idx" ON "SafetyFollowUp"("workspaceId", "reportId", "dueAt");

-- CreateIndex
CREATE INDEX "VolunteerLog_workspaceId_userId_startsAt_idx" ON "VolunteerLog"("workspaceId", "userId", "startsAt");

-- CreateIndex
CREATE INDEX "VolunteerLog_workspaceId_status_startsAt_idx" ON "VolunteerLog"("workspaceId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerLog_workspaceId_userId_requestKey_key" ON "VolunteerLog"("workspaceId", "userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_workspaceId_id_key" ON "LeaveType"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_workspaceId_name_key" ON "LeaveType"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "LeaveBalance_workspaceId_year_idx" ON "LeaveBalance"("workspaceId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_workspaceId_userId_year_typeId_key" ON "LeaveBalance"("workspaceId", "userId", "year", "typeId");

-- CreateIndex
CREATE INDEX "HiringOpening_workspaceId_status_dueOn_idx" ON "HiringOpening"("workspaceId", "status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "HiringOpening_workspaceId_id_key" ON "HiringOpening"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HiringOpening_workspaceId_requestKey_key" ON "HiringOpening"("workspaceId", "requestKey");

-- CreateIndex
CREATE INDEX "HiringCandidate_workspaceId_stage_dueOn_idx" ON "HiringCandidate"("workspaceId", "stage", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "HiringCandidate_workspaceId_id_key" ON "HiringCandidate"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HiringCandidate_workspaceId_requestKey_key" ON "HiringCandidate"("workspaceId", "requestKey");

-- CreateIndex
CREATE INDEX "HiringInterview_workspaceId_candidateId_heldOn_idx" ON "HiringInterview"("workspaceId", "candidateId", "heldOn");

-- CreateIndex
CREATE INDEX "OpsAttachment_workspaceId_kind_recordId_idx" ON "OpsAttachment"("workspaceId", "kind", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsAttachment_workspaceId_fileId_key" ON "OpsAttachment"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "FacilityLease_workspaceId_status_renewalOn_idx" ON "FacilityLease"("workspaceId", "status", "renewalOn");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityLease_workspaceId_requestKey_key" ON "FacilityLease"("workspaceId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_workspaceId_id_key" ON "FileObject"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "HelpTicket" ADD CONSTRAINT "HelpTicket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpTicketComment" ADD CONSTRAINT "HelpTicketComment_workspaceId_ticketId_fkey" FOREIGN KEY ("workspaceId", "ticketId") REFERENCES "HelpTicket"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyFollowUp" ADD CONSTRAINT "SafetyFollowUp_workspaceId_reportId_fkey" FOREIGN KEY ("workspaceId", "reportId") REFERENCES "SafetyReport"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerLog" ADD CONSTRAINT "VolunteerLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_workspaceId_typeId_fkey" FOREIGN KEY ("workspaceId", "typeId") REFERENCES "LeaveType"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOpening" ADD CONSTRAINT "HiringOpening_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringCandidate" ADD CONSTRAINT "HiringCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringCandidate" ADD CONSTRAINT "HiringCandidate_workspaceId_openingId_fkey" FOREIGN KEY ("workspaceId", "openingId") REFERENCES "HiringOpening"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringInterview" ADD CONSTRAINT "HiringInterview_workspaceId_candidateId_fkey" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "HiringCandidate"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAttachment" ADD CONSTRAINT "OpsAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAttachment" ADD CONSTRAINT "OpsAttachment_workspaceId_fileId_fkey" FOREIGN KEY ("workspaceId", "fileId") REFERENCES "FileObject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityLease" ADD CONSTRAINT "FacilityLease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

