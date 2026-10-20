# Release and installation area

Space Works Workspace uses a pinned, no-source-build curl installer, matching backend/frontend/all-in-one images, modular Compose deployment, backup-first updates and explicit offline recovery. VERSION starts at 0.1.0. Continuous Release builds both architectures and promotes rolling tags only for the current main head. A changed VERSION/manual main dispatch publishes the runtime bundle.

Owned surfaces: root Dockerfiles/install/setup/version, scripts, docker, deploy, workflows, cloud manifests, Helm and deployment documentation. No application model, tenant/role rule, route or page is changed. There is no release-area seed data or ComingSoon page; deployments create no accounts or demo rows. The first owner uses the existing /setup flow.

Security retained from the previous installer: internal TLS for PostgreSQL/Redis/Silo, least-privilege runtime database role, private S3 bucket with restricted app credentials, scheduler bearer isolation, segmented networks, no published data ports, checked backups and explicit restore acknowledgement. HTTP-only production is refused by the existing application guard. Native PowerShell delegates to WSL2 rather than emulating Unix permissions.

Verification entry points: scripts/verify-release-local.sh (shell/JS/Python/YAML/Compose/Helm and dry questionnaire), scripts/test-release-local.sh (real local three-image build and both installed shapes), repository lint/typecheck/unit/integration/build. The smoke harness creates only its own projects, volumes, networks and temporary installation paths and tears them down. See the final handoff for actual runs and environment limits.
