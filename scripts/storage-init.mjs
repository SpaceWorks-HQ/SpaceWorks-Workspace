#!/usr/bin/env node
// Create the private bucket named by S3_BUCKET if it does not exist yet
// (local Silo or a self-hosted S3). Cloud buckets (R2) are created in the
// provider console instead. Never makes the bucket public.
//
//   node --env-file=.env scripts/storage-init.mjs
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
if (!bucket || !process.env.S3_REGION) {
  console.error("Set S3_BUCKET and S3_REGION first.");
  process.exit(1);
}
const client = new S3Client({
  region: process.env.S3_REGION,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
  ...(process.env.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } } : {}),
});
try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`Bucket ${bucket} already exists.`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Created private bucket ${bucket}.`);
}
