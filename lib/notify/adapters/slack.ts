import "server-only";

import { notConfiguredAdapter, type DestinationAdapter } from "@/lib/notify/adapters/types";

/**
 * Slack destinations (SLACK) and the SLACK_DM personal channel.
 *
 * Placeholder: the integrations-messaging build replaces this export with a
 * real adapter (ownership and contract in docs/ROADMAP-BUILD.md). Until then every
 * delivery fails with "not configured" and the destination is marked ERROR.
 */
export const slackAdapter: DestinationAdapter = notConfiguredAdapter("SLACK", "Slack", "SLACK_DM");
