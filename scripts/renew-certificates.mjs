import { execFileSync } from "node:child_process";
import { chmodSync, renameSync } from "node:fs";
const root = process.argv[2];
try {
  for (const service of ["postgres", "redis", "silo"]) {
    const dir = `${root}/tls/${service}`;
    execFileSync("openssl", ["x509", "-req", "-sha256", "-days", "365", "-in", `${dir}/request.csr`, "-CA", `${root}/tls/ca.crt`, "-CAkey", `${root}/tls/ca.key`, "-CAcreateserial", "-extfile", `${dir}/extensions.cnf`, "-out", `${dir}/public.crt.new`], { stdio: "ignore" });
    chmodSync(`${dir}/public.crt.new`, 0o644);
    renameSync(`${dir}/public.crt.new`, `${dir}/public.crt`);
  }
  console.log("Internal certificates renewed under the existing private CA.");
} catch { console.error("Certificate renewal failed. Existing credentials were preserved."); process.exitCode = 1; }
