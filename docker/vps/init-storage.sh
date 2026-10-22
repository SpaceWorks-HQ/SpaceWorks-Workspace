#!/bin/sh
set -eu
mc mb --ignore-existing local/spaceworks-workspace
mc anonymous set none local/spaceworks-workspace
mc version enable local/spaceworks-workspace
# A separate application identity can operate only on the private app bucket.
mc admin user add local sww-app "$S3_APP_PASSWORD" >/dev/null
mc admin policy create local sww-app /bootstrap/storage-policy.json >/dev/null
mc admin policy attach local sww-app --user sww-app >/dev/null
echo 'Private storage bucket and application policy ready.'
