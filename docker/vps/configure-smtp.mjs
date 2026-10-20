// Used by the guided installer. Credentials arrive in the container environment,
// never command-line values; write them only to the external owner-only file.
import { readFileSync, writeFileSync } from "node:fs";

const keys = ["EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD"];
for (const key of keys) {
  if (!process.env[key]?.trim() || /[\r\n\0]/.test(process.env[key])) throw new Error(`A single non-empty value is required for ${key}.`);
}
if (!/^\d+$/.test(process.env.SMTP_PORT) || Number(process.env.SMTP_PORT) < 1 || Number(process.env.SMTP_PORT) > 65535) throw new Error("SMTP_PORT must be between 1 and 65535.");
if (!["true", "false"].includes(process.env.SMTP_SECURE)) throw new Error("SMTP_SECURE must be true or false.");
const encode = (value) => `'${value.replaceAll("'", "\\'")}'`;
const file = "/config/app.env";
const updated = readFileSync(file, "utf8").split("\n").map((line) => {
  const name = line.slice(0, line.indexOf("="));
  return keys.includes(name) ? `${name}=${encode(process.env[name])}` : line;
}).join("\n");
writeFileSync(file, updated, { mode: 0o600 });
console.log("SMTP bootstrap configuration saved without displaying credentials.");
