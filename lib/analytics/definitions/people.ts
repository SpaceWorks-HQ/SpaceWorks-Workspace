import "server-only";
import type { DefinitionRegistry } from "./registry";
import { people } from "./sources";

export function registerPeople({ add }: DefinitionRegistry) {
  add(
    "headcount",
    "people",
    "Headcount by engagement",
    "Active, enabled people at the selected end date, grouped by engagement. Leavers remain in historical joiner/leaver counts.",
    {
      ...people,
      date: 'coalesce(r."engagementStart",m."joinedAt")',
      snapshot: true,
      label: 'coalesce(nullif(r."engagementType",\'\'),r."membershipType"::text)',
      where:
        'm.status=\'ACTIVE\' AND m.role<>\'GUEST\' AND u."disabledAt" IS NULL AND (r."leavingAt" IS NULL OR r."leavingAt">CURRENT_DATE)',
    },
  );
  add(
    "departments",
    "people",
    "Headcount by department",
    "Current active people by department; missing assignments are shown.",
    {
      ...people,
      date: 'coalesce(r."engagementStart",m."joinedAt")',
      snapshot: true,
      label: "coalesce(dep.name,'Unassigned')",
      where:
        'm.status=\'ACTIVE\' AND m.role<>\'GUEST\' AND u."disabledAt" IS NULL AND (r."leavingAt" IS NULL OR r."leavingAt">CURRENT_DATE)',
    },
  );
  add(
    "joiners",
    "people",
    "Joiners",
    "Engagement start date, falling back to membership join date.",
    {
      ...people,
      date: 'coalesce(r."engagementStart",m."joinedAt")',
      label: 'r."engagementType"',
      gate: "admin",
    },
  );
  add(
    "leavers",
    "people",
    "Leavers",
    "Engagement end date, falling back to the legacy leaving date. Deleted membership histories cannot be reconstructed.",
    {
      ...people,
      date: 'r."leavingAt"',
      label: 'r."engagementType"',
      gate: "admin",
    },
  );
  add(
    "attendance",
    "people",
    "Recorded attendance rate",
    "Present/remote = 1, half-day = 0.5, absent = 0. Only recorded non-leave days are the denominator; missing days are not absence. Restricted to self, direct manager or admin.",
    {
      table: '"AttendanceEntry" r',
      date: 'r."dateOn"',
      dateOnly: true,
      titleSql: "'Attendance '||r.\"dateOn\"::text",
      path: "'/attendance?month='||left(r.\"dateOn\"::text,7)",
      label: 'r."dateOn"::text',
      value:
        "CASE r.status WHEN 'PRESENT' THEN 1 WHEN 'REMOTE' THEN 1 WHEN 'HALF_DAY' THEN 0.5 ELSE 0 END",
      base: "1",
      where: "r.status<>'ON_LEAVE'",
      mode: "rate",
      unit: "percent",
      chart: "calendar",
      permission: "attendance",
      person: 'r."userId"',
      dimensions: { team: "NULL::text" },
    },
  );
  add(
    "hours",
    "people",
    "Approved volunteer hours",
    "Approved manual logs; not rota estimates. Members see their own logs.",
    {
      table: '"VolunteerLog" r',
      join: 'LEFT JOIN "Membership" person_member ON person_member."workspaceId"=r."workspaceId" AND person_member."userId"=r."userId" LEFT JOIN "User" person ON person.id=person_member."userId"',
      date: 'r."startsAt"',
      titleSql: "r.activity",
      path: "'/volunteering/'||r.id",
      where: "r.status='APPROVED'",
      label: "coalesce(person.name,'Former member')",
      value: "r.minutes::numeric/60",
      unit: "hours",
      permission: "volunteer",
      person: 'r."userId"',
      dimensions: { team: "NULL::text" },
    },
  );
  add(
    "hiring",
    "people",
    "Hiring funnel",
    "Current candidate stage for applications received in the period.",
    {
      table: '"HiringCandidate" r',
      date: 'r."createdAt"',
      titleSql: "r.name",
      path: "'/hiring/'||r.id",
      label: "r.stage",
      gate: "admin",
      chart: "funnel",
    },
  );
  add(
    "time-to-hire",
    "people",
    "Time to hire",
    "Days from application to linked onboarding creation. Missing onboarding dates are excluded; updated timestamps are not treated as hiring dates.",
    {
      table: '"HiringCandidate" r',
      join: 'JOIN "ChecklistRun" h ON h.id=r."onboardingRunId" AND h."workspaceId"=r."workspaceId"',
      date: 'h."createdAt"',
      titleSql: "r.name",
      path: "'/hiring/'||r.id",
      label: 'r."openingId"',
      value: 'greatest(0,extract(epoch from(h."createdAt"-r."createdAt"))/86400)',
      base: "1",
      unit: "days",
      mode: "average",
      gate: "admin",
    },
  );
  add(
    "certifications",
    "people",
    "Certification expiry",
    "Unrevoked certifications expiring in the period. Training evidence stays in People.",
    {
      table:
        '(SELECT cr.*, ct."workspaceId" FROM "Certification" cr JOIN "CertType" ct ON ct.id=cr."certTypeId") r',
      join: 'JOIN "CertType" ct ON ct.id=r."certTypeId" AND ct."workspaceId"=r."workspaceId"',
      date: 'r."expiresAt"',
      titleSql: "ct.name",
      path: "'/members/'||r.\"userId\"",
      label: "ct.name",
      where: 'r."revokedAt" IS NULL AND EXISTS(SELECT 1 FROM "Membership" cert_member WHERE cert_member."workspaceId"=r."workspaceId" AND cert_member."userId"=r."userId" AND cert_member.status=\'ACTIVE\')',
    },
  );
}
