// Stream private S3 bytes; paths use generated numeric names, never object keys.
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
const [action, directory] = process.argv.slice(2);
const bucket = process.env.S3_BUCKET;
const client = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1", credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined });
try {
  if (action === "backup") {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const objects = [];
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      for (const item of page.Contents || []) {
        const file = `${objects.length}.object`;
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
        await pipeline(result.Body, createWriteStream(`${directory}/${file}`, { mode: 0o600 }));
        objects.push({ key: item.Key, file, contentType: result.ContentType });
      }
      token = page.NextContinuationToken;
    } while (token);
    await writeFile(`${directory}/objects.json`, JSON.stringify(objects), { mode: 0o600 });
  } else if (action === "restore") {
    const objects = JSON.parse(await readFile(`${directory}/objects.json`, "utf8"));
    const keys = new Set(objects.map((item) => item.key));
    for (const item of objects) {
      if (!/^\d+\.object$/.test(item.file)) throw new Error();
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: item.key, ContentType: item.contentType, Body: createReadStream(`${directory}/${item.file}`) }));
    }
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      const stale = (page.Contents || []).filter((item) => !keys.has(item.Key)).map((item) => ({ Key: item.Key }));
      if (stale.length) {
        const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: stale } }));
        if (result.Errors?.length) throw new Error();
      }
      token = page.NextContinuationToken;
    } while (token);
  } else throw new Error();
  console.log(`Private storage ${action} complete.`);
} catch { console.error("Private storage operation failed. Check the restricted object-storage credentials and archive."); process.exitCode = 1; }
finally { client.destroy(); }
