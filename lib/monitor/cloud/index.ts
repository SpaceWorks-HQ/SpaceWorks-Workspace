import "server-only";
import { awsAdapter } from "./providers/aws";
import { digitalOceanAdapter } from "./providers/digitalocean";
import { restAdapter } from "./providers/rest";
import { VPS_PROVIDERS, vpsAdapter } from "./providers/vps";
import type { CloudProviderKind } from "./types";
export function providerAdapter(provider: CloudProviderKind) {
  return provider === "AWS" ? awsAdapter : provider === "DIGITALOCEAN" ? digitalOceanAdapter : VPS_PROVIDERS.includes(provider) ? vpsAdapter(provider) : restAdapter(provider);
}
