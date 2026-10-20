#!/bin/sh
# Redis over TLS only, with a password (see redis.conf in the configuration directory).
set -eu
mkdir -p /data/tls
cp /run/server-tls/public.crt /run/server-tls/private.key /data/tls/
cp /run/redis.conf /data/redis.conf
chown -R redis:redis /data/tls /data/redis.conf
chmod 600 /data/tls/private.key /data/redis.conf
exec /usr/local/bin/docker-entrypoint.sh redis-server /data/redis.conf
