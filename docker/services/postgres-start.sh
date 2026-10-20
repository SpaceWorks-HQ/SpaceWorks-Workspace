#!/bin/sh
# PostgreSQL with TLS from the private CA (certificates live in the external
# configuration directory and are copied so postgres can own the key).
set -eu
mkdir -p /var/lib/postgresql/tls
cp /run/server-tls/public.crt /var/lib/postgresql/tls/server.crt
cp /run/server-tls/private.key /var/lib/postgresql/tls/server.key
chown -R postgres:postgres /var/lib/postgresql/tls
chmod 600 /var/lib/postgresql/tls/server.key
exec /usr/local/bin/docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file=/var/lib/postgresql/tls/server.crt \
  -c ssl_key_file=/var/lib/postgresql/tls/server.key \
  -c ssl_min_protocol_version=TLSv1.2 \
  -c hba_file=/etc/postgresql/pg_hba.conf \
  -c password_encryption=scram-sha-256
