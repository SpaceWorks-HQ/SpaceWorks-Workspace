// Used by the guided installer when files live in an external S3-compatible
// bucket. Credentials arrive in the container environment, never command-line
// values; write them only to the external owner-only file.
import { readFileSync, writeFileSync } from "node:fs";

const keys = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
for (const key of keys) {
  if (!process.env[key]?.trim() || /[\r\n\0'\\]/.test(process.env[key])) throw new Error(`A single value without quotes or backslashes is required for ${key}.`);
}
const endpoint = new URL(process.env.S3_ENDPOINT);
if (endpoint.protocol !== "https:" || endpoint.origin !== process.env.S3_ENDPOINT) throw new Error("S3_ENDPOINT must be an HTTPS origin without a path.");
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(process.env.S3_BUCKET)) throw new Error("S3_BUCKET is not a valid bucket name.");
if (!/^[a-z0-9-]{1,32}$/.test(process.env.S3_REGION)) throw new Error("S3_REGION is not a valid region.");
// Path-style addressing works with R2, Silo/MinIO and Amazon S3 alike.
const values = { ...Object.fromEntries(keys.map((key) => [key, process.env[key]])), S3_FORCE_PATH_STYLE: "1" };
const file = `${process.env.SWW_SETUP_CONFIG_DIR || "/config"}/app.env`;
const lines = readFileSync(file, "utf8").split("\n").filter((line) => line && !(line.slice(0, line.indexOf("=")) in values));
writeFileSync(file, [...lines, ...Object.entries(values).map(([name, value]) => `${name}='${value}'`)].join("\n") + "\n", { mode: 0o600 });
console.log("External storage configuration saved without displaying credentials.");
