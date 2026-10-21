CREATE TABLE "AnalyticsPreset" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL, "section" TEXT NOT NULL, "query" JSONB NOT NULL,
 "shared" BOOLEAN NOT NULL DEFAULT false, "pinned" BOOLEAN NOT NULL DEFAULT false,
 "commentary" TEXT NOT NULL DEFAULT '', "fileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AnalyticsPreset_workspaceId_ownerId_idx" ON "AnalyticsPreset"("workspaceId","ownerId");
CREATE INDEX "AnalyticsPreset_workspaceId_shared_pinned_idx" ON "AnalyticsPreset"("workspaceId","shared","pinned");
CREATE TABLE "AnalyticsAdjustment" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
 "title" TEXT NOT NULL, "dueOn" DATE NOT NULL, "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" <> 0), "currency" TEXT NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
 "fundId" TEXT, "costCentreId" TEXT, "notes" TEXT NOT NULL DEFAULT '', "fileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AnalyticsAdjustment_workspaceId_currency_dueOn_idx" ON "AnalyticsAdjustment"("workspaceId","currency","dueOn");
