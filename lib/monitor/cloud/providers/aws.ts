import "server-only";
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { EC2Client, DescribeInstancesCommand, DescribeInstanceStatusCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { LightsailClient, GetInstancesCommand } from "@aws-sdk/client-lightsail";
import { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand } from "@aws-sdk/client-ecs";
import { Route53Client, ListHealthChecksCommand, GetHealthCheckStatusCommand } from "@aws-sdk/client-route-53";
import { CloudWatchClient, GetMetricDataCommand, DescribeAlarmsCommand, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } from "@aws-sdk/client-cost-explorer";
import { catalogEntry } from "../catalog";
import { configList, configString, monthStartUtc, nextMonthStartUtc } from "./common";
import { CloudApiError, type AdapterContext, type CloudProviderAdapter, type ResourceSnapshot, type MetricPoint, type CloudAlarm, type CostInput } from "../types";
import { providerHealth } from "./rest";
async function options(ctx: AdapterContext, region: string) {
    let credentials = ctx.credentials.accessKeyId && ctx.credentials.secretAccessKey ? { accessKeyId: ctx.credentials.accessKeyId, secretAccessKey: ctx.credentials.secretAccessKey, sessionToken: undefined as string | undefined } : undefined;
    const role = configString(ctx, "roleArn");
    if (role) {
        const sts = new STSClient({ region, credentials, maxAttempts: 3 });
        try {
            const result = await sts.send(new AssumeRoleCommand({ RoleArn: role, ExternalId: ctx.credentials.externalId, RoleSessionName: "SpaceWorksMonitor", DurationSeconds: 900 }), { abortSignal: ctx.signal });
            const c = result.Credentials;
            if (!c?.AccessKeyId || !c.SecretAccessKey)
                throw new CloudApiError("AWS did not return role credentials.", "auth");
            credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
        }
        finally {
            sts.destroy();
        }
    }
    return { region, credentials, maxAttempts: 3, retryMode: "adaptive" as const, requestHandler: { requestTimeout: 15000, connectionTimeout: 5000 } };
}
const regions = (ctx: AdapterContext) => { const list = configList(ctx, "regions"); return (list.length ? list : ["us-east-1"]).slice(0, 10); };
export function ecsHealth(running: number, desired: number, failed: boolean) { return failed ? "UNHEALTHY" as const : desired === 0 ? "STOPPED" as const : running < desired ? "DEGRADED" as const : "HEALTHY" as const; }
async function inventory(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
    const out: ResourceSnapshot[] = [];
    for (const region of regions(ctx)) {
        const opts = await options(ctx, region);
        const ec2 = new EC2Client(opts), rds = new RDSClient(opts), lightsail = new LightsailClient(opts), ecs = new ECSClient(opts);
        try {
            const impaired = new Set<string>();
            let statusToken: string | undefined;
            do {
                const statuses = await ec2.send(new DescribeInstanceStatusCommand({ IncludeAllInstances: true, NextToken: statusToken }), { abortSignal: ctx.signal });
                for (const item of statuses.InstanceStatuses ?? []) if (item.InstanceId && (item.InstanceStatus?.Status === "impaired" || item.SystemStatus?.Status === "impaired")) impaired.add(item.InstanceId);
                statusToken = statuses.NextToken;
            } while (statusToken);
            let token: string | undefined;
            do {
                const page = await ec2.send(new DescribeInstancesCommand({ NextToken: token, MaxResults: 100 }), { abortSignal: ctx.signal });
                for (const reservation of page.Reservations ?? [])
                    for (const row of reservation.Instances ?? []) {
                        if (!row.InstanceId)
                            continue;
                        out.push({ externalId: `${region}:${row.InstanceId}`, kind: "ec2", name: row.Tags?.find(t => t.Key === "Name")?.Value ?? row.InstanceId, region, status: impaired.has(row.InstanceId) ? "UNHEALTHY" : providerHealth(row.State?.Name), statusDetail: row.State?.Name });
                    }
                token = page.NextToken;
            } while (token);
            let marker: string | undefined;
            do {
                const page = await rds.send(new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100 }), { abortSignal: ctx.signal });
                for (const row of page.DBInstances ?? [])
                    if (row.DBInstanceIdentifier)
                        out.push({ externalId: `${region}:rds:${row.DBInstanceIdentifier}`, kind: "rds", name: row.DBInstanceIdentifier, region, status: providerHealth(row.DBInstanceStatus), statusDetail: row.DBInstanceStatus });
                marker = page.Marker;
            } while (marker);
            let pageToken: string | undefined;
            do {
                const page = await lightsail.send(new GetInstancesCommand({ pageToken }), { abortSignal: ctx.signal });
                for (const row of page.instances ?? [])
                    if (row.name)
                        out.push({ externalId: `${region}:lightsail:${row.name}`, kind: "lightsail", name: row.name, region, status: providerHealth(row.state?.name), statusDetail: row.state?.name });
                pageToken = page.nextPageToken;
            } while (pageToken);
            let clusterToken: string | undefined;
            do {
                const clusters = await ecs.send(new ListClustersCommand({ nextToken: clusterToken }), { abortSignal: ctx.signal });
                for (const cluster of clusters.clusterArns ?? []) {
                    let serviceToken: string | undefined;
                    do {
                        const services = await ecs.send(new ListServicesCommand({ cluster, nextToken: serviceToken, maxResults: 100 }), { abortSignal: ctx.signal });
                        const arns = services.serviceArns ?? [];
                        for (let i = 0; i < arns.length; i += 10) {
                            const result = await ecs.send(new DescribeServicesCommand({ cluster, services: arns.slice(i, i + 10) }), { abortSignal: ctx.signal });
                            for (const row of result.services ?? [])
                                if (row.serviceArn)
                                    out.push({ externalId: row.serviceArn, kind: "ecs_service", name: row.serviceName ?? row.serviceArn, region, status: ecsHealth(row.runningCount ?? 0, row.desiredCount ?? 0, row.deployments?.some(d => d.rolloutState === "FAILED") ?? false), raw: { cluster: cluster.split("/").at(-1) ?? cluster, service: row.serviceName ?? "" } });
                        }
                        serviceToken = services.nextToken;
                    } while (serviceToken);
                }
                clusterToken = clusters.nextToken;
            } while (clusterToken);
        }
        finally {
            ec2.destroy();
            rds.destroy();
            lightsail.destroy();
            ecs.destroy();
        }
    }
    const r53 = new Route53Client(await options(ctx, "us-east-1"));
    try {
        let marker: string | undefined;
        do {
            const page = await r53.send(new ListHealthChecksCommand({ Marker: marker, MaxItems: 100 }), { abortSignal: ctx.signal });
            for (const row of page.HealthChecks ?? []) {
                if (!row.Id)
                    continue;
                const health = await r53.send(new GetHealthCheckStatusCommand({ HealthCheckId: row.Id }), { abortSignal: ctx.signal });
                const observations = health.HealthCheckObservations ?? [];
                out.push({ externalId: `route53:${row.Id}`, kind: "r53_healthcheck", name: row.HealthCheckConfig?.FullyQualifiedDomainName ?? row.Id, region: "global", status: observations.length ? observations.some(o => !o.StatusReport?.Status?.startsWith("Success")) ? "UNHEALTHY" : "HEALTHY" : "UNKNOWN" });
            }
            marker = page.IsTruncated ? page.NextMarker : undefined;
        } while (marker);
    }
    finally {
        r53.destroy();
    }
    return out;
}
async function metrics(ctx: AdapterContext, resources: ResourceSnapshot[]): Promise<MetricPoint[]> {
    const out: MetricPoint[] = [];
    for (const region of regions(ctx)) {
        const selected = resources.filter(r => r.region === region && ["ec2", "rds", "ecs_service"].includes(r.kind));
        const queries: MetricDataQuery[] = [];
        const refs: Array<{
            externalId: string;
            metric: string;
        }> = [];
        for (const r of selected) {
            const definitions = r.kind === "ec2" ? ["CPUUtilization", "NetworkIn", "NetworkOut", "StatusCheckFailed"] : r.kind === "rds" ? ["CPUUtilization", "FreeStorageSpace", "DatabaseConnections", "FreeableMemory"] : ["CPUUtilization", "MemoryUtilization"];
            for (const metric of definitions) {
                const dimensions = r.kind === "ec2" ? [{ Name: "InstanceId", Value: r.externalId.split(":").at(-1)! }] : r.kind === "rds" ? [{ Name: "DBInstanceIdentifier", Value: r.name }] : [{ Name: "ClusterName", Value: String(r.raw?.cluster) }, { Name: "ServiceName", Value: String(r.raw?.service) }];
                refs.push({ externalId: r.externalId, metric });
                queries.push({ Id: `m${refs.length - 1}`, MetricStat: { Metric: { Namespace: r.kind === "ec2" ? "AWS/EC2" : r.kind === "rds" ? "AWS/RDS" : "AWS/ECS", MetricName: metric, Dimensions: dimensions }, Period: 300, Stat: "Average" }, ReturnData: true });
            }
        }
        const client = new CloudWatchClient(await options(ctx, region));
        try {
            for (let offset = 0; offset < queries.length; offset += 500) {
                let token: string | undefined;
                do {
                    const result = await client.send(new GetMetricDataCommand({ MetricDataQueries: queries.slice(offset, offset + 500), StartTime: new Date(ctx.now.getTime() - 900000), EndTime: ctx.now, NextToken: token }), { abortSignal: ctx.signal });
                    for (const row of result.MetricDataResults ?? []) {
                        const ref = refs[Number(row.Id?.slice(1))];
                        if (ref)
                            row.Values?.forEach((value, i) => { if (row.Timestamps?.[i])
                                out.push({ ...ref, value, ts: row.Timestamps[i] }); });
                    }
                    token = result.NextToken;
                } while (token);
            }
        }
        finally {
            client.destroy();
        }
    }
    return out;
}
async function alarms(ctx: AdapterContext): Promise<CloudAlarm[]> {
    const out: CloudAlarm[] = [];
    for (const region of regions(ctx)) {
        const client = new CloudWatchClient(await options(ctx, region));
        try {
            let token: string | undefined;
            do {
                const page = await client.send(new DescribeAlarmsCommand({ NextToken: token }), { abortSignal: ctx.signal });
                out.push(...(page.MetricAlarms ?? []).map(a => ({ name: `${region}: ${a.AlarmName ?? "Alarm"}`, state: a.StateValue ?? "UNKNOWN", reason: a.StateReason })));
                token = page.NextToken;
            } while (token);
        }
        finally {
            client.destroy();
        }
    }
    return out;
}
async function costs(ctx: AdapterContext): Promise<CostInput[]> {
    const client = new CostExplorerClient(await options(ctx, "us-east-1"));
    const start = monthStartUtc(ctx.now), end = nextMonthStartUtc(ctx.now);
    const date = (d: Date) => d.toISOString().slice(0, 10);
    const out: CostInput[] = [];
    try {
        const days = new Map<string, CostInput>();
        let token: string | undefined;
        if (date(ctx.now) > date(start)) do {
            const usage = await client.send(new GetCostAndUsageCommand({ TimePeriod: { Start: date(start), End: date(ctx.now) }, Granularity: "DAILY", Metrics: ["UnblendedCost"], GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }], NextPageToken: token }), { abortSignal: ctx.signal });
            for (const day of usage.ResultsByTime ?? []) {
                if (!day.TimePeriod?.Start || !day.TimePeriod.End) continue;
                const key = day.TimePeriod.Start;
                const row = days.get(key) ?? { granularity: "DAY", periodStart: new Date(key), periodEnd: new Date(day.TimePeriod.End), amount: 0, currency: "USD", breakdown: [], isEstimate: false };
                const breakdown = new Map((row.breakdown ?? []).map(item => [item.service, item.amount]));
                for (const group of day.Groups ?? []) {
                    const value = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
                    if (!Number.isFinite(value)) continue;
                    const service = group.Keys?.[0] ?? "Other";
                    breakdown.set(service, (breakdown.get(service) ?? 0) + value);
                    row.amount += value;
                    row.currency = group.Metrics?.UnblendedCost?.Unit ?? row.currency;
                }
                row.breakdown = [...breakdown].map(([service, amount]) => ({ service, amount }));
                row.isEstimate = row.isEstimate || day.Estimated === true;
                days.set(key, row);
            }
            token = usage.NextPageToken;
        } while (token);
        out.push(...days.values());
        const forecast = await client.send(new GetCostForecastCommand({ TimePeriod: { Start: date(ctx.now), End: date(end) }, Metric: "UNBLENDED_COST", Granularity: "MONTHLY" }), { abortSignal: ctx.signal }).catch(() => null);
        if (forecast?.Total?.Amount)
            out.push({ granularity: "FORECAST", periodStart: start, periodEnd: end, amount: Number(forecast.Total.Amount), currency: forecast.Total.Unit ?? "USD", isEstimate: true });
        return out;
    }
    finally {
        client.destroy();
    }
}
export const awsAdapter: CloudProviderAdapter = { ...catalogEntry("AWS"), minRequestSpacingMs: 250,
    verify: async (ctx) => { const client = new STSClient(await options(ctx, regions(ctx)[0])); try {
        const result = await client.send(new GetCallerIdentityCommand({}), { abortSignal: ctx.signal });
        return { ok: true, accountLabel: result.Account ?? null };
    }
    catch {
        return { ok: false, error: "AWS rejected the credentials or role. Check the read policy and trust policy, then try again." };
    }
    finally {
        client.destroy();
    } },
    listResources: inventory, getMetrics: metrics, getCosts: costs, listAlarms: alarms, };
