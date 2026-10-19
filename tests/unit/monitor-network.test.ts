import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { guardedRequest } from '@/lib/monitor/net/http';
import { runHttpCheck } from '@/lib/monitor/checks/http';
import { runPostgresCheck, runRedisCheck } from '@/lib/monitor/checks/other';
import { runTcpCheck, parsePingRtt } from '@/lib/monitor/checks/network';
import { httpConfigSchema } from '@/lib/monitor/schemas';
import type { CheckContext } from '@/lib/monitor/checks/context';

let server: http.Server, port: number, lastAuthorization: string | undefined;
const ctx: CheckContext = { policy: { allowPrivate: true, allowlist: ['127.0.0.1'] }, timeoutMs: 1000, degradedLatencyMs: null, secret: null, now: new Date(), lookup: async () => [{ address: '127.0.0.1', family: 4 }] };
const url = (path: string) => `http://pinned.example.com:${port}${path}`;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect-private') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); res.end(); }
    else if (req.url === '/redirect-origin') { res.writeHead(302, { location: `http://different.example.com:${port}/json` }); res.end(); }
    else if (req.url === '/redirect-repeat') { res.writeHead(302, { location: '/redirect-repeat' }); res.end(); }
    else if (req.url === '/large') { res.end('x'.repeat(2048)); }
    else if (req.url === '/slow') { setTimeout(() => res.end('ok'), 100); }
    else if (req.url === '/echo') { const data: Buffer[] = []; req.on('data', c => data.push(c)); req.on('end', () => res.end(`${req.method}:${Buffer.concat(data)}`)); }
    else { lastAuthorization = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ready"}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = (server.address() as { port: number }).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
describe('monitor pinned transports', () => {
  it('connects HTTP to a validated address and evaluates JSON/keyword/status assertions', async () => {
    const result = await runHttpCheck(httpConfigSchema.parse({ url: url('/json'), assertions: ['[BODY].status == "ready"', '[HEADER].content-type contains "json"'] }), ctx);
    expect(result).toMatchObject({ status: 'UP', statusCode: 200, resolvedIp: '127.0.0.1' });
  });
  it('rejects assertions and status mismatches', async () => {
    expect((await runHttpCheck(httpConfigSchema.parse({ url: url('/json'), assertions: ['[BODY].status == "broken"'] }), ctx)).error).toBe('ASSERTION_FAILED');
    expect((await runHttpCheck(httpConfigSchema.parse({ url: url('/json'), expectedStatus: '204' }), ctx)).error).toBe('STATUS_MISMATCH');
  });
  it('checks every redirect target and never reaches metadata', async () => { expect(await guardedRequest({ url: url('/redirect-private'), timeoutMs: 1000, policy: ctx.policy, lookup: ctx.lookup })).toMatchObject({ ok: false, error: 'SSRF_BLOCKED' }); });
  it('drops auth when redirecting to another origin', async () => { lastAuthorization = undefined; const response = await guardedRequest({ url: url('/redirect-origin'), headers: { authorization: 'fixture-secret' }, timeoutMs: 1000, policy: ctx.policy, lookup: ctx.lookup }); expect(response.ok).toBe(true); expect(lastAuthorization).toBeUndefined(); });
  it('enforces body caps and timeouts', async () => {
    const response = await guardedRequest({ url: url('/large'), maxBodyBytes: 100, timeoutMs: 1000, policy: ctx.policy, lookup: ctx.lookup }); expect(response.ok && response.body.length).toBe(100); expect(response.ok && response.bodyTruncated).toBe(true);
    expect(await guardedRequest({ url: url('/slow'), timeoutMs: 10, policy: ctx.policy, lookup: ctx.lookup })).toMatchObject({ ok: false, error: 'TIMEOUT' });
  });
  it('fails repeated redirects instead of accepting the final redirect as healthy', async () => { expect(await guardedRequest({ url: url('/redirect-repeat'), timeoutMs: 1000, policy: ctx.policy, lookup: ctx.lookup })).toMatchObject({ ok: false, error: 'NETWORK_ERROR', message: 'Too many redirects.' }); });
  it('sends method and body exactly as configured', async () => { const response = await guardedRequest({ url: url('/echo'), method: 'POST', body: 'fixture', timeoutMs: 1000, policy: ctx.policy, lookup: ctx.lookup }); expect(response.ok && response.body).toBe('POST:fixture'); });
  it('connects TCP directly to the pinned address', async () => { expect(await runTcpCheck({ host: 'pinned.example.com', port, tls: false }, ctx)).toMatchObject({ status: 'UP', resolvedIp: '127.0.0.1' }); });
  it('rejects database metadata targets before constructing a connection', async () => {
    expect(await runPostgresCheck({ ...ctx, secret: { connectionString: 'postgresql://user:password@169.254.169.254/db' } })).toMatchObject({ status: 'DOWN', error: 'SSRF_BLOCKED' });
    expect(await runRedisCheck({ ...ctx, secret: { connectionString: 'redis://169.254.169.254:6379/0' } })).toMatchObject({ status: 'DOWN', error: 'SSRF_BLOCKED' });
  });
  it('parses ping reply latency', () => { expect(parsePingRtt('64 bytes time=12.3 ms')).toBe(12); expect(parsePingRtt('timeout')).toBeNull(); });
});
