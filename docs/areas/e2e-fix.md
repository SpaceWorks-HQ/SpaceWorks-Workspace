# Production hosting smoke tests

The production smoke harness builds and runs the application as either a
separate backend/frontend pair (`npm run test:e2e:split`) or a standalone
VPS runtime (`npm run test:e2e:vps`). Builds run sequentially with a 4 GB
Node heap limit. The split frontend receives only its explicit rendering
and gateway configuration, with a different Server Action encryption key
from the backend.

## Chat composer expectation

`components/chat/Composer.tsx` exposes the message textarea as a named
`combobox`, because typing `@` or `#` opens its autocomplete list. Its
accessible name is still `Message #general`. Browser tests must select its
declared role, rather than the textarea's implicit `textbox` role.
The production split response was checked after credential authentication:
the session belonged to the fixture user, the channel returned HTTP 200
without a streamed rendering error, and its textarea had
`aria-label="Message #general" role="combobox"`.

The split smoke test covers password sign-in with a channel callback URL,
message submission through the frontend action bridge and database
persistence, single-use direct realtime tickets, backend page isolation,
private gateway endpoint isolation and MCP authentication.

## Running without Docker

The default harness provisions and removes its own PostgreSQL and Redis
containers. For pre-provisioned **disposable test services**, export
`DATABASE_URL`, optionally `DIRECT_URL`, and `REDIS_URL`, then run:

```sh
npm run test:e2e:split -- --external-services
npm run test:e2e:vps -- --external-services
```

This explicit option applies migrations to the supplied database. Test
fixtures create and remove their own records; the harness does not create,
stop or delete the supplied services. Run each hosting variant separately.
An optional `PLAYWRIGHT_BROWSERS_PATH` is forwarded to the browser runner so
Chromium can be installed in a writable temporary directory.

The suite also contains existing demo-only browser checks. They require
their documented demo seed and password variables, and are not enabled by
the isolated production harness. The split-specific test runs only in the
split variant. The harness explicitly clears the demo password flags so
Prisma loading a developer's local configuration cannot accidentally enable
tests that need an unprovisioned demo workspace.
