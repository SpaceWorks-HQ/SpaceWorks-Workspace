// Fails when a page in the rendering-only frontend workspace can reach lib/db.
// Mirrors scripts/prepare-frontend.mjs: rewritten pages, stubbed actions and
// views, pure-export facades and the permissions/storage substitutions.
import ts from 'typescript';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const pages = new Map(JSON.parse(readFileSync(path.join(root,'frontend/pages.json'),'utf8')).map(p=>[p.file,p.source]));
const catalog = JSON.parse(readFileSync(path.join(root,'frontend/catalog.json'),'utf8'));
const stubbed = new Set([...catalog.actions.map(a=>a.module), ...catalog.readers.filter(r=>r.module==='lib/views/components').map(r=>r.module)]);
const pure = JSON.parse(readFileSync(path.join(root,'frontend/pure-exports.json'),'utf8'));
function resolve(from, spec){
  let base;
  if(spec.startsWith('@/')) base=path.join(root,spec.slice(2));
  else if(spec.startsWith('.')) base=path.resolve(path.dirname(from),spec);
  else return null;
  for(const ext of ['','.ts','.tsx','/index.ts','/index.tsx']) { const f=base+ext; if(existsSync(f)&&statSync(f).isFile()) return f; }
  return null;
}
function usedImports(file, source){
  const sf=ts.createSourceFile(file,source,99,true,file.endsWith('x')?4:3);
  const helpers=sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name&&!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword));
  const dead=new Set(helpers.filter(fn=>{const names=new Set();const scan=n=>{if(ts.isIdentifier(n))names.add(n.text);ts.forEachChild(n,scan);};sf.statements.filter(n=>n!==fn&&!ts.isImportDeclaration(n)).forEach(scan);return !names.has(fn.name.text);}));
  const refs=new Set(); const visit=n=>{ if(ts.isImportDeclaration(n)||dead.has(n))return; if(ts.isIdentifier(n))refs.add(n.text); ts.forEachChild(n,visit); }; ts.forEachChild(sf,visit);
  const out=[];
  for(const st of sf.statements){
    if(ts.isExportDeclaration(st)&&st.moduleSpecifier&&!st.isTypeOnly){out.push({spec:st.moduleSpecifier.text,names:null});continue;}
    if(!ts.isImportDeclaration(st))continue;
    const c=st.importClause; const spec=st.moduleSpecifier.text;
    if(!c){out.push({spec,names:null});continue;}
    if(c.isTypeOnly)continue;
    const names=[]; if(c.name&&refs.has(c.name.text))names.push('default');
    const b=c.namedBindings;
    if(b&&ts.isNamespaceImport(b)&&refs.has(b.name.text))names.push('*');
    if(b&&ts.isNamedImports(b))for(const e of b.elements)if(!e.isTypeOnly&&refs.has(e.name.text))names.push((e.propertyName??e.name).text);
    if(names.length)out.push({spec,names});
  }
  return out;
}
const bad=new Map(); const memo=new Map();
function reachesDb(file, stack){
  const rel=path.relative(root,file).replace(/\.(tsx?)$/,'');
  if(rel==='lib/db')return [rel];
  if(stubbed.has(rel))return null;
  if(memo.has(file))return memo.get(file);
  memo.set(file,null);
  const src=readFileSync(file,'utf8');
  for(const imp of usedImports(file,src)){
    const r=resolve(file,imp.spec); if(!r)continue;
    const rrel=path.relative(root,r).replace(/\.(tsx?)$/,'');
    if(pure[rrel] && imp.names && imp.names.every(n=>pure[rrel].includes(n)))continue;
    const chain=reachesDb(r,stack);
    if(chain){const res=[rel+` {${(imp.names||['side-effect']).join(',')}}`,...chain];memo.set(file,res);return res;}
  }
  return null;
}
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
for(const file of walk(path.join(root,'app')).filter(f=>/\/(page|layout|template|error|loading|not-found)\.tsx$/.test(f) && !f.includes('/app/api/'))){
  const rel=path.relative(root,file);
  const src=pages.has(rel)?pages.get(rel).replaceAll('from "@/lib/permissions"','from "@/lib/roles"').replaceAll('from "@/lib/storage"','from "@/lib/frontend/storage"'):readFileSync(file,'utf8');
  for(const imp of usedImports(file,src)){
    const r=resolve(file,imp.spec); if(!r)continue;
    const rrel=path.relative(root,r).replace(/\.(tsx?)$/,'');
    if(pure[rrel] && imp.names && imp.names.every(n=>pure[rrel].includes(n)))continue;
    const chain=reachesDb(r,[]);
    if(chain){bad.set(rel,[`{${(imp.names||['side-effect']).join(',')}}`,...chain].join(' -> '));break;}
  }
}
for(const [k,v] of bad)console.log(k+'\n    '+v);
if(bad.size){console.error(`${bad.size} frontend page(s) reach lib/db. Load data in the page before its JSX return, or list pure helpers in frontend/pure-exports.json.`);process.exit(1);}
console.log('Frontend boundary: no page reaches lib/db.');
