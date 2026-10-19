import "server-only";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { Agent } from "undici";
import { isPrivateAddress, privateTargetsAllowed, type Resolver } from "./ssrf";

/** Validate the DNS answer used by the socket, rather than trusting an earlier lookup. */
export function guardedLookup(resolver?: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const resolve = resolver ?? (async (host: string) => (await lookup(host, { all: true, verbatim: true })).map(r => r.address));
    void resolve(hostname).then(addresses => {
      if (!addresses.length || addresses.some(address => !isIP(address) || (!privateTargetsAllowed() && isPrivateAddress(address)))) throw new Error("Private or unresolved target.");
      const candidates = addresses.map(address => ({ address, family: isIP(address) }));
      if (options.all) callback(null, candidates);
      else { const selected = candidates.find(a => !options.family || a.family === options.family) ?? candidates[0]!; callback(null, selected.address, selected.family); }
    }).catch(() => callback(new Error("The webhook host did not resolve to an allowed address."), "", 4));
  };
}

/** Each guarded request has its own socket pool; approved sockets cannot be reused for another target. */
export async function withGuardedFetch<T>(url: string | URL, init: RequestInit, read: (response: Response) => Promise<T>, resolver?: Resolver): Promise<T> {
  const agent = new Agent({ connect: { lookup: guardedLookup(resolver), timeout: 10000 }, connections: 1 });
  try {
    const response = await fetch(url, { ...init, redirect: "manual", dispatcher: agent } as RequestInit);
    return await read(response);
  } finally { await agent.destroy(); }
}
