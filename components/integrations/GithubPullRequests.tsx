import { loadGithubPullRequests } from "@/lib/views/components";
/** Reusable Server Component; performs its own workspace and project visibility checks. */
export async function GithubPullRequests({ workspaceSlug, projectId }: { workspaceSlug: string; projectId: string }) {
  const repos = await loadGithubPullRequests({ params: { workspaceSlug, projectId } });
  if (!repos) return null;
  return <section className="min-w-0 space-y-4 [overflow-wrap:anywhere]"><h2 className="text-h2">GitHub pull requests and issues</h2>{!repos.length ? <p>No repository linked. Ask an admin to link one in integration settings.</p> : repos.map(repo => {
    const items = repo.items; if (items) return <div key={repo.id}><h3 className="text-h3">{repo.fullName}</h3><ul>{items.map(i => <li className="py-2" key={i.id}><a className="inline-flex min-h-11 items-center text-accent-text underline" href={i.html_url} rel="noreferrer" target="_blank">{i.pull_request ? "PR" : "Issue"} #{i.number}: {i.title}</a></li>)}</ul>{!items.length ? <p>No open pull requests or issues.</p> : null}</div>; else return <p key={repo.id}>Couldn’t load {repo.fullName}. Ask an admin to check the connection.</p>;
  })}</section>;
}
