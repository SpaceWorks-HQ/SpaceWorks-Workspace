import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const scripts=['install.sh','local.sh',...walk('scripts'),...walk('docker')];
let checks=0;
for(const file of scripts) {
 let command,args;
 if(file.endsWith('.sh')){command='bash';args=['-n',file];}
 else if(file.endsWith('.mjs')){command=process.execPath;args=['--check',file];}
 else continue;
 const result=spawnSync(command,args,{encoding:'utf8'});
 if(result.status!==0)throw new Error(`${file}: ${result.stderr}`);
 if(file.endsWith('.sh')){const lint=spawnSync('shellcheck',['-x',file],{encoding:'utf8'});if(lint.error?.code==='ENOENT')throw new Error('Install shellcheck before deployment verification.');if(lint.status!==0)throw new Error(`${file}: ${lint.stdout}${lint.stderr}`);}
 checks++;
}
const files=[...walk('.github/workflows'),...walk('deploy').filter(f=>/\.ya?ml$/.test(f)),...readdirSync('.').filter(f=>/\.ya?ml$/.test(f)),'.do/app.yaml','charts/spaceworks-workspace/Chart.yaml','charts/spaceworks-workspace/values.yaml'];
for(const file of files){const docs=yaml.parseAllDocuments(readFileSync(file,'utf8'),{customTags:[{tag:'!override',collection:'map',resolve:map=>map},{tag:'!override',collection:'seq',resolve:seq=>seq}]});if(docs.some(doc=>doc.errors.length))throw new Error(`Invalid YAML: ${file}`);checks++;}
console.log(`Deployment syntax verified: ${checks} scripts/manifests.`);
