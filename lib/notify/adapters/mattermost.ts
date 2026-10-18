import "server-only";

import { notConfiguredAdapter, type DestinationAdapter } from "@/lib/notify/adapters/types";

/**
 * Mattermost destinations (MATTERMOST) and the MATTERMOST_DM personal channel.
 *
 * Placeholder: the integrations-messaging build replaces this export with a
 * real adapter (ownership and contract in docs/ROADMAP-BUILD.md). Until then every
 * delivery fails with "not configured" and the destination is marked ERROR.
 */
export const mattermostAdapter: DestinationAdapter = notConfiguredAdapter("MATTERMOST", "Mattermost", "MATTERMOST_DM");
