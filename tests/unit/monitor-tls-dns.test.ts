import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:tls', () => ({ default: { connect: vi.fn(), checkServerIdentity: vi.fn() } }));
import tls from 'node:tls';
import { dnsMatches, normalizeDnsAnswers, runTlsCheck } from '@/lib/monitor/checks/network';
import type { CheckContext } from '@/lib/monitor/checks/context';
const ctx: CheckContext = { policy: { allowPrivate: false, allowlist: [] }, timeoutMs: 1000, degradedLatencyMs: null, now: new Date('2026-10-19T12:00:00Z'), secret: null, lookup: async () => [{ address: '1.1.1.1', family: 4 }] };
const config = { host: 'example.com', port: 443, warnDays: 21, criticalDays: 7 };
beforeEach(() => { vi.mocked(tls.checkServerIdentity).mockReset(); vi.mocked(tls.connect).mockReset(); });
function peer(validTo: string, authorized = true) {
  vi.mocked(tls.connect).mockImplementation(() => {
    const socket = Object.assign(new EventEmitter(), { authorized, authorizationError: authorized ? null : 'SELF_SIGNED_CERT_IN_CHAIN', getPeerCertificate: () => ({ valid_to: validTo, issuer: { O: 'Fixture authority' } }), destroy: vi.fn() });
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket as unknown as tls.TLSSocket;
  });
}
describe('monitor TLS and DNS parsing', () => {
  it('reads certificate expiry and warning thresholds', async () => { peer('Nov 1 12:00:00 2026 GMT'); expect(await runTlsCheck(config, ctx)).toMatchObject({ status: 'DEGRADED', daysLeft: 13, meta: { certDaysLeft: 13, issuer: 'Fixture authority' } }); });
  it('rejects untrusted chains', async () => { peer('Nov 30 12:00:00 2026 GMT', false); expect(await runTlsCheck(config, ctx)).toMatchObject({ status: 'DOWN', error: 'TLS_INVALID' }); });
  it('rejects hostname mismatches', async () => { peer('Nov 30 12:00:00 2026 GMT'); vi.mocked(tls.checkServerIdentity).mockReturnValue(Object.assign(new Error('mismatch'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })); expect(await runTlsCheck(config, ctx)).toMatchObject({ status: 'DOWN', error: 'TLS_INVALID' }); });
  it('handles malformed certificate expiry without throwing', async () => { peer('not a date'); expect(await runTlsCheck(config, ctx)).toMatchObject({ status: 'DOWN', error: 'TLS_ERROR' }); });
  it('normalizes structured DNS records and matching modes', () => { expect(normalizeDnsAnswers('MX', [{ priority: 10, exchange: 'MAIL.EXAMPLE.COM.' }])).toEqual(['10 mail.example.com']); expect(normalizeDnsAnswers('TXT', [['part', 'two']])).toEqual(['parttwo']); expect(dnsMatches(['1.1.1.1', '8.8.8.8'], ['1.1.1.1'], 'contains-all')).toBe(true); expect(dnsMatches(['1.1.1.1', '8.8.8.8'], ['1.1.1.1'], 'exact')).toBe(false); expect(dnsMatches(['1.1.1.1'], ['8.8.8.8', '1.1.1.1'], 'any')).toBe(true); });
});
