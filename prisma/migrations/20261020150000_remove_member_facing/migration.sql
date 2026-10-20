-- Retired member-facing content must not remain discoverable or queued for delivery.
BEGIN;
UPDATE "Asset" SET "status" = 'AVAILABLE' WHERE "status" IN ('CHECKED_OUT', 'RESERVED');
DELETE FROM "CalendarFeedToken" WHERE "scope" <> 'PERSONAL';
DELETE FROM "NotificationRule" WHERE "scopeType" = 'CALENDAR';
UPDATE "NotificationRule" SET "eventTypes" = array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(array_remove("eventTypes", 'shoutout.received'), 'event.reminder'), 'event.created'), 'event.changed'), 'rsvp.changed'), 'asset.checkout_overdue'), 'asset.booking_reminder');
DELETE FROM "NotificationPreference" WHERE "category" = 'calendar';
DELETE FROM "SearchDocument" WHERE "entityType" IN ('community_event', 'event', 'shoutout', 'blog_post');
DELETE FROM "ActivityEvent" WHERE "entityType" IN ('community_event', 'event', 'shoutout', 'blog_post');
DELETE FROM "RecordLink" WHERE "fromType" IN ('community_event', 'event', 'shoutout', 'blog_post') OR "toType" IN ('community_event', 'event', 'shoutout', 'blog_post');
DELETE FROM "Bookmark" WHERE "entityType" IN ('community_event', 'event', 'shoutout', 'blog_post');
DELETE FROM "NotificationMute" WHERE "resourceType" IN ('community_event', 'event', 'shoutout', 'blog_post');
-- Former public covers go through the existing private-file deletion lifecycle.
UPDATE "FileObject" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "id" IN (SELECT "coverFileId" FROM "BlogPost" WHERE "coverFileId" IS NOT NULL);
-- Outbox records must be removed before their deliveries and event envelopes.
DELETE FROM "OutboxMessage" WHERE "kind" = 'notify.deliver' AND "payload"->>'deliveryId' IN (
  SELECT d."id" FROM "NotificationDelivery" d JOIN "NotificationEventRecord" e ON e."id" = d."eventId"
  WHERE e."type" IN ('shoutout.received', 'event.reminder', 'event.created', 'event.changed', 'rsvp.changed', 'asset.checkout_overdue', 'asset.booking_reminder')
);
DELETE FROM "NotificationDigestItem" WHERE "eventId" IN (SELECT "id" FROM "NotificationEventRecord" WHERE "type" IN ('shoutout.received', 'event.reminder', 'event.created', 'event.changed', 'rsvp.changed', 'asset.checkout_overdue', 'asset.booking_reminder'));
DELETE FROM "Notification" WHERE "kind" IN ('shoutout.received', 'shoutout', 'event.reminder', 'event.created', 'event.changed', 'rsvp.changed', 'asset.checkout_overdue', 'asset.booking_reminder') OR "eventId" IN (SELECT "id" FROM "NotificationEventRecord" WHERE "type" IN ('shoutout.received', 'event.reminder', 'event.created', 'event.changed', 'rsvp.changed', 'asset.checkout_overdue', 'asset.booking_reminder'));
DELETE FROM "NotificationEventRecord" WHERE "type" IN ('shoutout.received', 'event.reminder', 'event.created', 'event.changed', 'rsvp.changed', 'asset.checkout_overdue', 'asset.booking_reminder');

-- AlterEnum
CREATE TYPE "AssetStatus_new" AS ENUM ('AVAILABLE', 'IN_MAINTENANCE', 'LOST', 'RETIRED');
ALTER TABLE "Asset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Asset" ALTER COLUMN "status" TYPE "AssetStatus_new" USING ("status"::text::"AssetStatus_new");
ALTER TYPE "AssetStatus" RENAME TO "AssetStatus_old";
ALTER TYPE "AssetStatus_new" RENAME TO "AssetStatus";
DROP TYPE "AssetStatus_old";
ALTER TABLE "Asset" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';

-- AlterEnum
CREATE TYPE "RuleScopeType_new" AS ENUM ('REVIEWED_APP', 'WORKSPACE', 'MONITOR', 'INCIDENT', 'PROJECT', 'DIGEST', 'ANNOUNCEMENT', 'FORM', 'SUBSCRIPTION', 'COST_BUDGET', 'CLOUD_CONNECTION', 'GITHUB_REPO', 'SERVICE_CATALOG_ITEM', 'BOARDROOM', 'BUDGET', 'MEETING');
ALTER TABLE "NotificationRule" ALTER COLUMN "scopeType" DROP DEFAULT;
ALTER TABLE "NotificationRule" ALTER COLUMN "scopeType" TYPE "RuleScopeType_new" USING ("scopeType"::text::"RuleScopeType_new");
ALTER TYPE "RuleScopeType" RENAME TO "RuleScopeType_old";
ALTER TYPE "RuleScopeType_new" RENAME TO "RuleScopeType";
DROP TYPE "RuleScopeType_old";
ALTER TABLE "NotificationRule" ALTER COLUMN "scopeType" SET DEFAULT 'WORKSPACE';

-- DropForeignKey
ALTER TABLE "CommunityEvent" DROP CONSTRAINT "CommunityEvent_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "CommunityEvent" DROP CONSTRAINT "CommunityEvent_createdById_fkey";

-- DropForeignKey
ALTER TABLE "EventAttendee" DROP CONSTRAINT "EventAttendee_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EventAttendee" DROP CONSTRAINT "EventAttendee_userId_fkey";

-- DropForeignKey
ALTER TABLE "Shoutout" DROP CONSTRAINT "Shoutout_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Shoutout" DROP CONSTRAINT "Shoutout_fromId_fkey";

-- DropForeignKey
ALTER TABLE "Shoutout" DROP CONSTRAINT "Shoutout_toId_fkey";

-- DropForeignKey
ALTER TABLE "BlogPost" DROP CONSTRAINT "BlogPost_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "BlogPost" DROP CONSTRAINT "BlogPost_authorId_fkey";

-- DropForeignKey
ALTER TABLE "BlogPost" DROP CONSTRAINT "BlogPost_coverFileId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_calendarEventId_fkey";

-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_requiresCertTypeId_fkey";

-- DropForeignKey
ALTER TABLE "AssetCheckout" DROP CONSTRAINT "AssetCheckout_assetId_fkey";

-- DropForeignKey
ALTER TABLE "AssetBooking" DROP CONSTRAINT "AssetBooking_assetId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_calendarEventId_fkey";

-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "blogEnabled",
DROP COLUMN "googleCalendarId";

-- AlterTable
ALTER TABLE "Shift" DROP COLUMN "calendarEventId";

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "bookable",
DROP COLUMN "checkoutable",
DROP COLUMN "maxCheckoutDays",
DROP COLUMN "requiresCertTypeId";

-- AlterTable
ALTER TABLE "Deal" DROP COLUMN "eventId";

-- AlterTable
ALTER TABLE "Budget" DROP COLUMN "eventId";

-- AlterTable
ALTER TABLE "PurchaseRequest" DROP COLUMN "eventId";

-- AlterTable
ALTER TABLE "Meeting" DROP COLUMN "calendarEventId";

-- AlterTable
ALTER TABLE "ChangelogEntry" DROP COLUMN "blogPostId";

-- DropTable
DROP TABLE "CommunityEvent";

-- DropTable
DROP TABLE "EventAttendee";

-- DropTable
DROP TABLE "Shoutout";

-- DropTable
DROP TABLE "BlogPost";

-- DropTable
DROP TABLE "AssetCheckout";

-- DropTable
DROP TABLE "AssetBooking";

-- DropEnum
DROP TYPE "CommunityEventKind";

-- DropEnum
DROP TYPE "AttendanceStatus";

-- DropEnum
DROP TYPE "BlogPostStatus";

-- DropEnum
DROP TYPE "BookingStatus";


COMMIT;
