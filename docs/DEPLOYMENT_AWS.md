# Deploy on AWS

[VPS](DEPLOYMENT_VPS.md) · [Cloud platforms](DEPLOYMENT_CLOUD.md) · [Kubernetes](DEPLOYMENT_KUBERNETES.md) · [Configuration](CONFIGURATION.md)

Two paths. Start with the first; move to the second when you want managed
data services or several app instances.

| | Path A: one EC2 instance | Path B: ECS Fargate + managed services |
| --- | --- | --- |
| App | Curl installer, complete Docker stack | Fargate service behind an ALB |
| Database | PostgreSQL container (TLS) | RDS for PostgreSQL 16 |
| Redis | Redis container (TLS) | ElastiCache (Valkey/Redis OSS) with in-transit encryption |
| Files | Silo container | S3 bucket, task IAM role |
| Cost (approx.) | one t3.medium + EBS | Fargate + ALB + RDS + ElastiCache |

## Path A: EC2 with the installer (minimal working path)

1. **Launch** Ubuntu Server 24.04 LTS, `t3.medium` (or `t4g.medium` on ARM;
   the images are multi-arch), 40 GB gp3, in a public subnet. Allocate and
   associate an **Elastic IP**.
2. **Security group** inbound: TCP 22 from your IP only; TCP 80 and 443 and
   UDP 443 from `0.0.0.0/0` (and `::/0` with IPv6). Nothing else.
3. **DNS**: an A record for `work.example.org` pointing at the Elastic IP
   (Route 53 or your DNS provider). Wait until it resolves.
4. **Install** over SSH:

   ```bash
   ssh ubuntu@<elastic-ip>
   SWW_REF=<reviewed-commit-or-tag>
   curl -fsSL "https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/$SWW_REF/install.sh" -o install.sh
   sudo bash install.sh --ref "$SWW_REF"        # add SWW_GITHUB_TOKEN=... while the repo is private
   ```

   Or paste the unattended form from the
   [VPS guide](DEPLOYMENT_VPS.md#unattended-install-cloud-init-terraform) into
   **Advanced details → User data** (prefix it with `#!/bin/bash`). Keep
   secrets such as the SMTP key in SSM Parameter Store and fetch them in the
   script rather than pasting them into user data.
5. Open `https://work.example.org/setup`.

**Email**: new AWS accounts block outbound port 25 only; port 587 to an
external relay works. Amazon SES works as the relay: verify the domain, create
SMTP credentials, use `email-smtp.<region>.amazonaws.com:587`.

**Backups**: enable the daily backup timer during setup, add
`backup-remote.env` pointing at a dedicated S3 bucket (versioning or Object
Lock, SSE on, an IAM user that can only `s3:PutObject`/`s3:ListBucket` on it):

```bash
MC_HOST_remote='https://AKIA...:SECRET@s3.ap-south-1.amazonaws.com'
REMOTE_BUCKET='sww-backups-123456789012'
```

Add **AWS Backup** or Data Lifecycle Manager snapshots of the EBS volume as a
second line of defence.

## Path B: ECS Fargate, RDS, ElastiCache, S3

1. **Images**: publish to GHCR ([Container images](CONTAINER_IMAGES.md)) or
   push the two targets to ECR:

   ```bash
   aws ecr create-repository --repository-name spaceworks-workspace
   aws ecr create-repository --repository-name spaceworks-workspace-migrator
   docker buildx build --platform linux/amd64 -t <acct>.dkr.ecr.<region>.amazonaws.com/spaceworks-workspace:<sha> --push .
   docker buildx build --platform linux/amd64 --target migrator -t <acct>.dkr.ecr.<region>.amazonaws.com/spaceworks-workspace-migrator:<sha> --push .
   ```

2. **Network**: a VPC with two public subnets (ALB) and two private subnets
   (tasks, RDS, ElastiCache), a NAT gateway or VPC endpoints for egress (SMTP,
   AI provider, OAuth).
3. **RDS for PostgreSQL 16**: Multi-AZ for production, storage encrypted,
   automated backups with point-in-time recovery, `rds.force_ssl=1`. Create a
   migration user (owner) and a runtime user with DML only, as the VPS stack
   does (`docker/vps/init-database.sh` has the grants).
   `DATABASE_URL=postgresql://sww_app:...@<endpoint>:5432/sww?sslmode=require`,
   `DIRECT_URL` with the owner user for migrations (migration task only).
4. **ElastiCache** (Valkey or Redis OSS), in-transit encryption and AUTH on:
   `REDIS_URL=rediss://default:<auth-token>@<primary-endpoint>:6379`.
5. **S3**: a private bucket (Block Public Access on, SSE-S3 or SSE-KMS,
   versioning on). Give the **task role** `s3:GetObject`, `s3:PutObject`,
   `s3:DeleteObject` on `arn:aws:s3:::bucket/*` and `s3:ListBucket` on the
   bucket; then set `S3_BUCKET`, `S3_REGION` and leave `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY` and `S3_ENDPOINT` empty (the SDK uses the role).
6. **Secrets**: store every variable from [Configuration](CONFIGURATION.md) in
   Secrets Manager or SSM Parameter Store and reference them from the task
   definition (`secrets:`). The task execution role needs read access.
7. **Task definitions**:
   - `web`: app image, port 3000, 1 vCPU / 2 GB, `readonlyRootFilesystem: true`
     with ephemeral volumes on `/tmp` and `/app/.next/cache`, health check
     `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
   - `migrate`: migrator image, run once per release with
     `aws ecs run-task` before updating the service (or set
     `MIGRATE_ON_START=1` when running exactly one task).
   - `scheduler`: app image, command `node /app/scripts/scheduler.mjs --once`,
     env `APP_URL=https://work.example.org` and `CRON_SECRET`, triggered every
     minute by an **EventBridge Scheduler** rule (`rate(1 minute)`).
8. **ALB**: HTTPS listener with an ACM certificate, target group on port 3000,
   health check `/api/health`, **idle timeout 3600 s** (Server-Sent Events),
   HTTP→HTTPS redirect. The ALB appends the client address to
   `X-Forwarded-For`: set `TRUSTED_PROXY_IP_HEADER=x-forwarded-for` and
   `TRUSTED_PROXY_HOPS=1`. Add AWS WAF if you want managed rule sets.
9. **Service**: desired count 2 across both private subnets, minimum healthy
   100 %, deployment circuit breaker with rollback on. Point Route 53 at the ALB.
10. Open `https://work.example.org/setup`.

**Lightsail** is a cheaper middle ground: a Lightsail instance (4 GB) with the
curl installer is Path A; Lightsail container services can run the app image
with Lightsail managed PostgreSQL (`sslmode=require`), but have no managed
Redis, so pair them with Upstash.

## Checks

```bash
curl -fsS https://work.example.org/api/health
curl -fsS -H "Authorization: Bearer $HEALTHCHECK_SECRET" https://work.example.org/api/health/db
```

Set CloudWatch alarms on ALB 5xx, target health, RDS CPU/storage/connections,
ElastiCache memory, and on the scheduler task failing.
