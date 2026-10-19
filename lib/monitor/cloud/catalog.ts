import type { CloudProviderKind, CredentialField } from "@/lib/monitor/cloud/types";

/**
 * Client-safe description of every cloud provider: labels, credential
 * fields, least-privilege setup steps and policies. Pure data with no SDK
 * imports, so the connect form can import it. The server adapters spread
 * their entry from here (single source of truth).
 */

export type CloudProviderCatalogEntry = {
  provider: CloudProviderKind;
  label: string;
  priority: "P0" | "P1";
  credentialFields: CredentialField[];
  setupSteps: string[];
  policy?: string;
  docsUrl: string;
};

/** Read-only IAM policy for the AWS user or role. Describe/List/Get actions don't support resource-level restrictions, hence "*". */
export const AWS_IAM_POLICY = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "SpaceWorksMonitorReadOnly",
        Effect: "Allow",
        Action: [
          "sts:GetCallerIdentity",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
          "cloudwatch:GetMetricData",
          "cloudwatch:DescribeAlarms",
          "rds:DescribeDBInstances",
          "lightsail:GetInstances",
          "ecs:ListClusters",
          "ecs:ListServices",
          "ecs:DescribeServices",
          "route53:ListHealthChecks",
          "route53:GetHealthCheckStatus",
          "ce:GetCostAndUsage",
          "ce:GetCostForecast",
        ],
        Resource: "*",
      },
    ],
  },
  null,
  2,
);

export const CLOUDFLARE_TOKEN_PERMISSIONS = [
  "Zone → Zone: Read",
  "Account → Account Analytics: Read",
  "Account → Workers Scripts: Read",
  "Account → Workers R2 Storage: Read",
];

const token = (label: string, help?: string): CredentialField => ({ key: "token", label, secret: true, help });

export const CLOUD_PROVIDER_CATALOG: CloudProviderCatalogEntry[] = [
  {
    provider: "DIGITALOCEAN",
    label: "DigitalOcean",
    priority: "P0",
    credentialFields: [token("Personal access token", "A Read Only token, or Custom Scopes with read access only.")],
    setupSteps: [
      "In the DigitalOcean control panel, open API → Tokens and choose Generate New Token.",
      "Choose Read Only, or Custom Scopes with only droplet:read, app:read, database:read, load_balancer:read, monitoring:read, billing:read and account:read.",
      "Set an expiry that suits your team, then paste the token here.",
      "Memory and disk metrics need the DigitalOcean metrics agent (do-agent) on each Droplet.",
    ],
    docsUrl: "https://docs.digitalocean.com/reference/api/create-personal-access-token/",
  },
  {
    provider: "AWS",
    label: "Amazon Web Services",
    priority: "P0",
    credentialFields: [
      { key: "accessKeyId", label: "Access key ID", secret: true, optional: true, placeholder: "AKIA…" },
      { key: "secretAccessKey", label: "Secret access key", secret: true, optional: true },
      { key: "roleArn", label: "Role ARN", secret: false, optional: true, placeholder: "arn:aws:iam::123456789012:role/SpaceWorksMonitor", help: "Optional. Space Works assumes this role before reading." },
      { key: "externalId", label: "External ID", secret: true, optional: true, help: "Required by the role's trust policy when you use a role ARN." },
      { key: "regions", label: "Regions", secret: false, optional: true, kind: "list", placeholder: "us-east-1, eu-west-1", help: "Defaults to us-east-1." },
    ],
    setupSteps: [
      "In IAM, create a policy from the JSON below (read-only, no write actions).",
      "Create a dedicated IAM user with that policy and an access key, or a role with that policy.",
      "For a role, its trust policy must allow the access key's user (or the server's own AWS identity) to call sts:AssumeRole with your External ID.",
      "Enable Cost Explorer once in the Billing console, and activate IAM access to billing for non-root users.",
      "Paste the keys (and the role ARN if you use one) and list the regions to watch.",
    ],
    policy: AWS_IAM_POLICY,
    docsUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html",
  },
  {
    provider: "RENDER",
    label: "Render",
    priority: "P0",
    credentialFields: [token("API key")],
    setupSteps: [
      "Render API keys carry the full access of the user who creates them; Render has no read-only keys.",
      "Invite a dedicated team member with the lowest role that can see your services, and create the key from that account.",
      "Open Account Settings → API Keys, create a key and paste it here.",
    ],
    docsUrl: "https://api-docs.render.com/reference/authentication",
  },
  {
    provider: "CLOUDFLARE",
    label: "Cloudflare",
    priority: "P0",
    credentialFields: [
      token("API token"),
      { key: "accountId", label: "Account ID", secret: false, placeholder: "32-character account ID", help: "Shown on the account's Overview page." },
    ],
    setupSteps: [
      "In the Cloudflare dashboard, open My Profile → API Tokens and create a custom token.",
      `Grant only: ${CLOUDFLARE_TOKEN_PERMISSIONS.join("; ")}.`,
      "Scope the token to the account and zones you want to watch, then paste it here with the account ID.",
    ],
    policy: CLOUDFLARE_TOKEN_PERMISSIONS.join("\n"),
    docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
  },
  {
    provider: "HETZNER",
    label: "Hetzner Cloud",
    priority: "P0",
    credentialFields: [token("API token", "A Read token for one project.")],
    setupSteps: [
      "Open the project in the Hetzner Cloud Console and go to Security → API Tokens.",
      "Generate a token with Read permission only and paste it here.",
      "Tokens are per project: connect each project separately.",
    ],
    docsUrl: "https://docs.hetzner.cloud/reference/cloud",
  },
  {
    provider: "VERCEL",
    label: "Vercel",
    priority: "P1",
    credentialFields: [
      token("Access token"),
      { key: "teamId", label: "Team ID", secret: false, optional: true, placeholder: "team_…" },
    ],
    setupSteps: ["Open Account Settings → Tokens and create a token scoped to the team, with an expiry.", "Paste it here, plus the team ID for team projects."],
    docsUrl: "https://vercel.com/docs/rest-api",
  },
  {
    provider: "NETLIFY",
    label: "Netlify",
    priority: "P1",
    credentialFields: [token("Personal access token")],
    setupSteps: ["Open User settings → Applications → Personal access tokens and create a token with an expiry.", "For SSO teams, grant the token access to the team, then paste it here."],
    docsUrl: "https://docs.netlify.com/api/get-started/",
  },
  {
    provider: "FLY",
    label: "Fly.io",
    priority: "P1",
    credentialFields: [
      token("Read-only token", "Create it with fly tokens create readonly."),
      { key: "apps", label: "Apps", secret: false, kind: "list", placeholder: "my-app, my-api" },
    ],
    setupSteps: ["Run fly tokens create readonly (or an app-scoped token for one app).", "Paste the token and list the app names to watch."],
    docsUrl: "https://fly.io/docs/machines/api/",
  },
  {
    provider: "RAILWAY",
    label: "Railway",
    priority: "P1",
    credentialFields: [token("Account or team token")],
    setupSteps: ["Open Account Settings → Tokens and create a token for the workspace you want to watch.", "Paste it here. Railway limits API calls per hour by plan, so syncs are spaced out."],
    docsUrl: "https://docs.railway.com/reference/public-api",
  },
  {
    provider: "GITHUB_ACTIONS",
    label: "GitHub Actions",
    priority: "P1",
    credentialFields: [
      token("Fine-grained token", "Repository permission Actions: Read only."),
      { key: "repos", label: "Repositories", secret: false, kind: "list", placeholder: "owner/repo, owner/other" },
      { key: "branch", label: "Branch", secret: false, optional: true, placeholder: "main" },
    ],
    setupSteps: [
      "Create a fine-grained personal access token limited to the repositories to watch.",
      "Grant only the repository permission Actions: Read (Metadata: Read is added automatically).",
      "Paste the token and list the repositories as owner/repo.",
    ],
    docsUrl: "https://docs.github.com/en/rest/actions/workflow-runs",
  },
  {
    provider: "PROMETHEUS",
    label: "Prometheus",
    priority: "P1",
    credentialFields: [
      { key: "baseUrl", label: "Base URL", secret: false, placeholder: "https://prometheus.example.com" },
      { key: "token", label: "Bearer token", secret: true, optional: true },
    ],
    setupSteps: ["Enter the Prometheus server URL that answers /api/v1/query.", "Add a bearer token if a proxy protects it. Use PromQL monitors to alert on queries."],
    docsUrl: "https://prometheus.io/docs/prometheus/latest/querying/api/",
  },
];

export function catalogEntry(provider: CloudProviderKind): CloudProviderCatalogEntry {
  const entry = CLOUD_PROVIDER_CATALOG.find((item) => item.provider === provider);
  if (!entry) throw new Error(`Unknown cloud provider ${provider}`);
  return entry;
}
