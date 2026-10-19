// Generates the external configuration for the VPS stack. Runs only in the
// operator (`ops`) container with the owner-only configuration directory
// mounted at /config. Never prints a secret.
//
//   node docker/vps/setup.mjs            first installation (refuses to overwrite)
//   node docker/vps/setup.mjs renew-certificates
//
// First installation reads its answers from the environment (passed with
// `docker run --env NAME`, never as command-line values):
//   SETUP_PUBLIC_HOST, SETUP_PUBLIC_ORIGIN, SETUP_ADMIN_EMAIL, SETUP_VERSION,
//   SETUP_PROJECT, SETUP_CADDY_TLS, SETUP_HTTP_PORT, SETUP_HTTPS_PORT, SETUP_BIND_PREFIX,
//   optional EMAIL_FROM + SMTP_HOST/PORT/SECURE/USER/PASSWORD, optional ANTHROPIC_API_KEY.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

process.umask(0o077);
const dir = process.env.SWW_SETUP_CONFIG_DIR || "/config";
const renew = process.argv[2] === "renew-certificates";
const env = process.env;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const write = (name, value) => writeFileSync(`${dir}/${name}`, value, { mode: 0o600 });
const openssl = (...args) => execFileSync("openssl", args, { stdio: "ignore" });

// Values go into Compose env files as single-quoted literals; refuse anything
// that could break out of one. Operators can set such values later in /admin.
function literal(name, value) {
  const text = String(value);
  if (/['\r\n\0]/.test(text)) fail(`${name} cannot contain quotes or line breaks. Configure it later under /admin instead.`);
  return `'${text}'`;
}
const envText = (values) => `${Object.entries(values).filter(([, value]) => value !== undefined && value !== "").map(([name, value]) => `${name}=${literal(name, value)}`).join("\n")}\n`;

if (renew && !existsSync(`${dir}/tls/ca.key`)) fail("Existing CA required for certificate renewal.");
if (!renew && ["compose.env", "app.env"].some((name) => existsSync(`${dir}/${name}`))) {
  fail("Configuration exists; refusing to replace secrets. Use the update procedure, or renew-certificates for TLS renewal.");
}

const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const host = env.SETUP_PUBLIC_HOST?.toLowerCase() ?? "";
const email = env.SETUP_ADMIN_EMAIL ?? "";
const version = env.SETUP_VERSION ?? "";
if (!renew) {
  if (!hostname.test(host)) fail("SETUP_PUBLIC_HOST must be a DNS hostname such as work.example.org.");
  if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) fail("SETUP_ADMIN_EMAIL must be an email address.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(version)) fail("SETUP_VERSION must be a release label.");
}

// ── Internal TLS: a private CA and one certificate per data service ────────
mkdirSync(`${dir}/tls`, { recursive: true });
if (!renew) {
  openssl("req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "3650", "-subj", "/CN=Space Works Workspace private CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout", `${dir}/tls/ca.key`, "-out", `${dir}/tls/ca.crt`);
}
for (const service of ["postgres", "redis", "storage"]) {
  mkdirSync(`${dir}/tls/${service}`, { recursive: true });
  openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${service}`,
    "-keyout", `${dir}/tls/${service}/private.key`, "-out", `${dir}/tls/${service}/request.csr`);
  write(`tls/${service}/extensions.cnf`, `subjectAltName=DNS:${service}\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n`);
  openssl("x509", "-req", "-sha256", "-days", "365", "-in", `${dir}/tls/${service}/request.csr`,
    "-CA", `${dir}/tls/ca.crt`, "-CAkey", `${dir}/tls/ca.key`, "-CAcreateserial",
    "-extfile", `${dir}/tls/${service}/extensions.cnf`, "-out", `${dir}/tls/${service}/public.crt`);
}
// The public CA certificate is mounted into services; the CA key never is.
chmodSync(`${dir}/tls/ca.crt`, 0o644);
if (renew) {
  console.log("Internal TLS certificates renewed for one year. Recreate postgres, redis, storage and app (scripts/vps-renew-certs.sh does this).");
  process.exit(0);
}

// ── Secrets ─────────────────────────────────────────────────────────────────
const hex = () => randomBytes(32).toString("hex");
const key = () => randomBytes(32).toString("base64");
const adminPassword = hex(), appPassword = hex(), redisPassword = hex(), storageRoot = hex(), storageApp = hex();
const cronSecret = hex();
const bucket = "spaceworks-workspace";
const origin = env.SETUP_PUBLIC_ORIGIN || `https://${host}`;
try {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.hostname !== host || parsed.origin !== origin) throw new Error();
} catch {
  fail("SETUP_PUBLIC_ORIGIN must be the https:// origin of SETUP_PUBLIC_HOST, without a path.");
}
const dbUrl = (user, password) => `postgresql://${user}:${password}@postgres:5432/sww?sslmode=require&sslcert=/tls/ca.crt&sslaccept=strict`;
const tlsMode = env.SETUP_CADDY_TLS || "acme";
if (!["acme", "internal"].includes(tlsMode)) fail("SETUP_CADDY_TLS must be acme or internal.");
const port = (name, fallback) => {
  const value = env[name] || fallback;
  if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) fail(`${name} must be a port number.`);
  return value;
};
const bindPrefix = env.SETUP_BIND_PREFIX || "";
if (bindPrefix && !/^[0-9a-fA-F.:[\]]+:$/.test(bindPrefix)) fail("SETUP_BIND_PREFIX must look like 127.0.0.1: (an address and a colon).");
const project = env.SETUP_PROJECT || "spaceworks-workspace";
if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project)) fail("SETUP_PROJECT must be a lowercase Compose project name.");

// Optional SMTP: all of host, user, password and sender, or none (set it later in /admin).
const smtpKeys = ["EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD"];
const smtp = Object.fromEntries(smtpKeys.map((name) => [name, env[name]?.trim() || undefined]));
const smtpConfigured = Boolean(smtp.SMTP_HOST);
if (smtpConfigured) {
  for (const name of ["EMAIL_FROM", "SMTP_USER", "SMTP_PASSWORD"]) if (!smtp[name]) fail(`${name} is required when SMTP_HOST is set.`);
  smtp.SMTP_PORT ??= "587";
  smtp.SMTP_SECURE ??= smtp.SMTP_PORT === "465" ? "true" : "false";
  port("SMTP_PORT", smtp.SMTP_PORT);
  if (!["true", "false"].includes(smtp.SMTP_SECURE)) fail("SMTP_SECURE must be true or false.");
}

write("compose.env", envText({
  COMPOSE_PROJECT_NAME: project,
  PUBLIC_HOST: host,
  PUBLIC_ORIGIN: origin,
  SWW_VERSION: version,
  ACME_EMAIL: email,
  CADDY_TLS: tlsMode,
  SWW_HTTP_PORT: port("SETUP_HTTP_PORT", "80"),
  SWW_HTTPS_PORT: port("SETUP_HTTPS_PORT", "443"),
  SWW_BIND_PREFIX: bindPrefix,
  SWW_BACKUP_KEEP_DAYS: "14",
}));
write("postgres.env", envText({
  POSTGRES_USER: "sww", POSTGRES_DB: "sww", POSTGRES_PASSWORD: adminPassword,
  POSTGRES_APP_PASSWORD: appPassword, POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256",
}));
write("migrator.env", envText({ DATABASE_URL: dbUrl("sww", adminPassword), DIRECT_URL: dbUrl("sww", adminPassword) }));
write("storage.env", envText({ MINIO_ROOT_USER: "sww-root", MINIO_ROOT_PASSWORD: storageRoot, MINIO_BROWSER: "off" }));
write("storage-init.env", envText({
  MC_HOST_local: `https://sww-root:${storageRoot}@storage:9000`, S3_APP_PASSWORD: storageApp,
  S3_BUCKET: bucket, SSL_CERT_FILE: "/tls/ca.crt",
}));
write("scheduler.env", envText({ APP_URL: "http://app:3000", CRON_SECRET: cronSecret }));
write("app.env", envText({
  NODE_ENV: "production",
  AUTH_URL: origin,
  NEXT_PUBLIC_BASE_URL: origin,
  DATABASE_URL: dbUrl("sww_app", appPassword),
  DIRECT_URL: dbUrl("sww_app", appPassword),
  REDIS_URL: `rediss://default:${redisPassword}@redis:6379`,
  NODE_EXTRA_CA_CERTS: "/tls/ca.crt",
  AUTH_SECRET: hex(),
  CRON_SECRET: cronSecret,
  HEALTHCHECK_SECRET: hex(),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key(),
  MFA_ENCRYPTION_KEY: key(),
  INTEGRATION_ENCRYPTION_KEY: key(),
  VAULT_MASTER_KEY: key(),
  SUPER_ADMIN_EMAIL: email,
  TRUSTED_PROXY_IP_HEADER: "x-real-ip",
  S3_BUCKET: bucket,
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "https://storage:9000",
  S3_ACCESS_KEY_ID: "sww-app",
  S3_SECRET_ACCESS_KEY: storageApp,
  S3_FORCE_PATH_STYLE: "1",
  ...(smtpConfigured ? smtp : {}),
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim() || undefined,
}));
write("redis.conf", [
  "port 0", "tls-port 6379", "tls-cert-file /data/tls/public.crt", "tls-key-file /data/tls/private.key",
  "tls-ca-cert-file /tls/ca.crt", "tls-auth-clients no", `requirepass ${redisPassword}`,
  "appendonly yes", "maxmemory-policy noeviction", "",
].join("\n"));
mkdirSync(`${dir}/backups`, { recursive: true, mode: 0o700 });
console.log(`Configuration created in the external directory without printing secrets.${smtpConfigured ? "" : " SMTP is not configured yet: set it under /admin after the first sign-in."}`);
console.log("Back up the whole configuration directory to encrypted, off-server storage. Never rerun setup for updates.");
