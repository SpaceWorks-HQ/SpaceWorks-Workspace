-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "externalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "reminderMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "videoUrl" TEXT;

-- CreateTable
CREATE TABLE "CalendarEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "seriesId" TEXT,
    "rrule" TEXT,
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT,
    "projectId" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "notes" TEXT,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminderMinutes" INTEGER NOT NULL DEFAULT 30,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarMeetingSync" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT -1,
    "etag" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CalendarMeetingSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEntry_workspaceId_startsAt_idx" ON "CalendarEntry"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEntry_workspaceId_ownerId_startsAt_idx" ON "CalendarEntry"("workspaceId", "ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarMeetingSync_workspaceId_userId_idx" ON "CalendarMeetingSync"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarMeetingSync_workspaceId_meetingId_userId_key" ON "CalendarMeetingSync"("workspaceId", "meetingId", "userId");

-- AddForeignKey
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMeetingSync" ADD CONSTRAINT "CalendarMeetingSync_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMeetingSync" ADD CONSTRAINT "CalendarMeetingSync_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

