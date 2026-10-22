// Keep tagged images and all children of tagged multi-platform indices.
// Never delete anything if registry metadata cannot be fully read.
import { execFileSync } from 'node:child_process';
const owner=process.env.OWNER,kind=process.env.OWNER_TYPE==='User'?'users':'orgs';
if(!/^[a-zA-Z0-9-]+$/.test(owner||''))throw new Error('A registry owner is required.');
const gh=args=>JSON.parse(execFileSync('gh',args,{encoding:'utf8',maxBuffer:32*1024*1024}));
for(const image of ['spaceworks-workspace-backend','spaceworks-workspace-frontend']) {
  const endpoint=`/${kind}/${owner}/packages/container/${image}/versions`;
  const versions=gh(['api','--paginate','--slurp',`${endpoint}?per_page=100`]).flat();
  const protectedDigests=new Set();
  for(const version of versions.filter(v=>v.metadata?.container?.tags?.length)) {
    protectedDigests.add(version.name);
    const manifest=JSON.parse(execFileSync('docker',['buildx','imagetools','inspect','--raw',`ghcr.io/${owner}/${image}@${version.name}`],{encoding:'utf8',maxBuffer:8*1024*1024}));
    for(const child of manifest.manifests||[])protectedDigests.add(child.digest);
  }
  const candidates=versions.filter(v=>!v.metadata?.container?.tags?.length&&!protectedDigests.has(v.name)).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(30);
  for(const version of candidates) execFileSync('gh',['api','--method','DELETE',`${endpoint}/${version.id}`],{stdio:'inherit'});
  console.log(`${image}: retained tagged/platform images and 30 recent untagged versions; removed ${candidates.length} old untagged versions.`);
}
