import { createHmac, createPublicKey, verify } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
const fresh = (timestamp: string | null, now: number) => Boolean(timestamp && /^\d{10}$/.test(timestamp) && Math.abs(now / 1000 - Number(timestamp)) <= 300);
export function verifySlack(secret: string, body: string, timestamp: string | null, signature: string | null, now = Date.now()) {
  return Boolean(secret && fresh(timestamp, now) && signature && safeEqual(signature, `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`));
}
export function verifyDiscord(publicKey: string, body: string, timestamp: string | null, signature: string | null, now = Date.now()) {
  if (!fresh(timestamp, now) || !/^[a-f\d]{64}$/i.test(publicKey) || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${timestamp}${body}`), key, Buffer.from(signature, "hex"));
  } catch { return false; }
}
export function verifyToken(expected: string | undefined, supplied: string | null | undefined) {
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}
export function verifySha256(secret: string, body: string, signature: string | null) {
  return Boolean(secret && signature && safeEqual(signature, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`));
}
