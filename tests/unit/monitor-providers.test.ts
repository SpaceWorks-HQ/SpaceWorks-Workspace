import { beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  const send = vi.fn();
  return { send, module: (names: string[]) => Object.fromEntries(names.map(name => [name, name.endsWith('Client') ? class { send = send; destroy() {} } : class { kind = name; constructor(public input: unknown) {} }])) };
});
vi.mock('@aws-sdk/client-ec2', () => sdk.module(['EC2Client', 'DescribeInstancesCommand', 'DescribeInstanceStatusCommand']));
vi.mock('@aws-sdk/client-rds', () => sdk.module(['RDSClient', 'DescribeDBInstancesCommand']));
vi.mock('@aws-sdk/client-ecs', () => sdk.module(['ECSClient', 'ListClustersCommand', 'ListServicesCommand', 'DescribeServicesCommand']));
vi.mock('@aws-sdk/client-lightsail', () => sdk.module(['LightsailClient', 'GetInstancesCommand']));
vi.mock('@aws-sdk/client-route-53', () => sdk.module(['Route53Client', 'ListHealthChecksCommand', 'GetHealthCheckStatusCommand']));
vi.mock('@aws-sdk/client-cloudwatch', () => sdk.module(['CloudWatchClient', 'GetMetricDataCommand', 'DescribeAlarmsCommand']));
vi.mock('@aws-sdk/client-cost-explorer', () => sdk.module(['CostExplorerClient', 'GetCostAndUsageCommand', 'GetCostForecastCommand']));
vi.mock('@aws-sdk/client-sts', () => sdk.module(['STSClient', 'GetCallerIdentityCommand', 'AssumeRoleCommand']));
vi.mock('@/lib/monitor/net/http', () => ({ guardedRequest: vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({ status: 'success', data: { result: [{ metric: { instance: 'example:9090' }, value: [1, '1'] }] } }) })) }));
import { digitalOceanAdapter, cpuPercent } from '@/lib/monitor/cloud/providers/digitalocean';
import { awsAdapter } from '@/lib/monitor/cloud/providers/aws';
import { restAdapter } from '@/lib/monitor/cloud/providers/rest';
import { trimRaw, type AdapterContext, type CloudProviderKind } from '@/lib/monitor/cloud/types';

const now = new Date('2026-10-19T12:00:00Z');
function context(answer: (url: string) => unknown): AdapterContext {
  return { now, credentials: { token: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture' }, config: { accountId: 'account', apps: ['crew'], repos: ['crew/build'] }, http: { json: async <T>(url: string) => ({ status: 200, headers: new Headers(), data: answer(url) as T }) } };
}
beforeEach(() => { sdk.send.mockReset(); });
describe('monitor provider fixture mapping', () => {
  it('maps DigitalOcean inventory, deployment health and balances without retaining credentials', async () => {
    const ctx = context(url => url.includes('/droplets') ? { droplets: [{ id: 1, name: 'Web', status: 'active', region: { slug: 'blr1' }, password: 'never-retain' }] } : url.includes('/apps') ? { apps: [{ id: 'app', spec: { name: 'Crew' }, active_deployment: { phase: 'ACTIVE' } }] } : url.includes('/databases') ? { databases: [{ id: 'db', name: 'Database', status: 'online', engine: 'pg', password: 'never-retain' }] } : url.includes('/load_balancers') ? { load_balancers: [{ id: 'lb', name: 'Balancer', status: 'errored' }] } : url.includes('/balance') ? { month_to_date_usage: '12.34', account_balance: '-5' } : {});
    const rows = await digitalOceanAdapter.listResources(ctx); expect(rows.map(r => r.status)).toEqual(['HEALTHY', 'HEALTHY', 'HEALTHY', 'UNHEALTHY']); expect(JSON.stringify(rows)).not.toContain('never-retain');
    expect(await digitalOceanAdapter.getCosts!(ctx)).toEqual(expect.arrayContaining([expect.objectContaining({ granularity: 'MTD', amount: 12.34 }), expect.objectContaining({ granularity: 'BALANCE', amount: -5 })]));
  });
  it('calculates CPU from counter deltas', () => { expect(cpuPercent([{ metric: { mode: 'idle' }, values: [[1, '100'], [2, '160']] }, { metric: { mode: 'user' }, values: [[1, '0'], [2, '40']] }])?.value).toBe(40); });
  it.each([
    ['RENDER', (u: string) => u.includes('/deploys') ? [{ deploy: { status: 'live' } }] : [{ service: { id: 's', name: 'Web', suspended: 'not_suspended' } }], 'HEALTHY'],
    ['CLOUDFLARE', (u: string) => u.includes('/zones') ? { result: [{ id: 'z', name: 'example.com', status: 'active' }] } : { result: [] }, 'HEALTHY'],
    ['HETZNER', (u: string) => u.includes('/servers') ? { servers: [{ id: 1, name: 'Web', status: 'running' }] } : { load_balancers: [] }, 'HEALTHY'],
    ['VERCEL', (u: string) => u.includes('/projects') ? { projects: [{ id: 'p', name: 'Web' }] } : { deployments: [{ readyState: 'READY', url: 'crew.vercel.app' }] }, 'HEALTHY'],
    ['NETLIFY', (u: string) => u.includes('/deploys') ? [{ state: 'error' }] : [{ id: 's', name: 'Web' }], 'UNHEALTHY'],
    ['FLY', () => [{ id: 'm', name: 'Web', state: 'started', checks: [] }], 'HEALTHY'],
    ['RAILWAY', () => ({ data: { projects: { edges: [{ node: { name: 'Crew', services: { edges: [{ node: { id: 's', name: 'Web', deployments: { edges: [{ node: { status: 'SUCCESS' } }] } } }] } } }] } } }), 'HEALTHY'],
    ['GITHUB_ACTIONS', () => ({ workflow_runs: [{ id: 1, workflow_id: 'w', name: 'Build', conclusion: 'failure' }] }), 'UNHEALTHY'],
    ['PROMETHEUS', () => ({}), 'HEALTHY'],
  ] as Array<[CloudProviderKind, (url: string) => unknown, string]>)('maps %s using fixtures', async (provider, answer, status) => {
    const ctx = context(answer); ctx.config.baseUrl = 'https://metrics.example.com';
    const rows = await restAdapter(provider).listResources(ctx); expect(rows[0].status).toBe(status);
  });
  it('maps paginated AWS inventory and health using SDK fixtures only', async () => {
    sdk.send.mockImplementation(async (cmd: { kind: string; input: { NextToken?: string } }) => {
      if (cmd.kind === 'DescribeInstanceStatusCommand') return { InstanceStatuses: [{ InstanceId: 'i-1', SystemStatus: { Status: 'impaired' } }] };
      if (cmd.kind === 'DescribeInstancesCommand') return cmd.input.NextToken ? { Reservations: [{ Instances: [{ InstanceId: 'i-2', State: { Name: 'running' } }] }] } : { Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'running' } }] }], NextToken: 'next' };
      if (cmd.kind === 'DescribeDBInstancesCommand') return { DBInstances: [{ DBInstanceIdentifier: 'db', DBInstanceStatus: 'available' }] };
      if (cmd.kind === 'GetInstancesCommand') return { instances: [{ name: 'Light', state: { name: 'stopped' } }] };
      if (cmd.kind === 'ListHealthChecksCommand') return { HealthChecks: [{ Id: 'h', HealthCheckConfig: { FullyQualifiedDomainName: 'example.com' } }] };
      if (cmd.kind === 'GetHealthCheckStatusCommand') return { HealthCheckObservations: [{ StatusReport: { Status: 'Success: HTTP 200' } }] };
      return {};
    });
    const rows = await awsAdapter.listResources(context(() => ({}))); expect(rows.map(r => r.status)).toEqual(['UNHEALTHY', 'HEALTHY', 'HEALTHY', 'STOPPED', 'HEALTHY']);
  });
  it('combines paginated AWS cost groups without losing a day or counting a forecast as spend', async () => {
    sdk.send.mockImplementation(async (cmd: { kind: string; input: { NextPageToken?: string } }) => {
      if (cmd.kind === 'GetCostForecastCommand') return { Total: { Amount: '40', Unit: 'USD' } };
      if (cmd.kind === 'GetCostAndUsageCommand') return { ResultsByTime: [{ TimePeriod: { Start: '2026-10-18', End: '2026-10-19' }, Groups: [{ Keys: [cmd.input.NextPageToken ? 'Storage' : 'Compute'], Metrics: { UnblendedCost: { Amount: cmd.input.NextPageToken ? '2.25' : '5.50', Unit: 'USD' } } }] }], ...(cmd.input.NextPageToken ? {} : { NextPageToken: 'second' }) };
      return {};
    });
    const costs = await awsAdapter.getCosts!(context(() => ({})));
    expect(costs).toHaveLength(2); expect(costs.find(c => c.granularity === 'DAY')).toMatchObject({ amount: 7.75, currency: 'USD', breakdown: [{ service: 'Compute', amount: 5.5 }, { service: 'Storage', amount: 2.25 }] }); expect(costs.find(c => c.granularity === 'FORECAST')?.amount).toBe(40);
  });
  it('removes secret-like keys and nested provider data', () => { expect(trimRaw({ id: 1, auth: 'no', private_key: 'no', connection: { password: 'no' } })).toEqual({ id: 1 }); });
});
