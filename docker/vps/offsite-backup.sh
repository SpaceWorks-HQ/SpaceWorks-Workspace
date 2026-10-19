#!/bin/sh
# Copies database and storage archives to an off-site S3-compatible bucket.
# Configure $SWW_CONFIG_DIR/backup-remote.env (owner-only):
#
#   MC_HOST_remote='https://ACCESS_KEY:SECRET_KEY@s3.example.com'
#   REMOTE_BUCKET='my-backups'
#   REMOTE_PREFIX='spaceworks-workspace'      (optional)
#
# Use a dedicated private bucket with encryption at rest, versioning or object
# lock, and a key that can only write to it. The configuration archive (it
# holds every secret) is never uploaded: keep it in your password manager.
set -eu
: "${MC_HOST_remote:?Create backup-remote.env first (see docs/production-operations.md).}"
bucket=${REMOTE_BUCKET:?REMOTE_BUCKET is required}
prefix=${REMOTE_PREFIX:-spaceworks-workspace}
for folder in database storage; do
  [ -d "/backups/$folder" ] || continue
  # Archives only; the working mirror is not copied.
  mc mirror --quiet --overwrite --exclude "mirror/*" "/backups/$folder" "remote/$bucket/$prefix/$folder"
done
echo 'Off-site copy complete.'
