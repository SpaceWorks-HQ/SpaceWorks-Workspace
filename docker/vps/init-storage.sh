#!/bin/sh
# One-shot (re-runnable) initialisation of private Silo storage:
# - the private bucket, with versioning so deleted or overwritten files can be
#   recovered for 30 days, then expired;
# - a separate application identity that can only use objects in that bucket.
# MC_HOST_local carries the root credential; SSL_CERT_FILE trusts the private CA.
set -eu
bucket=${S3_BUCKET:?S3_BUCKET is required}
until mc ready local >/dev/null 2>&1; do sleep 1; done
mc mb --ignore-existing "local/$bucket"
mc anonymous set none "local/$bucket" >/dev/null
mc version enable "local/$bucket" >/dev/null
# Add the lifecycle rule only when the bucket has none (an operator may tune it).
if ! mc ilm rule ls "local/$bucket" >/dev/null 2>&1; then
  mc ilm rule add --noncurrent-expire-days 30 --expire-delete-marker "local/$bucket" >/dev/null
fi
# The mc image has no sed, so the bucket-scoped policy is written directly.
printf '%s\n' \
  '{' \
  '  "Version": "2012-10-17",' \
  '  "Statement": [' \
  "    { \"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\", \"s3:GetBucketLocation\"], \"Resource\": [\"arn:aws:s3:::$bucket\"] }," \
  "    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": [\"arn:aws:s3:::$bucket/*\"] }" \
  '  ]' \
  '}' > /tmp/storage-policy.json
mc admin user add local sww-app "$S3_APP_PASSWORD" >/dev/null
mc admin policy create local sww-app /tmp/storage-policy.json >/dev/null
mc admin policy attach local sww-app --user sww-app >/dev/null 2>&1 || true
echo 'Private storage bucket and application policy ready.'
