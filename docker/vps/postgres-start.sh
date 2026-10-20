#!/bin/sh
set -eu
mkdir -p /var/lib/postgresql/tls
cp /run/server-tls/public.crt /var/lib/postgresql/tls/server.crt
cp /run/server-tls/private.key /var/lib/postgresql/tls/server.key
chown -R postgres:postgres /var/lib/postgresql/tls
chmod 600 /var/lib/postgresql/tls/server.key
exec /usr/local/bin/docker-entrypoint.sh postgres \
  -c ssl=on -c ssl_cert_file=/var/lib/postgresql/tls/server.crt \
  -c ssl_key_file=/var/lib/postgresql/tls/server.key \
  -c hba_file=/etc/postgresql/pg_hba.conf
