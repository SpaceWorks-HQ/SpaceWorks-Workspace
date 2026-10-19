import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { repositoryItems } from "@/lib/integrations/github/api";
/** Reusable Server Component; performs its own workspace and project visibility checks. */
export async function GithubPullRequests({ workspaceSlug, projectId }: { workspaceSlug: string; projectId: string }) {
  const { workspace, membership } = await requireWorkspace(workspaceSlug);
  const hidden = await hiddenTeamIds(workspace.id, membership);
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: workspace.id, ...teamScopeFilter(hidden) }, select: { id: true } });
  if (!project) return null;
  const repos = await prisma.githubRepo.findMany({ where: { workspaceId: workspace.id, linkedProjectId: projectId, connection: { workspaceId: workspace.id, status: "ACTIVE" } } });
  return <section className="space-y-4"><h2 className="text-h2">GitHub pull requests and issues</h2>{!repos.length ? <p>No repository linked. Ask an admin to link one in integration settings.</p> : await Promise.all(repos.map(async repo => {
    try { const items = await repositoryItems(repo.installationId, repo.fullName); return <div key={repo.id}><h3 className="text-h3">{repo.fullName}</h3><ul>{items.map(i => <li className="py-2" key={i.id}><a className="text-accent-text underline" href={i.html_url} rel="noreferrer" target="_blank">{i.pull_request ? "PR" : "Issue"} #{i.number}: {i.title}</a></li>)}</ul>{!items.length ? <p>No open pull requests or issues.</p> : null}</div>; } catch { return <p key={repo.id}>Couldn’t load {repo.fullName}. Ask an admin to check the connection.</p>; }
  }))}</section>;
}
