import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { backendOrigin, frontendOrigin, gatewaySecret } from "./config";
import { CLIENT_IP_HEADER, GATEWAY_HEADER } from "./peer";

export function trustedFrontendIp(incoming: Headers) {
  const configured = process.env.FRONTEND_TRUSTED_IP_HEADER;
  if (configured !== "x-nf-client-connection-ip" && configured !== "x-real-ip") throw new Error("Configure FRONTEND_TRUSTED_IP_HEADER for the hosting platform.");
  const value = incoming.get(configured)?.trim();
  return value && isIP(value) ? value : "unknown";
}

export async function backendHeaders(incoming?: Headers) {
  const source = incoming ?? await headers();
  const outgoing = new Headers({
    [GATEWAY_HEADER]: gatewaySecret(),
    [CLIENT_IP_HEADER]: trustedFrontendIp(source),
    Origin: frontendOrigin(),
  });
  const cookie = source.get("cookie");
  if (cookie) outgoing.set("cookie", cookie);
  return outgoing;
}

export function backendUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) throw new Error("Invalid backend path.");
  const url = new URL(path, backendOrigin());
  if (url.origin !== backendOrigin()) throw new Error("Invalid backend destination.");
  return url;
}
