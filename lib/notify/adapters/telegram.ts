import "server-only";

import { notConfiguredAdapter, type DestinationAdapter } from "@/lib/notify/adapters/types";

/**
 * Telegram destinations (TELEGRAM) and the TELEGRAM_DM personal channel.
 *
 * Placeholder: the integrations-messaging build replaces this export with a
 * real adapter (ownership and contract in docs/ROADMAP-BUILD.md). Until then every
 * delivery fails with "not configured" and the destination is marked ERROR.
 */
export const telegramAdapter: DestinationAdapter = notConfiguredAdapter("TELEGRAM", "Telegram", "TELEGRAM_DM");
