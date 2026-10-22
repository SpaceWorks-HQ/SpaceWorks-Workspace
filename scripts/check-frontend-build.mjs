// Reject backend persistence in the separately deployed rendering workspace.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "frontend/.next");
const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const forbidden = /(?:node_modules\/(?:\.prisma|@prisma\/client|pg|ioredis|nodemailer|@aws-sdk\/client-s3)\/|frontend\/lib\/(?:db|auth|outboxWorker|frontend\/registry)\.[jt]s$)/;
const violations = new Set();
for (const file of files(build).filter((name) => name.endsWith('.nft.json'))) {
  for (const dependency of JSON.parse(readFileSync(file, 'utf8')).files ?? []) {
    const resolved = path.resolve(path.dirname(file), dependency).split(path.sep).join('/');
    if (forbidden.test(resolved)) violations.add(path.relative(root, resolved));
  }
}
for (const file of files(path.join(build, "server")).filter((name) => name.endsWith(".js"))) {
  if (readFileSync(file, "utf8").includes("Database access cannot run in the frontend workspace")) violations.add(path.relative(root, file));
}
if (violations.size) throw new Error(`Backend dependencies reached the frontend build: ${[...violations].join(', ')}`);
console.log('Frontend dependency traces contain no database engine, mail, Redis or storage client.');
