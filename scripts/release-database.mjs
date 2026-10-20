// PostgreSQL transport through environment, never a credential-bearing argv.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { statSync } from "node:fs";
export function pgEnvironment(source) {
  const url = new URL(source.DIRECT_URL || source.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database protocol.");
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("PG") && !["DATABASE_URL", "DIRECT_URL"].includes(key)));
  Object.assign(env, { PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") || "verify-full", PGCONNECT_TIMEOUT: "15" });
  // Prisma's sslcert means CA; libpq calls it sslrootcert.
  const ca = url.searchParams.get("sslrootcert") || url.searchParams.get("sslcert") || source.PGSSLROOTCERT || (url.hostname === "postgres" ? "/tls/ca.crt" : undefined);
  if (ca) env.PGSSLROOTCERT = ca;
  return env;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, file] = process.argv.slice(2);
    const env = pgEnvironment(process.env);
    const run = (cmd, args) => { const result = spawnSync(cmd, args, { env, stdio: ["ignore", "ignore", "ignore"], timeout: 3600000 }); if (result.status !== 0) throw new Error("Database operation failed. Check server/client versions and permissions."); };
    if (action === "backup") { run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", file]); if (!statSync(file).size) throw new Error("Empty database backup."); run("pg_restore", ["--list", file]); }
    else if (action === "restore") { run("pg_restore", ["--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", env.PGDATABASE, file]); }
    else throw new Error("Use backup or restore and a file path.");
  } catch { console.error("Database operation failed. Check the restricted database connection and PostgreSQL client version."); process.exitCode = 1; }
}
