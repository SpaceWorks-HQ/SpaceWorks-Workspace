// Materialise structural DTO types so the rendering compiler never follows
// backend persistence imports or recursively infers thin action wrappers.
import ts from 'typescript';
import { isPrivateViewField } from '../lib/frontend/fields.ts';
import { frontendSourceHash } from './frontend-source-hash.mjs';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const catalog=JSON.parse(readFileSync(path.join(root,'frontend/catalog.json'),'utf8'));
const cfg=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const config=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root);
const routeTypes = path.join(root, '.next/types/routes.d.ts');
if (!existsSync(routeTypes)) throw new Error('Run next typegen before materialising frontend contracts.');
const sourceFiles = [...new Set([...catalog.readers, ...catalog.actions].map(entry => path.join(root, entry.module+'.ts')))];
const program=ts.createProgram([...sourceFiles, routeTypes],config.options),checker=program.getTypeChecker();
let filterSecretFields = true;
function typeText(type,depth=0,seen=new Set()) {
 const jsonName = type.aliasSymbol?.name ?? type.symbol?.name;
 if (['JsonValue','InputJsonValue','JsonObject','InputJsonObject','JsonArray','InputJsonArray'].includes(jsonName)) {
   if(jsonName.endsWith('Object'))return '{ [key: string]: JsonValue }';
   if(jsonName.endsWith('Array'))return 'JsonValue[]';
   return 'JsonValue';
 }
 if(depth>30)return 'unknown';
 const flags=type.flags;
 if(flags&ts.TypeFlags.Any)return 'any';
 if(flags&ts.TypeFlags.Unknown)return 'unknown';
 if(flags&ts.TypeFlags.Never)return 'never';
 if(flags&ts.TypeFlags.StringLiteral)return JSON.stringify(type.value);
 if(flags&ts.TypeFlags.NumberLiteral)return String(type.value);
 if(flags&ts.TypeFlags.BooleanLiteral)return type.intrinsicName;
 if(flags&ts.TypeFlags.String)return 'string';
 if(flags&ts.TypeFlags.Number)return 'number';
 if(flags&ts.TypeFlags.Boolean)return 'boolean';
 if(flags&ts.TypeFlags.BigInt)return 'bigint';
 if(flags&ts.TypeFlags.Null)return 'null';
 if(flags&ts.TypeFlags.Undefined)return 'undefined';
 if(flags&ts.TypeFlags.Void)return 'void';
 if(type.isUnion())return type.types.map(t=>typeText(t,depth+1,new Set(seen))).join(' | ');
 const symbol=type.getSymbol(),name=symbol?.getName();
 if(['Date','FormData','File','Blob','URL','Uint8Array'].includes(name))return name;
 if(name?.endsWith('Error'))return '{ readonly name: string; readonly message: string }';
 if(['Promise','ReadonlyArray','ReadonlyMap','ReadonlySet'].includes(name))return `${name}<${checker.getTypeArguments(type).map(t=>typeText(t,depth+1,new Set(seen))).join(', ')}>`;
 if(checker.isArrayType(type))return `Array<${typeText(checker.getTypeArguments(type)[0],depth+1,new Set(seen))}>`;
 if(checker.isTupleType(type))return `[${checker.getTypeArguments(type).map(t=>typeText(t,depth+1,new Set(seen))).join(', ')}]`;
 if(name==='Map'||name==='Set'){const args=checker.getTypeArguments(type);return `${name}<${args.map(t=>typeText(t,depth+1,new Set(seen))).join(', ')}>`;}
 if(seen.has(type))return 'unknown';seen.add(type);
 const calls=checker.getSignaturesOfType(type,ts.SignatureKind.Call);
 if(calls.length)return calls.map(sig=>'('+sig.parameters.map((param,index)=>`arg${index}${param.valueDeclaration?.questionToken?'?':''}: ${typeText(checker.getTypeOfSymbolAtLocation(param,param.valueDeclaration??param.declarations?.[0]),depth+1,new Set(seen))}`).join(', ')+') => '+typeText(sig.getReturnType(),depth+1,new Set(seen))).map(text=>'('+text+')').join(' & ');
 const props=checker.getPropertiesOfType(type).filter(p=>!filterSecretFields || !isPrivateViewField(p.getName()));
 const indices=checker.getIndexInfosOfType(type).map(i=>`[key: ${i.keyType.flags&ts.TypeFlags.Number?'number':'string'}]: ${typeText(i.type,depth+1,new Set(seen))}`);
 if(props.length>500)throw new Error('Contract is unexpectedly large.');
 return '{ '+[...props.map(p=>`${JSON.stringify(p.getName())}${p.flags&ts.SymbolFlags.Optional?'?':''}: ${typeText(checker.getTypeOfPropertyOfType(type,p.getName()),depth+1,new Set(seen))}`),...indices].join('; ')+' }';
}
function signature(entry){const sf=program.getSourceFile(path.join(root,entry.module+'.ts'));if(!sf)throw new Error('Missing module '+entry.module);const symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(sf)).find(s=>s.name===entry.name);const type=checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration);return checker.getSignaturesOfType(type,ts.SignatureKind.Call)[0];}
const views=catalog.readers.map(entry=>{if(process.env.SWW_TYPEGEN_VERBOSE)console.log('View',entry.id);const sig=signature(entry);return `${JSON.stringify(entry.id)}: ${typeText(checker.getAwaitedType(sig.getReturnType()))};`;});
filterSecretFields = false;
const actions=catalog.actions.map(entry=>{if(process.env.SWW_TYPEGEN_VERBOSE)console.log('Action',entry.id);const sig=signature(entry);const params=sig.parameters.map((p,i)=>{const decl=p.valueDeclaration;return `arg${i}${decl?.questionToken||decl?.initializer?'?':''}: ${typeText(checker.getTypeOfSymbolAtLocation(p,decl))}`;});return `${JSON.stringify(entry.id)}: { args: [${params.join(', ')}]; result: ${typeText(checker.getAwaitedType(sig.getReturnType()))} };`;});
writeFileSync(path.join(root,'frontend/contracts.d.ts'),'// Generated transport DTOs. No backend imports.\n// Source SHA256: ' + frontendSourceHash() + '\nexport type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };\nexport type Views = {\n'+views.join('\n')+'\n};\nexport type Actions = {\n'+actions.join('\n')+'\n};\n');
console.log(`Materialised ${views.length+actions.length} transport types.`);
// Shared UI types are materialised too: importing a type from a backend service
// must not make the rendering compiler check that service's persistence graph.
const walk = directory => readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const shared = new Map();
for(const file of [...walk(path.join(root,'components')), ...walk(path.join(root,'app'))].filter(file=>file.endsWith('.tsx'))) {
 const syntax=ts.createSourceFile(file,readFileSync(file,'utf8'),99,true,4);
 for(const node of syntax.statements.filter(ts.isImportDeclaration)) {
  const clause=node.importClause, modulePath=node.moduleSpecifier.text;
  if(!clause || !(modulePath.startsWith('@/lib/') || modulePath.startsWith('@/app/actions/')))continue;
  const sourceFile=program.getSourceFile(path.join(root,modulePath.slice(2)+'.ts'));
  if(!sourceFile || !(modulePath.startsWith('@/app/actions/') || readFileSync(sourceFile.fileName,'utf8').includes('import "server-only"')))continue;
  const bindings=clause.namedBindings;
  if(!bindings || !ts.isNamedImports(bindings))continue;
  for(const element of bindings.elements.filter(element=>clause.isTypeOnly || element.isTypeOnly)) {
   const name=(element.propertyName??element.name).text,key=modulePath.slice(2)+':'+name;
   if(shared.has(key))continue;
   const symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(sourceFile)).find(symbol=>symbol.name===name);
   if(!symbol || symbol.declarations?.some(declaration=>declaration.typeParameters?.length))continue;
   const type=symbol.flags&(ts.SymbolFlags.TypeAlias|ts.SymbolFlags.Interface) ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration??symbol.declarations[0]);
   shared.set(key,{module:modulePath.slice(2),name,id:'Shared'+shared.size,value:Boolean(symbol.flags & ts.SymbolFlags.Value),source:typeText(type)});
  }
 }
}
writeFileSync(path.join(root,'frontend/model-types.d.ts'),'// Generated shared UI types. No backend imports.\nimport type { JsonValue } from "./contracts";\n'+[...shared.values()].map(entry=>entry.value ? `export declare const ${entry.id}: ${entry.source};` : `export type ${entry.id} = ${entry.source};`).join('\n')+'\n');
writeFileSync(path.join(root,'frontend/model-types.json'),JSON.stringify([...shared.values()].map(({module,name,id,value})=>({module,name,id,value})),null,2)+'\n');
console.log(`Materialised ${shared.size} shared UI types.`);
