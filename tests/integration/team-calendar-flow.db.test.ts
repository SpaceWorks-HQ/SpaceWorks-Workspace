import { describe } from "vitest";
import { registerCalendarFixtures } from "./team-calendar-flow/fixtures";
import { registerMeetingInvitationTests } from "./team-calendar-flow/meeting-invitations.cases";
import { registerTaskVisibilityTests } from "./team-calendar-flow/task-visibility.cases";
import { registerRecurrenceAvailabilityTests } from "./team-calendar-flow/recurrence-availability.cases";
import { registerPersonalEntryTests } from "./team-calendar-flow/personal-entries.cases";
import { registerMeetingReminderTests } from "./team-calendar-flow/meeting-reminders.cases";
import { registerCancellationMembershipTests } from "./team-calendar-flow/cancellation-membership.cases";
import { registerGoogleSyncTests } from "./team-calendar-flow/google-sync.cases";

describe.sequential("internal team calendar", () => {
  registerCalendarFixtures();
  registerMeetingInvitationTests();
  registerTaskVisibilityTests();
  registerRecurrenceAvailabilityTests();
  registerPersonalEntryTests();
  registerMeetingReminderTests();
  registerCancellationMembershipTests();
  registerGoogleSyncTests();
});
