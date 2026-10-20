// Generate deployment config only after confirmation. Never print credentials.
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function dotenv(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const text = String(value);
    if (/[\r\n\0]/.test(text)) throw new Error(`${key} must be a single line.`);
    return `${key}='${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  }).join("\n") + "\n";
}
export function validateAnswers(e) {
  if (e.ANSWERS_CONFIRMED !== "yes") throw new Error("Deployment answers must be confirmed.");
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(e.WEBHOST || "")) throw new Error("Invalid website hostname.");
  for (const [key, allowed] of Object.entries({ HTTPS_MODE: ["1", "2"], SHAPE: ["1", "2"], SPLIT_ROLE: ["frontend", "backend"], DATABASE: ["bundled", "external"], REDIS: ["bundled", "external"], STORAGE: ["bundled", "external"] })) {
    if (!allowed.includes(e[key])) throw new Error(`Invalid ${key}.`);
  }
  for (const key of ["SWW_HTTP_PORT", "SWW_HTTPS_PORT", "SWW_EDGE_PORT"]) {
    if (e[key] && (!/^\d+$/.test(e[key]) || Number(e[key]) < 1 || Number(e[key]) > 65535)) throw new Error(`Invalid ${key}.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(e.COMPOSE_PROJECT_NAME || "spaceworks-workspace")) throw new Error("Invalid project name.");
  for (const name of ["FRONTEND_CIDR", "SWW_TRUSTED_PROXY_CIDR", "SWW_EDGE_SUBNET"]) {
    if (!e[name]) continue;
    const [address, prefix, extra] = e[name].split("/");
    const family = isIP(address);
    if (!family || extra || !/^\d+$/.test(prefix || "") || Number(prefix) > (family === 4 ? 32 : 128)) throw new Error(`Invalid ${name}.`);
  }
  if (e.TLS_HOST && !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(e.TLS_HOST)) throw new Error("Invalid backend hostname.");
  if (e.SPLIT_ROLE === "frontend") {
    const upstream = new URL(e.BACKEND_UPSTREAM);
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Backend must be an HTTPS origin.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.ADMINEMAIL || "")) throw new Error("Invalid owner email.");
  if (e.DATABASE === "external") {
    for (const key of ["RUNTIME_DATABASE", "DIRECT_DATABASE"]) {
      const url = new URL(e[key]);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode"))) throw new Error("External database URLs must require TLS.");
    }
    if (new URL(e.DIRECT_DATABASE).port === "6543") throw new Error("Migrations require a direct or session connection.");
  }
  if (e.REDIS === "external" && new URL(e.EXTERNAL_REDIS).protocol !== "rediss:") throw new Error("External Redis requires TLS.");
  if (e.STORAGE === "external") {
    const endpoint = new URL(e.S3_ENDPOINT);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("External storage requires an HTTPS endpoint without embedded credentials.");
  }
  if (Boolean(e.AUTH_GOOGLE_ID) !== Boolean(e.AUTH_GOOGLE_SECRET)) throw new Error("Supply both Google OAuth credentials or skip both.");
}
export function configure(root, e = process.env) {
  validateAnswers(e);
  process.umask(0o077);
  const config = `${root}/config`;
  if (existsSync(`${config}/app.env`) || existsSync(`${root}/.env`)) throw new Error("Configuration exists; use update or renew certificates.");
  mkdirSync(config, { recursive: true, mode: 0o700 });
  const write = (name, value) => writeFileSync(`${root}/${name}`, typeof value === "string" ? value : dotenv(value), { flag: "wx", mode: 0o600 });
  const metadata = {
    COMPOSE_PROJECT_NAME: e.COMPOSE_PROJECT_NAME || "spaceworks-workspace", SWW_REPOSITORY: e.SWW_REPOSITORY,
    SWW_SHAPE: e.SHAPE === "2" ? "single" : "separate", SWW_HOSTING_MODEL: e.HOSTING_MODEL, SWW_HOST_ROLE: e.SPLIT_ROLE,
    SWW_DATABASE: e.DATABASE, SWW_REDIS: e.REDIS, SWW_STORAGE: e.STORAGE, SWW_HTTPS: e.HTTPS_MODE === "1" ? "auto" : "proxy",
    SWW_PUBLIC_HOST: e.WEBHOST, SWW_TLS_HOST: e.TLS_HOST || e.WEBHOST, SWW_FRONTEND_CIDR: e.FRONTEND_CIDR || "127.0.0.1/32", SWW_TLS_EMAIL: e.TLS_EMAIL, SWW_IMAGE_TAG: e.SWW_IMAGE_TAG || "latest",
    SWW_BACKEND_IMAGE: e.SWW_BACKEND_IMAGE, SWW_FRONTEND_IMAGE: e.SWW_FRONTEND_IMAGE, SWW_ALLINONE_IMAGE: e.SWW_ALLINONE_IMAGE,
    SWW_BIND: e.SWW_BIND || (e.HTTPS_MODE === "2" ? "127.0.0.1" : "0.0.0.0"),
    SWW_EDGE_PORT: e.SWW_EDGE_PORT || "8080", SWW_HTTP_PORT: e.SWW_HTTP_PORT || "80", SWW_HTTPS_PORT: e.SWW_HTTPS_PORT || "443",
    SWW_EDGE_SUBNET: e.SWW_EDGE_SUBNET || "172.30.80.0/24", SWW_TRUSTED_PROXY_CIDR: e.SWW_TRUSTED_PROXY_CIDR || e.SWW_EDGE_SUBNET || "172.30.80.0/24",
    SWW_CADDY_TLS: e.SWW_CADDY_TLS || "acme", SWW_BACKUP_KEEP_DAYS: "14",
    BACKEND_UPSTREAM: (e.BACKEND_UPSTREAM || "http://backend:3000").replace(/\/$/, ""),
    SWW_EDGE_UPSTREAM: e.SHAPE === "2" ? "app:8080" : "frontend:8080",
  };
  if (e.HOSTING_MODEL === "2" && e.SPLIT_ROLE === "backend") metadata.SWW_EDGE_UPSTREAM = "api-edge:8080";
  if (e.SPLIT_ROLE === "frontend") {
    write(".env", metadata);
    console.log("Frontend-only deployment settings created; no app credentials are stored here.");
    return;
  }
  const hex = () => randomBytes(32).toString("hex");
  const key = () => randomBytes(32).toString("base64");
  const tls = `${config}/tls`;
  mkdirSync(tls, { recursive: true, mode: 0o755 });
  const openssl = (...args) => execFileSync("openssl", args, { stdio: "ignore" });
  openssl("req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "3650", "-subj", "/CN=Space Works Workspace private CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", `${tls}/ca.key`, "-out", `${tls}/ca.crt`);
  chmodSync(`${tls}/ca.crt`, 0o644);
  for (const service of ["postgres", "redis", "silo"]) {
    mkdirSync(`${tls}/${service}`, { mode: 0o755 });
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${service}`, "-keyout", `${tls}/${service}/private.key`, "-out", `${tls}/${service}/request.csr`);
    writeFileSync(`${tls}/${service}/extensions.cnf`, `subjectAltName=DNS:${service}\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n`);
    openssl("x509", "-req", "-sha256", "-days", "365", "-in", `${tls}/${service}/request.csr`, "-CA", `${tls}/ca.crt`, "-CAkey", `${tls}/ca.key`, "-CAcreateserial", "-extfile", `${tls}/${service}/extensions.cnf`, "-out", `${tls}/${service}/public.crt`);
    chmodSync(`${tls}/${service}/public.crt`, 0o644);
  }
  const admin = hex(), runtime = hex(), redis = hex(), storage = hex(), storageApp = hex(), cron = hex();
  const db = (user, password) => `postgresql://${user}:${password}@postgres:5432/sww?sslmode=require&sslcert=/tls/ca.crt&sslaccept=strict`;
  const dbRuntime = e.DATABASE === "external" ? e.RUNTIME_DATABASE : db("sww_app", runtime);
  const dbMigrate = e.DATABASE === "external" ? e.DIRECT_DATABASE : db("sww", admin);
  const origin = `https://${e.WEBHOST}${e.SWW_HTTPS_PORT && e.SWW_HTTPS_PORT !== "443" && e.HTTPS_MODE === "1" ? `:${e.SWW_HTTPS_PORT}` : ""}`;
  const app = {
    NODE_ENV: "production", AUTH_URL: origin, NEXT_PUBLIC_BASE_URL: origin,
    DATABASE_URL: dbRuntime, DIRECT_URL: dbRuntime, AUTH_SECRET: hex(),
    MFA_ENCRYPTION_KEY: key(), INTEGRATION_ENCRYPTION_KEY: key(), VAULT_MASTER_KEY: key(), NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key(),
    CRON_SECRET: cron, HEALTHCHECK_SECRET: hex(), SUPER_ADMIN_EMAIL: e.ADMINEMAIL,
    REDIS_URL: e.REDIS === "external" ? e.EXTERNAL_REDIS : `rediss://default:${redis}@redis:6379`,
    NODE_EXTRA_CA_CERTS: "/tls/ca.crt", TRUSTED_PROXY_IP_HEADER: "x-real-ip", OUTBOX_WORKER: "0",
    S3_BUCKET: e.S3_BUCKET || "spaceworks-workspace", S3_REGION: e.S3_REGION || "us-east-1",
    S3_ENDPOINT: e.STORAGE === "external" ? e.S3_ENDPOINT : "https://silo:9000",
    S3_ACCESS_KEY_ID: e.STORAGE === "external" ? e.S3_ACCESS_KEY_ID : "sww-app",
    S3_SECRET_ACCESS_KEY: e.STORAGE === "external" ? e.S3_SECRET_ACCESS_KEY : storageApp,
    S3_FORCE_PATH_STYLE: e.S3_FORCE_PATH_STYLE || "1",
  };
  for (const name of ["ANTHROPIC_API_KEY", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]) if (e[name]) app[name] = e[name];
  write("config/app.env", app);
  write("config/migrate.env", { DATABASE_URL: dbMigrate, DIRECT_URL: dbMigrate, NODE_EXTRA_CA_CERTS: "/tls/ca.crt" });
  write("config/postgres.env", { POSTGRES_USER: "sww", POSTGRES_DB: "sww", POSTGRES_PASSWORD: admin, POSTGRES_APP_PASSWORD: runtime, POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256" });
  write("config/storage.env", { MINIO_ROOT_USER: "sww-root", MINIO_ROOT_PASSWORD: storage, MINIO_BROWSER: "off" });
  write("config/storage-init.env", { MC_HOST_local: `https://sww-root:${storage}@silo:9000`, S3_APP_PASSWORD: storageApp, S3_BUCKET: app.S3_BUCKET, SSL_CERT_FILE: "/tls/ca.crt" });
  write("config/scheduler.env", { APP_URL: e.SHAPE === "2" ? "http://127.0.0.1:3000" : "http://backend:3000", CRON_SECRET: cron });
  write("config/redis.conf", `port 0\ntls-port 6379\ntls-cert-file /data/tls/public.crt\ntls-key-file /data/tls/private.key\ntls-ca-cert-file /tls/ca.crt\ntls-auth-clients no\nrequirepass ${redis}\nappendonly yes\nmaxmemory-policy noeviction\n`);
  write(".env", metadata);
  console.log("Private settings and internal TLS created. Back up config/ securely before use.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { configure(resolve(process.argv[2] || ".")); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
