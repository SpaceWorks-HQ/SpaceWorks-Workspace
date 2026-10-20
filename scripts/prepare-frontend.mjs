// Build a rendering-only workspace from the shared UI and fixed API contracts.
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "frontend");
const catalog = JSON.parse(readFileSync(path.join(target, "catalog.json"), "utf8"));
for (const directory of ["app", "components", "lib", "public"]) {
  const destination = path.join(target, directory);
  rmSync(destination, { recursive: true, force: true });
  cpSync(path.join(root, directory), destination, { recursive: true,
    filter: (file) => directory !== "app" || !path.relative(path.join(root, "app"), file).startsWith(`api${path.sep}`) && file !== path.join(root, "app", "api"),
  });
}
mkdirSync(path.join(target, "app/api/[...path]"), { recursive: true });
cpSync(path.join(target, "api-route.ts"), path.join(target, "app/api/[...path]/route.ts"));
cpSync(path.join(root, "postcss.config.mjs"), path.join(target, "postcss.config.mjs"));
// Backend handlers and the registry are never part of the frontend project.
for (const file of ["frontend/handler.ts", "frontend/registry.ts"]) rmSync(path.join(target, "lib", file), { force: true });

// Replace page data prefixes with their fixed, guarded backend contracts.
for (const page of JSON.parse(readFileSync(path.join(target, "pages.json"), "utf8"))) {
  writeFileSync(path.join(target, page.file), page.source);
}
for (const [module, endpoints] of Map.groupBy([...catalog.actions, ...catalog.readers.filter(entry => entry.module === "lib/views/components")], entry => entry.module)) {
  const output = path.join(target, `${module}.ts`);
  const kind = module.startsWith('app/actions') ? 'action' : 'view';
  const contract = kind === 'action' ? 'Actions' : 'Views';
  const imported = kind === 'action' ? 'Actions' : 'Views';
  const contractPath = path.relative(path.dirname(output), path.join(target, 'contracts')).split(path.sep).join('/');
  writeFileSync(output, (kind === 'action' ? '"use server";\n' : 'import "server-only";\n') + `import type { ${imported} } from ${JSON.stringify(contractPath)};\nimport { invokeBackend } from "@/lib/frontend/client";\n` + endpoints.map(item => kind === 'action' ? `export async function ${item.name}(...args: Actions[${JSON.stringify(item.id)}]["args"]): Promise<Actions[${JSON.stringify(item.id)}]["result"]> { return invokeBackend("action", ${JSON.stringify(item.id)}, args); }` : `export async function ${item.name}(input: {params: Record<string,string>}): Promise<${contract}[${JSON.stringify(item.id)}]> { return invokeBackend("view", ${JSON.stringify(item.id)}, [input]); }`).join("\n"));
}
// A backend module can never silently acquire a database connection here.
writeFileSync(path.join(target, "lib/db.ts"), `import type { PrismaClient } from "@prisma/client";\nthrow new Error("Database access cannot run in the frontend workspace. Move it into a guarded view reader.");\nexport type DbClient = PrismaClient | import("@prisma/client").Prisma.TransactionClient;\nexport type Tx = import("@prisma/client").Prisma.TransactionClient;\nexport const prisma = {} as PrismaClient;\n`);
// Render helpers that share a backend module get a minimal, explicit facade.
// Only named pure exports and their local dependencies are copied. The build
// trace check remains a separate defence against introducing persistence here.
const pureExports = JSON.parse(readFileSync(path.join(target, 'pure-exports.json'), 'utf8'));
for (const [module, names] of Object.entries(pureExports)) {
  const source = readFileSync(path.join(root, module+'.ts'), 'utf8');
  const syntax = ts.createSourceFile(module+'.ts', source, 99, true);
  const definitions = new Map();
  for (const statement of syntax.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) definitions.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) definitions.set(declaration.name.text, statement);
  }
  const needed = new Set(names), selected = new Set();
  for (const name of needed) {
    const declaration = definitions.get(name);
    if (!declaration) continue;
    selected.add(declaration);
    const visit = node => { if(ts.isIdentifier(node)) needed.add(node.text); ts.forEachChild(node,visit); };
    visit(declaration);
  }
  for (const name of names) if (!definitions.has(name)) throw new Error(`Missing pure rendering export: ${module}:${name}`);
  const imports = [];
  for (const statement of syntax.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    if (!clause) continue;
    const parts = [];
    if (clause.name && needed.has(clause.name.text)) parts.push(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const elements=bindings.elements.filter(item=>needed.has(item.name.text));
      if(elements.length) parts.push(`{ ${elements.map(item=>item.getText(syntax)).join(', ')} }`);
    }
    if(bindings && ts.isNamespaceImport(bindings) && needed.has(bindings.name.text))parts.push(bindings.getText(syntax));
    if (!parts.length) continue;
    let imported = statement.moduleSpecifier.text;
    if (imported.startsWith('.')) imported = '@/'+path.posix.normalize(path.posix.join(path.posix.dirname(module),imported));
    imports.push(`import ${clause.isTypeOnly?'type ':''}${parts.join(', ')} from ${JSON.stringify(imported)};`);
  }
  const directory=path.join(target,'lib/frontend/pure'); mkdirSync(directory,{recursive:true});
  writeFileSync(path.join(directory,module.replaceAll('/','-')+'.ts'), imports.join('\n')+'\n'+syntax.statements.filter(node=>selected.has(node)).map(node=>node.getText(syntax)).join('\n')+'\n');
}

cpSync(path.join(target,'storage.ts'),path.join(target,'lib/frontend/storage.ts'));
const enums = Prisma.dmmf.datamodel.enums.map((item) => `export const ${item.name} = ${JSON.stringify(Object.fromEntries(item.values.map((value) => [value.name, value.name])))} as const;\nexport type ${item.name} = (typeof ${item.name})[keyof typeof ${item.name}];`).join("\n");
writeFileSync(path.join(target, "lib/prismaEnums.ts"), enums + '\nexport const Prisma = new Proxy({}, { get() { throw new Error("Backend-only Prisma API reached the frontend."); } });\n');
console.log("Frontend workspace prepared; database, auth persistence, storage and workers remain on the backend.");

// Next.js automatically externalizes Prisma before resolving aliases. Rewrite
// only enum value imports; model/namespace imports remain erased TypeScript.
const enumNames = new Set(Prisma.dmmf.datamodel.enums.map((item) => item.name));
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
for (const file of ["app", "components", "lib"].flatMap((directory) => walk(path.join(target, directory)))) {
  let source = readFileSync(file, "utf8");
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const node of syntax.statements) {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== "@prisma/client" || node.importClause?.isTypeOnly) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const values = bindings.elements.filter((item) => !item.isTypeOnly && enumNames.has((item.propertyName ?? item.name).text));
    if (!values.length) continue;
    const remaining = bindings.elements.filter((item) => !values.includes(item));
    const replacement = `import { ${values.map((item) => item.getText(syntax)).join(", ")} } from "@/lib/prismaEnums";` + (remaining.length ? `\nimport { ${remaining.map((item) => item.getText(syntax)).join(", ")} } from "@prisma/client";` : "");
    edits.push({ start: node.getStart(syntax), end: node.end, replacement });
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  if (edits.length) writeFileSync(file, source);
}

// Generated source trees are Git-ignored. Explicit Tailwind sources keep their
// utility classes in the frontend CSS instead of relying on auto discovery.
const cssPath = path.join(target, "app/globals.css");
writeFileSync(cssPath, readFileSync(cssPath, "utf8").replace('@import "tailwindcss";', '@import "tailwindcss";\n@source "../app";\n@source "../components";\n@source "../lib";'));

// Remove imports that the extracted renderer no longer uses, without loading
// the backend TypeScript program into the frontend build process.
for (const page of JSON.parse(readFileSync(path.join(target, "pages.json"), "utf8"))) {
  const file = path.join(target, page.file); let source = readFileSync(file, "utf8").replaceAll('from "@/lib/permissions"', 'from "@/lib/roles"').replaceAll('from "@/lib/storage"', 'from "@/lib/frontend/storage"');
  for (const modulePath of Object.keys(pureExports)) source = source.replaceAll(`from "@/${modulePath}"`, `from "@/lib/frontend/pure/${modulePath.replaceAll('/','-')}"`);
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Helpers used only by extracted loaders must not retain backend imports.
  const helpers = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
  const removedHelpers = helpers.filter(fn => {
    const names = new Set();
    const scan = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, scan); };
    syntax.statements.filter(node => node !== fn && !ts.isImportDeclaration(node)).forEach(scan);
    return fn.name && !names.has(fn.name.text);
  });
  const used = new Set();
  const visit = node => { if (ts.isIdentifier(node)) used.add(node.text); ts.forEachChild(node, visit); };
  syntax.statements.filter(node => !ts.isImportDeclaration(node) && !removedHelpers.includes(node)).forEach(visit);
  const edits = removedHelpers.map(node => ({ start: node.getStart(syntax), end: node.end, text: "" }));
  for (const node of syntax.statements.filter(ts.isImportDeclaration)) {
    const clause = node.importClause;
    if (!clause) continue;
    const parts = [];
    if (clause.name && used.has(clause.name.text)) parts.push(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const names = bindings.elements.filter(item => used.has(item.name.text)).map(item => item.getText(syntax));
      if (names.length) parts.push(`{ ${names.join(", ")} }`);
    }
    if (bindings && ts.isNamespaceImport(bindings) && used.has(bindings.name.text)) parts.push(bindings.getText(syntax));
    edits.push({ start: node.getStart(syntax), end: node.end, text: parts.length ? `import ${clause.isTypeOnly ? "type " : ""}${parts.join(", ")} from ${node.moduleSpecifier.getText(syntax)};` : "" });
  }
  let output = source;
  for (const edit of edits.sort((a,b) => b.start-a.start)) output = output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  writeFileSync(file, output);
}

for (const file of walk(path.join(root, "app")).filter(file => file.endsWith("/route.ts") && !file.startsWith(path.join(root, "app/api") + path.sep))) {
  const relative = path.relative(root, file);
  writeFileSync(path.join(target, relative), `import { proxyBackendResource } from "@/lib/frontend/httpProxy";\nexport const dynamic = "force-dynamic";\nexport const GET = proxyBackendResource;\nexport const HEAD = proxyBackendResource;\nexport const POST = proxyBackendResource;\nexport const PUT = proxyBackendResource;\nexport const PATCH = proxyBackendResource;\nexport const DELETE = proxyBackendResource;\nexport const OPTIONS = proxyBackendResource;\n`);
}

const modelTypes = new Map(JSON.parse(readFileSync(path.join(target,'model-types.json'),'utf8')).map(entry=>[entry.module+':'+entry.name,entry.id]));
for(const file of [...['app','components'].flatMap(directory=>walk(path.join(target,directory))), ...walk(path.join(target,'lib/frontend/pure'))]) {
  const source=readFileSync(file,'utf8'),syntax=ts.createSourceFile(file,source,99,true,ts.ScriptKind.TSX),edits=[];
  for(const node of syntax.statements.filter(ts.isImportDeclaration)) {
    const clause=node.importClause,modulePath=node.moduleSpecifier.text;
    if(!clause||!(modulePath.startsWith('@/lib/') || modulePath.startsWith('@/app/actions/')))continue;
    const bindings=clause.namedBindings;
    if(!bindings||!ts.isNamedImports(bindings))continue;
    const lifted=bindings.elements.filter(element=>(clause.isTypeOnly||element.isTypeOnly)&&modelTypes.has(modulePath.slice(2)+':'+(element.propertyName??element.name).text));
    if(!lifted.length)continue;
    const remaining=bindings.elements.filter(element=>!lifted.includes(element));
    const replacements=lifted.map(element=>`${modelTypes.get(modulePath.slice(2)+':'+(element.propertyName??element.name).text)} as ${element.name.text}`);
    let replacement=`import type { ${replacements.join(', ')} } from "@/model-types";`;
    if(remaining.length)replacement+=`\nimport ${clause.isTypeOnly?'type ':''}{ ${remaining.map(element=>element.getText(syntax)).join(', ')} } from ${JSON.stringify(modulePath)};`;
    edits.push({start:node.getStart(syntax),end:node.end,text:replacement});
  }
  let output=source;
  for(const edit of edits.reverse())output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  if(edits.length)writeFileSync(file,output);
}

for (const file of walk(path.join(target,'lib/frontend/pure'))) {
 let text=readFileSync(file,'utf8');
 for(const modulePath of Object.keys(pureExports)) text=text.replaceAll(`from "@/${modulePath}"`, `from "@/lib/frontend/pure/${modulePath.replaceAll('/','-')}"`);
 writeFileSync(file,text);
}
