import "server-only";
import { createHmac } from "node:crypto";
import type { DestinationAdapter } from "./types";
import { openDestinationSecrets } from "@/lib/integrations/destinationSecrets";
import { requestJson, failToSendResult } from "@/lib/integrations/http";
export const webhookAdapter: DestinationAdapter = {
  kind: "WEBHOOK", label: "Webhook", configured: true,
  async send(input) {
    if (input.target.type !== "destination") return { ok: false, retryable: false, error: "Choose a webhook destination." };
    const secrets = openDestinationSecrets(input.target.destination.secretEnc);
    if (!secrets.webhookUrl || !secrets.signingSecret) return { ok: false, retryable: false, error: "Add the webhook URL and signing secret." };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ id: input.event.id, deliveryId: input.deliveryId, type: input.event.type, test: input.isTest, message: input.message });
    const signature = createHmac("sha256", secrets.signingSecret).update(`${timestamp}.${body}`).digest("hex");
    const result = await requestJson(secrets.webhookUrl, { method: "POST", guard: true, body, label: "Webhook", headers: { "Content-Type": "application/json", "X-SpaceWorks-Event": input.event.type, "X-SpaceWorks-Delivery": input.deliveryId, "X-SpaceWorks-Timestamp": timestamp, "X-SpaceWorks-Signature": `v1=${signature}` } });
    return result.ok ? { ok: true } : failToSendResult(result);
  },
};
