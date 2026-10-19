import "server-only";
import { awsAdapter } from "./providers/aws";
import { digitalOceanAdapter } from "./providers/digitalocean";
import { restAdapter } from "./providers/rest";
import type { CloudProviderKind } from "./types";
export function providerAdapter(provider: CloudProviderKind) {
  return provider === "AWS" ? awsAdapter : provider === "DIGITALOCEAN" ? digitalOceanAdapter : restAdapter(provider);
}
