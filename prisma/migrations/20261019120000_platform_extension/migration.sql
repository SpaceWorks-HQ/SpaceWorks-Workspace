-- Platform extension: internal-team features, Services monitor, messaging
-- and notification routing (see docs/ROADMAP-BUILD.md for area ownership).
-- TelegramLink is replaced by the generic ExternalIdentityLink + LinkCode.
-- SearchDocument.searchVector is a generated tsvector (title A, body B) and
-- SearchDocument.title has a trigram index (pg_trgm) for fuzzy prefix search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "TeamVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'TEAM', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM ('PURCHASE_REQUEST', 'REIMBURSEMENT', 'FORM_SUBMISSION', 'VAULT_ACCESS', 'DOC', 'ACCESS_CREDENTIAL', 'TIME_OFF', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('CORE', 'VOLUNTEER', 'MEMBER', 'ALUMNI');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('ONBOARDING', 'OFFBOARDING', 'EVENT', 'OPENING', 'CLOSING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ChecklistRunStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilityType" AS ENUM ('AWAY', 'LIMITED', 'TRAVEL', 'BUSY');

-- CreateEnum
CREATE TYPE "ShiftAssignmentStatus" AS ENUM ('CONFIRMED', 'WAITLIST', 'SWAP_REQUESTED', 'NO_SHOW', 'ATTENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftSwapStatus" AS ENUM ('OPEN', 'ACCEPTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('INTERNAL_APP', 'WEBSITE', 'SAAS_ACCOUNT', 'DOMAIN', 'SERVER', 'DATABASE', 'STORAGE', 'REPO', 'BOT', 'DEVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceEnv" AS ENUM ('PROD', 'STAGING', 'DEV', 'NONE');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('TIER1', 'TIER2', 'TIER3');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DEPRECATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PERSONAL');

-- CreateEnum
CREATE TYPE "ServiceLinkTarget" AS ENUM ('MONITOR', 'CLOUD_RESOURCE', 'VAULT_ITEM', 'SUBSCRIPTION', 'GITHUB_REPO', 'DOC', 'CHANNEL', 'ASSET');

-- CreateEnum
CREATE TYPE "SubscriptionKind" AS ENUM ('DOMAIN', 'SAAS', 'HOSTING', 'INSURANCE', 'LICENSE', 'LEASE', 'MEMBERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME', 'USAGE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLING', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VaultItemType" AS ENUM ('LOGIN', 'API_KEY', 'SECRET_NOTE', 'WIFI', 'CARD_REFERENCE', 'SSH_KEY', 'TOTP');

-- CreateEnum
CREATE TYPE "VaultSensitivity" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "VaultPermission" AS ENUM ('LIST', 'REVEAL', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "VaultAccessAction" AS ENUM ('LIST', 'REVEAL', 'COPY', 'EDIT', 'GRANT', 'ROTATE', 'DENIED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'TEAM', 'ROLE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'CHECKED_OUT', 'IN_MAINTENANCE', 'RESERVED', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceLogType" AS ENUM ('REPAIR', 'SERVICE', 'INSPECTION', 'NOTE');

-- CreateEnum
CREATE TYPE "AccessCredentialType" AS ENUM ('KEY', 'FOB', 'CARD', 'CODE');

-- CreateEnum
CREATE TYPE "AccessCredentialStatus" AS ENUM ('ISSUED', 'IN_SAFE', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('SPONSOR', 'PARTNER', 'VENDOR', 'VENUE', 'UNIVERSITY', 'GOVERNMENT', 'MEDIA', 'COMMUNITY', 'DONOR', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'DORMANT', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'MESSAGE', 'EVENT', 'NOTE', 'INTRO');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('SPONSORSHIP', 'PARTNERSHIP', 'GRANT', 'IN_KIND', 'VENUE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRoute" AS ENUM ('ORG_CARD', 'INVOICE', 'REIMBURSE');

-- CreateEnum
CREATE TYPE "RecurrenceCreateMode" AS ENUM ('ON_SCHEDULE', 'ON_COMPLETION');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('BLOCKS', 'RELATES', 'DUPLICATES');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FormVisibility" AS ENUM ('INTERNAL', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NEW', 'TRIAGED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'DONE');

-- CreateEnum
CREATE TYPE "KeyResultMetric" AS ENUM ('NUMBER', 'PERCENT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('PROJECT', 'TASK', 'DOC', 'MEETING', 'CHECKLIST', 'FORM');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Rsvp" AS ENUM ('PENDING', 'YES', 'NO', 'MAYBE');

-- CreateEnum
CREATE TYPE "AgendaItemStatus" AS ENUM ('OPEN', 'DISCUSSED', 'CARRIED_OVER');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'DECIDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PollType" AS ENUM ('SINGLE', 'MULTI', 'RANKED', 'YES_NO_ABSTAIN', 'SCHEDULING');

-- CreateEnum
CREATE TYPE "PollResultsVisibility" AS ENUM ('LIVE', 'AFTER_CLOSE');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'PLANNED', 'DONE', 'DECLINED');

-- CreateEnum
CREATE TYPE "ChangelogAudience" AS ENUM ('INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('DELETE', 'ANONYMISE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('HTTP', 'TCP', 'PING', 'DNS', 'TLS_CERT', 'DOMAIN_EXPIRY', 'HEARTBEAT', 'POSTGRES', 'REDIS', 'CLOUD_RESOURCE', 'PROMQL');

-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('PENDING', 'UP', 'DEGRADED', 'DOWN', 'PAUSED', 'MAINTENANCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "IncidentImpact" AS ENUM ('NONE', 'MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RollupGranularity" AS ENUM ('HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "HeartbeatPingKind" AS ENUM ('SUCCESS', 'START', 'FAIL', 'EXIT', 'LOG');

-- CreateEnum
CREATE TYPE "OnCallRotation" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CloudProviderKind" AS ENUM ('DIGITALOCEAN', 'AWS', 'RENDER', 'CLOUDFLARE', 'HETZNER', 'VERCEL', 'NETLIFY', 'FLY', 'RAILWAY', 'GITHUB_ACTIONS', 'PROMETHEUS');

-- CreateEnum
CREATE TYPE "CloudResourceStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'STOPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CostGranularity" AS ENUM ('DAY', 'MONTH', 'MTD', 'FORECAST', 'BALANCE');

-- CreateEnum
CREATE TYPE "MessagingProvider" AS ENUM ('SLACK', 'DISCORD', 'MATTERMOST', 'TELEGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "DestinationKind" AS ENUM ('IN_APP_USERS', 'WORKSPACE_CHANNEL', 'EMAIL', 'SLACK', 'DISCORD', 'MATTERMOST', 'TELEGRAM', 'WHATSAPP', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "DestinationHealth" AS ENUM ('UNKNOWN', 'OK', 'ERROR');

-- CreateEnum
CREATE TYPE "PersonalChannel" AS ENUM ('IN_APP', 'EMAIL', 'TELEGRAM_DM', 'SLACK_DM', 'DISCORD_DM', 'MATTERMOST_DM', 'WHATSAPP_DM');

-- CreateEnum
CREATE TYPE "NotifySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY', 'OFF');

-- CreateEnum
CREATE TYPE "RuleScopeType" AS ENUM ('WORKSPACE', 'MONITOR', 'INCIDENT', 'PROJECT', 'DIGEST', 'ANNOUNCEMENT', 'FORM', 'CALENDAR', 'SUBSCRIPTION', 'COST_BUDGET', 'CLOUD_CONNECTION', 'GITHUB_REPO', 'SERVICE_CATALOG_ITEM', 'BOARDROOM', 'BUDGET', 'MEETING');

-- CreateEnum
CREATE TYPE "LinkCodePurpose" AS ENUM ('IDENTITY', 'DESTINATION');

-- CreateEnum
CREATE TYPE "BridgeDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'BOTH');

-- CreateEnum
CREATE TYPE "BridgeOrigin" AS ENUM ('WORKSPACE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "InboundEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'WAITLIST';

-- DropForeignKey
ALTER TABLE "TelegramLink" DROP CONSTRAINT "TelegramLink_userId_fkey";

-- DropForeignKey
ALTER TABLE "TelegramLink" DROP CONSTRAINT "TelegramLink_workspaceId_fkey";

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "CommunityEvent" ADD COLUMN     "capacity" INTEGER;

-- AlterTable
ALTER TABLE "Doc" ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifiedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "budgetId" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "origin" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cyclesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cycleId" TEXT,
ADD COLUMN     "recurrenceId" TEXT,
ADD COLUMN     "sourceMeetingId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "costsVisibleToMembers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'en-IN',
ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "membersCanAckIncidents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monitorRetentionDays" INTEGER NOT NULL DEFAULT 14;

-- DropTable
DROP TABLE "TelegramLink";

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "visibility" "TeamVisibility" NOT NULL DEFAULT 'PUBLIC',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "policyId" TEXT,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT,
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "teamId" TEXT,
    "projectId" TEXT,
    "channelId" TEXT,
    "ownerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce("body", '')), 'B')) STORED,

    CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "verb" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "teamId" TEXT,
    "projectId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'LIST',
    "ownerId" TEXT NOT NULL,
    "shared" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "teamId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teamId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" INTEGER,
    "checkedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipType" "MembershipType" NOT NULL DEFAULT 'MEMBER',
    "location" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handles" JSONB NOT NULL DEFAULT '{}',
    "weeklyAvailability" JSONB,
    "isKeyholder" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContactEnc" TEXT,
    "emergencyUpdatedAt" TIMESTAMP(3),
    "leavingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberSkill" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MemberSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT,
    "items" JSONB NOT NULL,
    "autoStartFor" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" "ChecklistKind" NOT NULL,
    "title" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "status" "ChecklistRunStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AvailabilityType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT,
    "color" TEXT,
    "defaultCapacity" INTEGER NOT NULL DEFAULT 1,
    "requiresCertTypeId" TEXT,
    "requiresKeyholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" TEXT,
    "calendarEventId" TEXT,
    "seriesId" TEXT,
    "rrule" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ShiftAssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "checkedInAt" TIMESTAMP(3),
    "hoursCenti" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT,
    "status" "ShiftSwapStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validityDays" INTEGER,
    "trainerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trainerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "certTypeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "evidenceFileId" TEXT,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "description" TEXT,
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "ServiceEnv" NOT NULL DEFAULT 'PROD',
    "criticality" "Criticality" NOT NULL DEFAULT 'TIER2',
    "lifecycle" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "backupOwnerId" TEXT,
    "teamId" TEXT,
    "vendorOrgId" TEXT,
    "runbookDocId" TEXT,
    "supportNotesMd" TEXT,
    "dataClass" "DataClass",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costMinor" INTEGER,
    "costCurrency" TEXT,
    "costPeriod" "BillingPeriod",
    "renewalAt" TIMESTAMP(3),
    "cachedStatus" "MonitorStatus",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceLink" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "targetType" "ServiceLinkTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "ServiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDependency" (
    "dependentId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,

    CONSTRAINT "ServiceDependency_pkey" PRIMARY KEY ("dependentId","dependencyId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SubscriptionKind" NOT NULL,
    "vendorOrgId" TEXT,
    "plan" TEXT,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "period" "BillingPeriod" NOT NULL,
    "nextRenewalAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "cancellationNoticeDays" INTEGER,
    "paymentMethodLabel" TEXT,
    "payer" TEXT,
    "ownerId" TEXT,
    "teamId" TEXT,
    "serviceId" TEXT,
    "vaultItemId" TEXT,
    "contractFileId" TEXT,
    "reminderOffsets" INTEGER[] DEFAULT ARRAY[30, 7, 1]::INTEGER[],
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "lastRemindedFor" TIMESTAMP(3),
    "lastReminderOffset" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultCollection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "collectionId" TEXT,
    "type" "VaultItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "username" TEXT,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "sensitivity" "VaultSensitivity" NOT NULL DEFAULT 'NORMAL',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT NOT NULL,
    "rotateEveryDays" INTEGER,
    "lastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VaultItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultItemVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "dataKeyEnc" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "collectionId" TEXT,
    "itemId" TEXT,
    "principalType" "PrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "permission" "VaultPermission" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAccessRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "permission" "VaultPermission" NOT NULL DEFAULT 'REVEAL',
    "reason" TEXT,
    "durationHours" INTEGER NOT NULL DEFAULT 24,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "VaultAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAccessLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "VaultAccessAction" NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT,
    "ownerLabel" TEXT,
    "ownerUserId" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATE,
    "purchasePriceMinor" INTEGER,
    "currency" TEXT,
    "ledgerEntryId" TEXT,
    "photoFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manualDocId" TEXT,
    "requiresCertTypeId" TEXT,
    "checkoutable" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT false,
    "maxCheckoutDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCheckout" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "notes" TEXT,
    "lastRemindedAt" TIMESTAMP(3),

    CONSTRAINT "AssetCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetBooking" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "purpose" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMaintenanceLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "MaintenanceLogType" NOT NULL,
    "note" TEXT NOT NULL,
    "costMinor" INTEGER,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueAt" TIMESTAMP(3),

    CONSTRAINT "AssetMaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "AccessCredentialType" NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT,
    "holderUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "status" "AccessCredentialStatus" NOT NULL DEFAULT 'IN_SAFE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" "OrgKind"[] DEFAULT ARRAY[]::"OrgKind"[],
    "website" TEXT,
    "domain" TEXT,
    "address" TEXT,
    "registrationId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "teamId" TEXT,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "notesMd" TEXT,
    "socials" JSONB NOT NULL DEFAULT '{}',
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "lastInteractionAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT NOT NULL,
    "pronouns" TEXT,
    "emails" JSONB NOT NULL DEFAULT '[]',
    "phones" JSONB NOT NULL DEFAULT '[]',
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "teamId" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "preferredChannel" TEXT,
    "timezone" TEXT,
    "handles" JSONB NOT NULL DEFAULT '{}',
    "consentStatus" TEXT,
    "consentSource" TEXT,
    "consentAt" TIMESTAMP(3),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "notesMd" TEXT,
    "birthday" DATE,
    "lastInteractionAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactOrgRole" (
    "contactId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ContactOrgRole_pkey" PRIMARY KEY ("contactId","organisationId")
);

-- CreateTable
CREATE TABLE "ContactInteraction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "organisationId" TEXT,
    "type" "InteractionType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "bodyMd" TEXT,
    "byUserId" TEXT,
    "attendeeUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meetingId" TEXT,
    "followUpTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "stage" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "probability" INTEGER,
    "expectedCloseAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "eventId" TEXT,
    "invoiceId" TEXT,
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT,
    "projectId" TEXT,
    "eventId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thresholdsPct" INTEGER[] DEFAULT ARRAY[50, 80, 100]::INTEGER[],
    "notifiedPct" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT,
    "items" JSONB NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "vendorOrgId" TEXT,
    "budgetId" TEXT,
    "teamId" TEXT,
    "projectId" TEXT,
    "eventId" TEXT,
    "neededBy" DATE,
    "paymentRoute" "PaymentRoute" NOT NULL DEFAULT 'ORG_CARD',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ledgerEntryId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "purchaseRequestId" TEXT,
    "budgetId" TEXT,
    "teamId" TEXT,
    "items" JSONB NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "receiptFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "payoutReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "ledgerEntryId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateTaskId" TEXT NOT NULL,
    "rrule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createMode" "RecurrenceCreateMode" NOT NULL DEFAULT 'ON_SCHEDULE',
    "assigneeRule" JSONB NOT NULL,
    "dueOffsetDays" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "lastCreatedTaskId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "recurrenceId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("recurrenceId","occurrenceDate")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "workspaceId" TEXT NOT NULL,
    "blockingTaskId" TEXT NOT NULL,
    "blockedTaskId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'BLOCKS',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("blockingTaskId","blockedTaskId")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "teamId" TEXT,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "goal" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "visibility" "FormVisibility" NOT NULL DEFAULT 'INTERNAL',
    "publicSlug" TEXT,
    "captcha" BOOLEAN NOT NULL DEFAULT false,
    "destination" JSONB NOT NULL DEFAULT '{"type":"NONE"}',
    "approvalPolicyId" TEXT,
    "ownerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teamId" TEXT,
    "closesAt" TIMESTAMP(3),
    "maxResponses" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "submitterUserId" TEXT,
    "submitterEmail" TEXT,
    "ipHash" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "linkedType" TEXT,
    "linkedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "teamId" TEXT,
    "parentGoalId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ON_TRACK',
    "lastCheckInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metricType" "KeyResultMetric" NOT NULL DEFAULT 'NUMBER',
    "start" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "checkIns" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "teamId" TEXT,
    "scope" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seriesId" TEXT,
    "rrule" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "teamId" TEXT,
    "calendarEventId" TEXT,
    "notesDocId" TEXT,
    "facilitatorId" TEXT,
    "noteTakerId" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "visibility" "Visibility" NOT NULL DEFAULT 'TEAM',
    "summaryPublishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "rsvp" "Rsvp" NOT NULL DEFAULT 'PENDING',
    "attended" BOOLEAN,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "durationMin" INTEGER,
    "notesMd" TEXT,
    "status" "AgendaItemStatus" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "carriedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT,
    "pollId" TEXT,
    "title" TEXT NOT NULL,
    "contextMd" TEXT,
    "decisionMd" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'DECIDED',
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deciderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supersededById" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teamId" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "meetingId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("meetingId","taskId")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "type" "PollType" NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "resultsVisibility" "PollResultsVisibility" NOT NULL DEFAULT 'AFTER_CLOSE',
    "eligibility" JSONB NOT NULL DEFAULT '{"type":"ALL_MEMBERS"}',
    "quorum" JSONB,
    "passThreshold" TEXT,
    "isMotion" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT,
    "meetingId" TEXT,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "outcome" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "voterId" TEXT,
    "choice" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollBallotReceipt" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollBallotReceipt_pkey" PRIMARY KEY ("pollId","userId")
);

-- CreateTable
CREATE TABLE "CalendarFeedToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docRevisionId" TEXT,
    "contentHash" TEXT NOT NULL,
    "signerUserId" TEXT,
    "signerEmail" TEXT,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "typedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "pdfFileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMd" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
    "authorId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "convertedType" TEXT,
    "convertedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaVote" (
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaVote_pkey" PRIMARY KEY ("ideaId","userId")
);

-- CreateTable
CREATE TABLE "ChangelogEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "version" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" "ChangelogAudience" NOT NULL DEFAULT 'INTERNAL',
    "serviceId" TEXT,
    "githubReleaseId" TEXT,
    "blogPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangelogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "contentType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT,
    "scope" JSONB NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'ZIP_JSON',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT,
    "entityType" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "stats" JSONB,
    "errorFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "location" TEXT,
    "checksum" TEXT,
    "error" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "keepDays" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'DELETE',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultRole" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectId" TEXT,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MAJOR',
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT,
    "heartbeatTokenHash" TEXT,
    "heartbeatTokenHint" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 60,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "retries" INTEGER NOT NULL DEFAULT 1,
    "retryIntervalSec" INTEGER NOT NULL DEFAULT 20,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "successThreshold" INTEGER NOT NULL DEFAULT 2,
    "degradedLatencyMs" INTEGER,
    "incidentOnDegraded" BOOLEAN NOT NULL DEFAULT false,
    "reminderIntervalMin" INTEGER NOT NULL DEFAULT 60,
    "useWorkspaceRules" BOOLEAN NOT NULL DEFAULT true,
    "cloudResourceId" TEXT,
    "lastStatus" "MonitorStatus" NOT NULL DEFAULT 'PENDING',
    "lastCheckedAt" TIMESTAMP(3),
    "lastLatencyMs" INTEGER,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
    "flapping" BOOLEAN NOT NULL DEFAULT false,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "expectedNextAt" TIMESTAMP(3),
    "lastPingAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCheck" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MonitorStatus" NOT NULL,
    "latencyMs" INTEGER,
    "statusCode" INTEGER,
    "error" TEXT,
    "message" TEXT,
    "inMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,

    CONSTRAINT "MonitorCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorRollup" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "granularity" "RollupGranularity" NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "up" INTEGER NOT NULL,
    "degraded" INTEGER NOT NULL,
    "down" INTEGER NOT NULL,
    "maintenance" INTEGER NOT NULL,
    "downtimeSec" INTEGER NOT NULL,
    "latencyAvg" DOUBLE PRECISION,
    "latencyMin" INTEGER,
    "latencyMax" INTEGER,
    "latencyP50" INTEGER,
    "latencyP95" INTEGER,

    CONSTRAINT "MonitorRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatPing" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "HeartbeatPingKind" NOT NULL,
    "exitCode" INTEGER,
    "runId" TEXT,
    "durationMs" INTEGER,
    "sourceIp" TEXT,
    "body" TEXT,

    CONSTRAINT "HeartbeatPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "source" "IncidentSource" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "impact" "IncidentImpact" NOT NULL DEFAULT 'MAJOR',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MAJOR',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "firstCheckId" TEXT,
    "escalationPolicyId" TEXT,
    "escalationStep" INTEGER NOT NULL DEFAULT 0,
    "nextEscalationAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "postmortemMd" TEXT,
    "postmortemDocId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentMonitor" (
    "incidentId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,

    CONSTRAINT "IncidentMonitor_pkey" PRIMARY KEY ("incidentId","monitorId")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "rrule" TEXT,
    "durationMin" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "allMonitors" BOOLEAN NOT NULL DEFAULT false,
    "suppressAlerts" BOOLEAN NOT NULL DEFAULT true,
    "showOnStatusPage" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWindowMonitor" (
    "maintenanceWindowId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,

    CONSTRAINT "MaintenanceWindowMonitor_pkey" PRIMARY KEY ("maintenanceWindowId","monitorId")
);

-- CreateTable
CREATE TABLE "OnCallSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "rotation" "OnCallRotation" NOT NULL DEFAULT 'WEEKLY',
    "handoffTime" TEXT NOT NULL DEFAULT '09:00',
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overrides" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "repeat" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorNetworkAllowlist" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cidrOrHost" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorNetworkAllowlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "CloudProviderKind" NOT NULL,
    "label" TEXT NOT NULL,
    "accountLabel" TEXT,
    "credentialsEnc" TEXT NOT NULL,
    "credentialsHint" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastCostSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudResource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "status" "CloudResourceStatus" NOT NULL,
    "statusDetail" TEXT,
    "url" TEXT,
    "raw" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "goneAt" TIMESTAMP(3),

    CONSTRAINT "CloudResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudMetricSample" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CloudMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "granularity" "CostGranularity" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "breakdown" JSONB,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostBudget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT,
    "monthlyLimitMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "thresholdsPct" INTEGER[] DEFAULT ARRAY[50, 80, 100]::INTEGER[],
    "notifiedPct" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "logoFileId" TEXT,
    "accentToken" TEXT,
    "showUptimePercent" BOOLEAN NOT NULL DEFAULT true,
    "showPastIncidentsDays" INTEGER NOT NULL DEFAULT 14,
    "footerMd" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageComponent" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "group" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showLatency" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StatusPageComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "credentialsHint" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "botExternalId" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDestination" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DestinationKind" NOT NULL,
    "connectionId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "health" "DestinationHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastDeliveryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT,
    "scopeType" "RuleScopeType" NOT NULL DEFAULT 'WORKSPACE',
    "scopeId" TEXT,
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minSeverity" "NotifySeverity" NOT NULL DEFAULT 'INFO',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "quietHours" JSONB,
    "criticalBypassesQuiet" BOOLEAN NOT NULL DEFAULT true,
    "dedupeWindowSec" INTEGER NOT NULL DEFAULT 300,
    "reminderIntervalMin" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRuleDestination" (
    "ruleId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,

    CONSTRAINT "NotificationRuleDestination_pkey" PRIMARY KEY ("ruleId","destinationId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL,
    "channels" "PersonalChannel"[] DEFAULT ARRAY[]::"PersonalChannel"[],
    "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'IMMEDIATE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationUserSettings" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quietHours" JSONB,
    "criticalBypassesQuiet" BOOLEAN NOT NULL DEFAULT true,
    "snoozedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationUserSettings_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "NotificationMute" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEventRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotifySeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "threadKey" TEXT,
    "reminderOf" TEXT,
    "actorId" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "destinationId" TEXT,
    "userId" TEXT,
    "personalChannel" "PersonalChannel",
    "ruleId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "threadKey" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDigestItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "PersonalChannel" NOT NULL,
    "eventId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDigestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentityLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "externalUsername" TEXT,
    "dmChannelId" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "optInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "connectionId" TEXT,
    "purpose" "LinkCodePurpose" NOT NULL DEFAULT 'IDENTITY',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgedChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceChannelId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalChannelId" TEXT NOT NULL,
    "externalChannelName" TEXT,
    "direction" "BridgeDirection" NOT NULL DEFAULT 'BOTH',
    "mirrorEdits" BOOLEAN NOT NULL DEFAULT true,
    "mirrorDeletes" BOOLEAN NOT NULL DEFAULT false,
    "includeThreads" BOOLEAN NOT NULL DEFAULT true,
    "attachmentMode" TEXT NOT NULL DEFAULT 'LINK',
    "outboundWebhookEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgedMessage" (
    "id" TEXT NOT NULL,
    "bridgedChannelId" TEXT NOT NULL,
    "workspaceMessageId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "originSide" "BridgeOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "InboundEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingConversation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assistantConversationId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Team_workspaceId_archivedAt_idx" ON "Team"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_slug_key" ON "Team"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_workspaceId_subjectType_idx" ON "ApprovalPolicy"("workspaceId", "subjectType");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_status_createdAt_idx" ON "ApprovalRequest"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_workspaceId_subjectType_subjectId_key" ON "ApprovalRequest"("workspaceId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_step_approverId_key" ON "ApprovalDecision"("requestId", "step", "approverId");

-- CreateIndex
CREATE INDEX "RecordLink_workspaceId_toType_toId_idx" ON "RecordLink"("workspaceId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordLink_workspaceId_fromType_fromId_toType_toId_key" ON "RecordLink"("workspaceId", "fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE INDEX "SearchDocument_workspaceId_entityType_idx" ON "SearchDocument"("workspaceId", "entityType");

-- CreateIndex
CREATE INDEX "SearchDocument_searchVector_idx" ON "SearchDocument" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "SearchDocument_title_trgm_idx" ON "SearchDocument" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "SearchDocument_entityType_entityId_key" ON "SearchDocument"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityEvent_workspaceId_createdAt_idx" ON "ActivityEvent"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_entityType_entityId_createdAt_idx" ON "ActivityEvent"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SavedView_workspaceId_entityType_idx" ON "SavedView"("workspaceId", "entityType");

-- CreateIndex
CREATE INDEX "SavedView_ownerId_idx" ON "SavedView"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_workspaceId_userId_entityType_entityId_key" ON "Bookmark"("workspaceId", "userId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "LinkItem_workspaceId_pinned_idx" ON "LinkItem"("workspaceId", "pinned");

-- CreateIndex
CREATE INDEX "MemberProfile_workspaceId_membershipType_idx" ON "MemberProfile"("workspaceId", "membershipType");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfile_workspaceId_userId_key" ON "MemberProfile"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "MemberSkill_workspaceId_skill_idx" ON "MemberSkill"("workspaceId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSkill_profileId_skill_key" ON "MemberSkill"("profileId", "skill");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_workspaceId_kind_idx" ON "ChecklistTemplate"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "ChecklistRun_workspaceId_status_idx" ON "ChecklistRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ChecklistRun_subjectUserId_idx" ON "ChecklistRun"("subjectUserId");

-- CreateIndex
CREATE INDEX "ChecklistRunItem_runId_sortOrder_idx" ON "ChecklistRunItem"("runId", "sortOrder");

-- CreateIndex
CREATE INDEX "ChecklistRunItem_assigneeId_doneAt_idx" ON "ChecklistRunItem"("assigneeId", "doneAt");

-- CreateIndex
CREATE INDEX "Availability_workspaceId_startsAt_endsAt_idx" ON "Availability"("workspaceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Availability_userId_startsAt_idx" ON "Availability"("userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftType_workspaceId_name_key" ON "ShiftType"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Shift_workspaceId_startsAt_idx" ON "Shift"("workspaceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_seriesId_startsAt_key" ON "Shift"("seriesId", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftAssignment_userId_status_idx" ON "ShiftAssignment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_shiftId_userId_key" ON "ShiftAssignment"("shiftId", "userId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_assignmentId_status_idx" ON "ShiftSwapRequest"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CertType_workspaceId_name_key" ON "CertType"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Certification_userId_idx" ON "Certification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_certTypeId_userId_grantedAt_key" ON "Certification"("certTypeId", "userId", "grantedAt");

-- CreateIndex
CREATE INDEX "ServiceCatalogItem_workspaceId_criticality_idx" ON "ServiceCatalogItem"("workspaceId", "criticality");

-- CreateIndex
CREATE INDEX "ServiceCatalogItem_workspaceId_teamId_idx" ON "ServiceCatalogItem"("workspaceId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogItem_workspaceId_slug_key" ON "ServiceCatalogItem"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "ServiceLink_targetType_targetId_idx" ON "ServiceLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLink_serviceId_targetType_targetId_key" ON "ServiceLink"("serviceId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ServiceDependency_dependencyId_idx" ON "ServiceDependency"("dependencyId");

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_nextRenewalAt_idx" ON "Subscription"("workspaceId", "nextRenewalAt");

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_status_idx" ON "Subscription"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VaultCollection_workspaceId_name_key" ON "VaultCollection"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "VaultItem_workspaceId_collectionId_idx" ON "VaultItem"("workspaceId", "collectionId");

-- CreateIndex
CREATE INDEX "VaultItem_workspaceId_deletedAt_idx" ON "VaultItem"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "VaultItemVersion_itemId_createdAt_idx" ON "VaultItemVersion"("itemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VaultGrant_workspaceId_principalType_principalId_idx" ON "VaultGrant"("workspaceId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "VaultGrant_collectionId_idx" ON "VaultGrant"("collectionId");

-- CreateIndex
CREATE INDEX "VaultGrant_itemId_idx" ON "VaultGrant"("itemId");

-- CreateIndex
CREATE INDEX "VaultAccessRequest_workspaceId_status_idx" ON "VaultAccessRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "VaultAccessRequest_requesterId_idx" ON "VaultAccessRequest"("requesterId");

-- CreateIndex
CREATE INDEX "VaultAccessLog_itemId_createdAt_idx" ON "VaultAccessLog"("itemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VaultAccessLog_workspaceId_userId_createdAt_idx" ON "VaultAccessLog"("workspaceId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Asset_workspaceId_status_idx" ON "Asset"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_workspaceId_tag_key" ON "Asset"("workspaceId", "tag");

-- CreateIndex
CREATE INDEX "AssetCheckout_assetId_returnedAt_idx" ON "AssetCheckout"("assetId", "returnedAt");

-- CreateIndex
CREATE INDEX "AssetCheckout_userId_returnedAt_idx" ON "AssetCheckout"("userId", "returnedAt");

-- CreateIndex
CREATE INDEX "AssetBooking_assetId_startsAt_endsAt_idx" ON "AssetBooking"("assetId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "AssetBooking_userId_startsAt_idx" ON "AssetBooking"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "AssetMaintenanceLog_assetId_at_idx" ON "AssetMaintenanceLog"("assetId", "at");

-- CreateIndex
CREATE INDEX "AccessCredential_workspaceId_holderUserId_idx" ON "AccessCredential"("workspaceId", "holderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCredential_workspaceId_label_key" ON "AccessCredential"("workspaceId", "label");

-- CreateIndex
CREATE INDEX "Organisation_workspaceId_name_idx" ON "Organisation"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Organisation_workspaceId_domain_idx" ON "Organisation"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_displayName_idx" ON "Contact"("workspaceId", "displayName");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_ownerId_idx" ON "Contact"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_nextFollowUpAt_idx" ON "Contact"("workspaceId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "ContactOrgRole_organisationId_idx" ON "ContactOrgRole"("organisationId");

-- CreateIndex
CREATE INDEX "ContactInteraction_contactId_occurredAt_idx" ON "ContactInteraction"("contactId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ContactInteraction_organisationId_occurredAt_idx" ON "ContactInteraction"("organisationId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ContactInteraction_workspaceId_occurredAt_idx" ON "ContactInteraction"("workspaceId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Deal_workspaceId_stage_idx" ON "Deal"("workspaceId", "stage");

-- CreateIndex
CREATE INDEX "Budget_workspaceId_periodStart_idx" ON "Budget"("workspaceId", "periodStart");

-- CreateIndex
CREATE INDEX "PurchaseRequest_workspaceId_status_idx" ON "PurchaseRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_requesterId_idx" ON "PurchaseRequest"("requesterId");

-- CreateIndex
CREATE INDEX "Reimbursement_workspaceId_status_idx" ON "Reimbursement"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Reimbursement_claimantId_idx" ON "Reimbursement"("claimantId");

-- CreateIndex
CREATE INDEX "TaskRecurrence_active_nextRunAt_idx" ON "TaskRecurrence"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "TaskRecurrence_workspaceId_idx" ON "TaskRecurrence"("workspaceId");

-- CreateIndex
CREATE INDEX "TaskOccurrence_taskId_idx" ON "TaskOccurrence"("taskId");

-- CreateIndex
CREATE INDEX "TaskDependency_blockedTaskId_idx" ON "TaskDependency"("blockedTaskId");

-- CreateIndex
CREATE INDEX "TaskDependency_workspaceId_idx" ON "TaskDependency"("workspaceId");

-- CreateIndex
CREATE INDEX "Cycle_workspaceId_status_idx" ON "Cycle"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_projectId_number_key" ON "Cycle"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicSlug_key" ON "Form"("publicSlug");

-- CreateIndex
CREATE INDEX "Form_workspaceId_idx" ON "Form"("workspaceId");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_status_createdAt_idx" ON "FormSubmission"("formId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Goal_workspaceId_periodStart_idx" ON "Goal"("workspaceId", "periodStart");

-- CreateIndex
CREATE INDEX "KeyResult_goalId_sortOrder_idx" ON "KeyResult"("goalId", "sortOrder");

-- CreateIndex
CREATE INDEX "Template_workspaceId_kind_idx" ON "Template"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_startsAt_idx" ON "Meeting"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_seriesId_startsAt_idx" ON "Meeting"("seriesId", "startsAt");

-- CreateIndex
CREATE INDEX "MeetingAttendee_userId_idx" ON "MeetingAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendee_meetingId_userId_key" ON "MeetingAttendee"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "AgendaItem_meetingId_sortOrder_idx" ON "AgendaItem"("meetingId", "sortOrder");

-- CreateIndex
CREATE INDEX "Decision_workspaceId_decidedAt_idx" ON "Decision"("workspaceId", "decidedAt" DESC);

-- CreateIndex
CREATE INDEX "MeetingActionItem_taskId_idx" ON "MeetingActionItem"("taskId");

-- CreateIndex
CREATE INDEX "Poll_workspaceId_closesAt_idx" ON "Poll"("workspaceId", "closesAt");

-- CreateIndex
CREATE INDEX "PollOption_pollId_sortOrder_idx" ON "PollOption"("pollId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_voterId_key" ON "PollVote"("pollId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_tokenHash_key" ON "CalendarFeedToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CalendarFeedToken_workspaceId_userId_idx" ON "CalendarFeedToken"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "SignatureRequest_workspaceId_status_idx" ON "SignatureRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SignatureRequest_signerUserId_idx" ON "SignatureRequest"("signerUserId");

-- CreateIndex
CREATE INDEX "Idea_workspaceId_status_idx" ON "Idea"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangelogEntry_githubReleaseId_key" ON "ChangelogEntry"("githubReleaseId");

-- CreateIndex
CREATE INDEX "ChangelogEntry_workspaceId_publishedAt_idx" ON "ChangelogEntry"("workspaceId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_storageKey_key" ON "FileVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_version_key" ON "FileVersion"("fileId", "version");

-- CreateIndex
CREATE INDEX "ExportJob_workspaceId_createdAt_idx" ON "ExportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_createdAt_idx" ON "ImportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRun_kind_startedAt_idx" ON "BackupRun"("kind", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_workspaceId_entityType_key" ON "RetentionPolicy"("workspaceId", "entityType");

-- CreateIndex
CREATE INDEX "SsoProvider_workspaceId_idx" ON "SsoProvider"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_heartbeatTokenHash_key" ON "Monitor"("heartbeatTokenHash");

-- CreateIndex
CREATE INDEX "Monitor_workspaceId_enabled_idx" ON "Monitor"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "Monitor_enabled_nextCheckAt_idx" ON "Monitor"("enabled", "nextCheckAt");

-- CreateIndex
CREATE INDEX "Monitor_type_expectedNextAt_idx" ON "Monitor"("type", "expectedNextAt");

-- CreateIndex
CREATE INDEX "MonitorCheck_monitorId_checkedAt_idx" ON "MonitorCheck"("monitorId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "MonitorCheck_workspaceId_checkedAt_idx" ON "MonitorCheck"("workspaceId", "checkedAt");

-- CreateIndex
CREATE INDEX "MonitorCheck_checkedAt_idx" ON "MonitorCheck" USING BRIN ("checkedAt");

-- CreateIndex
CREATE INDEX "MonitorRollup_workspaceId_granularity_bucketStart_idx" ON "MonitorRollup"("workspaceId", "granularity", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorRollup_monitorId_granularity_bucketStart_key" ON "MonitorRollup"("monitorId", "granularity", "bucketStart");

-- CreateIndex
CREATE INDEX "HeartbeatPing_monitorId_receivedAt_idx" ON "HeartbeatPing"("monitorId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_workspaceId_status_startedAt_idx" ON "Incident"("workspaceId", "status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_nextEscalationAt_idx" ON "Incident"("nextEscalationAt");

-- CreateIndex
CREATE INDEX "Incident_nextReminderAt_idx" ON "Incident"("nextReminderAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_workspaceId_number_key" ON "Incident"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "IncidentMonitor_monitorId_idx" ON "IncidentMonitor"("monitorId");

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_createdAt_idx" ON "IncidentUpdate"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindow_workspaceId_startsAt_idx" ON "MaintenanceWindow"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindowMonitor_monitorId_idx" ON "MaintenanceWindowMonitor"("monitorId");

-- CreateIndex
CREATE INDEX "OnCallSchedule_workspaceId_idx" ON "OnCallSchedule"("workspaceId");

-- CreateIndex
CREATE INDEX "EscalationPolicy_workspaceId_idx" ON "EscalationPolicy"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorNetworkAllowlist_workspaceId_cidrOrHost_key" ON "MonitorNetworkAllowlist"("workspaceId", "cidrOrHost");

-- CreateIndex
CREATE INDEX "CloudConnection_workspaceId_provider_idx" ON "CloudConnection"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "CloudConnection_enabled_nextSyncAt_idx" ON "CloudConnection"("enabled", "nextSyncAt");

-- CreateIndex
CREATE INDEX "CloudResource_workspaceId_status_idx" ON "CloudResource"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CloudResource_connectionId_externalId_key" ON "CloudResource"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "CloudMetricSample_ts_idx" ON "CloudMetricSample"("ts");

-- CreateIndex
CREATE UNIQUE INDEX "CloudMetricSample_resourceId_metric_ts_key" ON "CloudMetricSample"("resourceId", "metric", "ts");

-- CreateIndex
CREATE INDEX "CostSnapshot_workspaceId_periodStart_idx" ON "CostSnapshot"("workspaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CostSnapshot_connectionId_granularity_periodStart_key" ON "CostSnapshot"("connectionId", "granularity", "periodStart");

-- CreateIndex
CREATE INDEX "CostBudget_workspaceId_idx" ON "CostBudget"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_workspaceId_key" ON "StatusPage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_slug_key" ON "StatusPage"("slug");

-- CreateIndex
CREATE INDEX "StatusPageComponent_monitorId_idx" ON "StatusPageComponent"("monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageComponent_statusPageId_key_key" ON "StatusPageComponent"("statusPageId", "key");

-- CreateIndex
CREATE INDEX "MessagingConnection_workspaceId_provider_idx" ON "MessagingConnection"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "NotificationDestination_workspaceId_kind_idx" ON "NotificationDestination"("workspaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDestination_workspaceId_name_key" ON "NotificationDestination"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "NotificationRule_workspaceId_enabled_idx" ON "NotificationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_workspaceId_scopeType_scopeId_key" ON "NotificationRule"("workspaceId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "NotificationRuleDestination_destinationId_idx" ON "NotificationRuleDestination"("destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_workspaceId_userId_category_key" ON "NotificationPreference"("workspaceId", "userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMute_workspaceId_userId_resourceType_resourceId_key" ON "NotificationMute"("workspaceId", "userId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "NotificationEventRecord_workspaceId_dedupeKey_createdAt_idx" ON "NotificationEventRecord"("workspaceId", "dedupeKey", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEventRecord_workspaceId_type_createdAt_idx" ON "NotificationEventRecord"("workspaceId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_workspaceId_createdAt_idx" ON "NotificationDelivery"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDelivery_destinationId_threadKey_idx" ON "NotificationDelivery"("destinationId", "threadKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDelivery_eventId_idx" ON "NotificationDelivery"("eventId");

-- CreateIndex
CREATE INDEX "NotificationDigestItem_userId_channel_dueAt_idx" ON "NotificationDigestItem"("userId", "channel", "dueAt");

-- CreateIndex
CREATE INDEX "NotificationDigestItem_workspaceId_sentAt_dueAt_idx" ON "NotificationDigestItem"("workspaceId", "sentAt", "dueAt");

-- CreateIndex
CREATE INDEX "ExternalIdentityLink_workspaceId_userId_idx" ON "ExternalIdentityLink"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentityLink_connectionId_externalUserId_key" ON "ExternalIdentityLink"("connectionId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentityLink_userId_connectionId_key" ON "ExternalIdentityLink"("userId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkCode_codeHash_key" ON "LinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "LinkCode_workspaceId_userId_expiresAt_idx" ON "LinkCode"("workspaceId", "userId", "expiresAt");

-- CreateIndex
CREATE INDEX "LinkCode_expiresAt_idx" ON "LinkCode"("expiresAt");

-- CreateIndex
CREATE INDEX "BridgedChannel_workspaceId_idx" ON "BridgedChannel"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BridgedChannel_connectionId_externalChannelId_key" ON "BridgedChannel"("connectionId", "externalChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "BridgedChannel_workspaceChannelId_connectionId_key" ON "BridgedChannel"("workspaceChannelId", "connectionId");

-- CreateIndex
CREATE INDEX "BridgedMessage_workspaceMessageId_idx" ON "BridgedMessage"("workspaceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "BridgedMessage_bridgedChannelId_externalMessageId_key" ON "BridgedMessage"("bridgedChannelId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "BridgedMessage_bridgedChannelId_workspaceMessageId_key" ON "BridgedMessage"("bridgedChannelId", "workspaceMessageId");

-- CreateIndex
CREATE INDEX "InboundEvent_receivedAt_idx" ON "InboundEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "InboundEvent_status_receivedAt_idx" ON "InboundEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_provider_connectionId_externalEventId_key" ON "InboundEvent"("provider", "connectionId", "externalEventId");

-- CreateIndex
CREATE INDEX "MessagingConversation_assistantConversationId_idx" ON "MessagingConversation"("assistantConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingConversation_connectionId_externalKey_userId_key" ON "MessagingConversation"("connectionId", "externalKey", "userId");

-- CreateIndex
CREATE INDEX "Channel_teamId_idx" ON "Channel"("teamId");

-- CreateIndex
CREATE INDEX "LedgerEntry_budgetId_idx" ON "LedgerEntry"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_sourceType_sourceId_key" ON "LedgerEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");

-- CreateIndex
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");

-- CreateIndex
CREATE INDEX "Task_cycleId_idx" ON "Task"("cycleId");

-- CreateIndex
CREATE INDEX "Task_recurrenceId_idx" ON "Task"("recurrenceId");

-- CreateIndex
CREATE INDEX "Task_sourceMeetingId_idx" ON "Task"("sourceMeetingId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEventRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchDocument" ADD CONSTRAINT "SearchDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkItem" ADD CONSTRAINT "LinkItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSkill" ADD CONSTRAINT "MemberSkill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRunItem" ADD CONSTRAINT "ChecklistRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftType" ADD CONSTRAINT "ShiftType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "ShiftType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CommunityEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertType" ADD CONSTRAINT "CertType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_certTypeId_fkey" FOREIGN KEY ("certTypeId") REFERENCES "CertType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_vendorOrgId_fkey" FOREIGN KEY ("vendorOrgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_runbookDocId_fkey" FOREIGN KEY ("runbookDocId") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLink" ADD CONSTRAINT "ServiceLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_vendorOrgId_fkey" FOREIGN KEY ("vendorOrgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "VaultItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contractFileId_fkey" FOREIGN KEY ("contractFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultCollection" ADD CONSTRAINT "VaultCollection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "VaultCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultItemVersion" ADD CONSTRAINT "VaultItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultGrant" ADD CONSTRAINT "VaultGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultGrant" ADD CONSTRAINT "VaultGrant_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "VaultCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultGrant" ADD CONSTRAINT "VaultGrant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultAccessRequest" ADD CONSTRAINT "VaultAccessRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultAccessRequest" ADD CONSTRAINT "VaultAccessRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultAccessLog" ADD CONSTRAINT "VaultAccessLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_manualDocId_fkey" FOREIGN KEY ("manualDocId") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_requiresCertTypeId_fkey" FOREIGN KEY ("requiresCertTypeId") REFERENCES "CertType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCheckout" ADD CONSTRAINT "AssetCheckout_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetBooking" ADD CONSTRAINT "AssetBooking_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenanceLog" ADD CONSTRAINT "AssetMaintenanceLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCredential" ADD CONSTRAINT "AccessCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactOrgRole" ADD CONSTRAINT "ContactOrgRole_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactOrgRole" ADD CONSTRAINT "ContactOrgRole_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_vendorOrgId_fkey" FOREIGN KEY ("vendorOrgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_templateTaskId_fkey" FOREIGN KEY ("templateTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockingTaskId_fkey" FOREIGN KEY ("blockingTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockedTaskId_fkey" FOREIGN KEY ("blockedTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CommunityEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_notesDocId_fkey" FOREIGN KEY ("notesDocId") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollBallotReceipt" ADD CONSTRAINT "PollBallotReceipt_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollBallotReceipt" ADD CONSTRAINT "PollBallotReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_docId_fkey" FOREIGN KEY ("docId") REFERENCES "Doc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaVote" ADD CONSTRAINT "IdeaVote_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaVote" ADD CONSTRAINT "IdeaVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangelogEntry" ADD CONSTRAINT "ChangelogEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangelogEntry" ADD CONSTRAINT "ChangelogEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_cloudResourceId_fkey" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorCheck" ADD CONSTRAINT "MonitorCheck_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorRollup" ADD CONSTRAINT "MonitorRollup_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatPing" ADD CONSTRAINT "HeartbeatPing_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_postmortemDocId_fkey" FOREIGN KEY ("postmortemDocId") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentMonitor" ADD CONSTRAINT "IncidentMonitor_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentMonitor" ADD CONSTRAINT "IncidentMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowMonitor" ADD CONSTRAINT "MaintenanceWindowMonitor_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowMonitor" ADD CONSTRAINT "MaintenanceWindowMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallSchedule" ADD CONSTRAINT "OnCallSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorNetworkAllowlist" ADD CONSTRAINT "MonitorNetworkAllowlist_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudConnection" ADD CONSTRAINT "CloudConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudResource" ADD CONSTRAINT "CloudResource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudResource" ADD CONSTRAINT "CloudResource_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CloudConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudMetricSample" ADD CONSTRAINT "CloudMetricSample_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CloudResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostSnapshot" ADD CONSTRAINT "CostSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostSnapshot" ADD CONSTRAINT "CostSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CloudConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBudget" ADD CONSTRAINT "CostBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBudget" ADD CONSTRAINT "CostBudget_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CloudConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPage" ADD CONSTRAINT "StatusPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPage" ADD CONSTRAINT "StatusPage_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageComponent" ADD CONSTRAINT "StatusPageComponent_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageComponent" ADD CONSTRAINT "StatusPageComponent_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingConnection" ADD CONSTRAINT "MessagingConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDestination" ADD CONSTRAINT "NotificationDestination_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDestination" ADD CONSTRAINT "NotificationDestination_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRuleDestination" ADD CONSTRAINT "NotificationRuleDestination_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRuleDestination" ADD CONSTRAINT "NotificationRuleDestination_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "NotificationDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationUserSettings" ADD CONSTRAINT "NotificationUserSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationUserSettings" ADD CONSTRAINT "NotificationUserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMute" ADD CONSTRAINT "NotificationMute_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMute" ADD CONSTRAINT "NotificationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEventRecord" ADD CONSTRAINT "NotificationEventRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEventRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "NotificationDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDigestItem" ADD CONSTRAINT "NotificationDigestItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDigestItem" ADD CONSTRAINT "NotificationDigestItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentityLink" ADD CONSTRAINT "ExternalIdentityLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentityLink" ADD CONSTRAINT "ExternalIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentityLink" ADD CONSTRAINT "ExternalIdentityLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCode" ADD CONSTRAINT "LinkCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCode" ADD CONSTRAINT "LinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCode" ADD CONSTRAINT "LinkCode_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgedChannel" ADD CONSTRAINT "BridgedChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgedChannel" ADD CONSTRAINT "BridgedChannel_workspaceChannelId_fkey" FOREIGN KEY ("workspaceChannelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgedChannel" ADD CONSTRAINT "BridgedChannel_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgedMessage" ADD CONSTRAINT "BridgedMessage_bridgedChannelId_fkey" FOREIGN KEY ("bridgedChannelId") REFERENCES "BridgedChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgedMessage" ADD CONSTRAINT "BridgedMessage_workspaceMessageId_fkey" FOREIGN KEY ("workspaceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEvent" ADD CONSTRAINT "InboundEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingConversation" ADD CONSTRAINT "MessagingConversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MessagingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingConversation" ADD CONSTRAINT "MessagingConversation_assistantConversationId_fkey" FOREIGN KEY ("assistantConversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

