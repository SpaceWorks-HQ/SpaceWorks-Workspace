#!/bin/sh
# Silo bucket backup/restore, run by scripts/backup.sh and restore.sh
# in the `storage-backup` tools container (root storage credential, data network).
#
#   storage-backup.sh backup STAMP     mirror the bucket into /backups/storage/mirror
#                                      (the mc image has no tar; backup.sh archives
#                                      the mirror on the host as storage-STAMP.tar.gz)
#   storage-backup.sh restore DIR      copy /backups/DIR back into the bucket
#                                      (existing objects with the same key are overwritten)
set -eu
bucket=${S3_BUCKET:?S3_BUCKET is required}
case "${1:-}" in
  backup)
    stamp=${2:?Provide a timestamp}
    case "$stamp" in *[!0-9TZ]*) echo 'Invalid timestamp.' >&2; exit 1 ;; esac
    umask 077
    mkdir -p /backups/storage/mirror
    # Incremental: only changed objects are copied; deleted objects are removed
    # from the mirror (dated archives and bucket versioning keep history).
    mc mirror --quiet --overwrite --remove "local/$bucket" /backups/storage/mirror
    echo "Storage mirrored: storage/mirror"
    ;;
  restore)
    source_dir=${2:?Provide the extracted backup directory}
    case "$source_dir" in /*|*..*) echo 'Use a directory relative to the backups folder.' >&2; exit 1 ;; esac
    [ -d "/backups/$source_dir" ] || { echo 'Restore directory not found.' >&2; exit 1; }
    mc mirror --quiet --overwrite --remove "/backups/$source_dir" "local/$bucket"
    echo 'Storage objects restored.'
    ;;
  *)
    echo 'Usage: storage-backup.sh backup STAMP | restore DIR' >&2
    exit 1
    ;;
esac
