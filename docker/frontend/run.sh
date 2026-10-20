#!/bin/sh
set -eu
/bin/sh /docker-entrypoint.d/30-configure-upstream.sh
exec nginx -g 'daemon off;'
