#!/usr/bin/env bash
# Account creation uses the app's existing, first-run-only setup screen.
printf 'Create the instance owner at %s/setup. No accounts or demo data are inserted by deployment scripts.\n' "${1:?Supply the public HTTPS origin}"
