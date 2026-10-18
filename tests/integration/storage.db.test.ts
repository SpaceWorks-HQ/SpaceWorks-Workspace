import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { deleteObjects, fileResponse, getObject, uploadWorkspaceFile } from "@/lib/storage";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

/**
 * Uses the development disk fallback by default. Set TEST_S3_BUCKET (plus the
 * usual S3_* variables) to run the same checks against Silo or another S3.
 */
const suffix = uniqueSuffix();
const domain = `@sto-${suffix}.test`;
const slug = `sto-${suffix}`;
let workspaceId: string;
let userId: string;
const keys: string[] = [];

beforeEach(() => {
  if (process.env.TEST_S3_BUCKET) vi.stubEnv("S3_BUCKET", process.env.TEST_S3_BUCKET);
  else vi.stubEnv("S3_BUCKET", "");
});

describe.sequential("private file storage", () => {
  beforeAll(async () => {
    userId = (await createUser(`u${domain}`)).id;
    workspaceId = (await createWorkspace(slug, userId)).id;
  });

  afterAll(async () => {
    await deleteObjects(keys).catch(() => undefined);
    await cleanup([slug], domain);
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("stores a valid image privately and records it", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 110, b: 99 } } }).png().toBuffer();
    const result = await uploadWorkspaceFile({ workspaceId, uploadedById: userId, file: new File([new Uint8Array(png)], "../../board photo.png", { type: "image/png" }), folder: "/builds//bot/" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    keys.push(result.file.storageKey);
    expect(result.file.storageKey.startsWith(`workspaces/${workspaceId}/files/`)).toBe(true);
    expect(result.file.filename).toBe("board photo.png");
    expect(result.file.folder).toBe("/builds/bot");
    expect(result.file.size).toBe(png.length);
    const stored = await getObject(result.file.storageKey);
    expect(Buffer.from(stored!.body).equals(png)).toBe(true);

    const response = await fileResponse(result.file);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const download = await fileResponse(result.file, { download: true });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("rejects disallowed types and corrupt images before storing anything", async () => {
    const before = await prisma.fileObject.count({ where: { workspaceId } });
    const html = await uploadWorkspaceFile({ workspaceId, uploadedById: userId, file: new File(["<script>alert(1)</script>"], "x.html", { type: "text/html" }) });
    expect(html.ok).toBe(false);
    const fake = await uploadWorkspaceFile({ workspaceId, uploadedById: userId, file: new File(["not really a png"], "x.png", { type: "image/png" }) });
    expect(fake.ok).toBe(false);
    const big = await uploadWorkspaceFile({ workspaceId, uploadedById: userId, file: new File(["0123456789"], "x.txt", { type: "text/plain" }), maxBytes: 5 });
    expect(big.ok).toBe(false);
    await expect(prisma.fileObject.count({ where: { workspaceId } })).resolves.toBe(before);
  });
});
