import { createHash,randomBytes } from "node:crypto";
import { encryptWithKey,decryptWithKey,vaultRootKeys } from "../../lib/crypto.ts";
/** Fictional application settings; never working credentials. */
export default async function seedSecrets(prisma,{workspaceId,users}) {
 if(process.env.NODE_ENV==="production")throw new Error("Demo seeds are for local development only.");
 if(!process.env.VAULT_MASTER_KEY&&!process.env.VAULT_MASTER_KEYS)return;
 const owner=users.owner??Object.values(users)[0],member=users.meera??owner;
 const id=key=>"sec_"+createHash("sha256").update(workspaceId+":"+key).digest("hex").slice(0,24);
 const put=(model,key,data)=>model.upsert({where:{id:id(key)},create:{id:id(key),...data},update:{}});
 const project=await put(prisma.secretProject,"website",{workspaceId,name:"Website",slug:"website",createdById:owner.id});
 const keyBinding=row=>JSON.stringify(["sww-key-v2",workspaceId,row.scope,row.version]);
 const roots=vaultRootKeys();
 let workspaceKey=await prisma.vaultKey.findFirst({where:{workspaceId,scope:"workspace",active:true},orderBy:{version:"desc"}});
 if(!workspaceKey){const material=randomBytes(32);workspaceKey=await prisma.vaultKey.create({data:{workspaceId,scope:"workspace",version:1,rootVersion:roots[0].version,fingerprint:createHash("sha256").update(material.toString("base64")).digest("hex").slice(0,24),wrappedKey:encryptWithKey(roots[0].key,material.toString("base64"),keyBinding({scope:"workspace",version:1}))}});}
 const workspaceMaterial=Buffer.from(decryptWithKey(roots.find(root=>root.version===workspaceKey.rootVersion).key,workspaceKey.wrappedKey,keyBinding(workspaceKey)),"base64");
 let projectKey=await prisma.vaultKey.findFirst({where:{workspaceId,projectId:project.id,active:true},orderBy:{version:"desc"}});
 if(!projectKey){const material=randomBytes(32);projectKey=await prisma.vaultKey.create({data:{workspaceId,projectId:project.id,scope:"project:"+project.id,version:1,parentId:workspaceKey.id,fingerprint:createHash("sha256").update(material.toString("base64")).digest("hex").slice(0,24),wrappedKey:encryptWithKey(workspaceMaterial,material.toString("base64"),keyBinding({scope:"project:"+project.id,version:1}))}});}
 const projectMaterial=Buffer.from(decryptWithKey(workspaceMaterial,projectKey.wrappedKey,keyBinding(projectKey)),"base64");
 const seal=(binding,plaintext)=>({secretEnc:encryptWithKey(projectMaterial,plaintext,JSON.stringify(["sww-value-v2",workspaceId,project.id,binding])),dataKeyEnc:"h2:"+projectKey.id});
 let production;
 for(const [position,environment] of ["dev","staging","production"].entries()){
  const env=await put(prisma.secretEnvironment,environment,{workspaceId,projectId:project.id,name:environment,slug:environment,position,production:environment==="production",protected:environment==="production",revision:1});
  if(env.production)production=env;
  await put(prisma.secretFolder,environment+"-root",{workspaceId,environmentId:env.id,path:"/"});
  const values={APP_NAME:"Space Works Community Office",APP_ENV:environment,APP_CURRENCY:"INR",APP_TIMEZONE:"Asia/Kolkata",SITE_URL:`https://${environment}.example.org`,SUPPORT_EMAIL:"office@example.org",STORAGE_BUCKET:"demo-private-bucket",MAIL_FROM:"office@example.org",SIGNING_KEY:"fictional-demo-replace-before-use",API_URL:"${SITE_URL}/api"};
  const rows=[];
  for(const [key,value] of Object.entries(values)){
   const row=await put(prisma.applicationSecret,environment+key,{workspaceId,environmentId:env.id,path:"/",key,...seal(JSON.stringify([env.id,"/",key]),JSON.stringify(value)),ownerId:owner.id,comment:"Fictional demo setting. Replace before use.",tags:["website"],rotateEveryDays:key==="SIGNING_KEY"?90:null});rows.push(row);
   await put(prisma.applicationSecretVersion,environment+key+"-version",{workspaceId,secretId:row.id,secretEnc:row.secretEnc,dataKeyEnc:row.dataKeyEnc,metadata:{comment:row.comment,tags:row.tags,ownerId:row.ownerId,rotateEveryDays:row.rotateEveryDays},createdById:owner.id});
  }
  await put(prisma.secretSnapshot,environment+"-snapshot",{workspaceId,environmentId:env.id,revision:1,label:"Demo starting point",createdById:owner.id,...seal(JSON.stringify([env.id,"snapshot",id(environment+"-snapshot")]),JSON.stringify(rows))});
 }
 await put(prisma.secretGrant,"member-grant",{workspaceId,projectId:project.id,environmentId:"",userId:member.id,role:"WRITE"});
 const identity=await put(prisma.secretIdentity,"website-identity",{workspaceId,projectId:project.id,name:"Website deployment",clientId:"swwi_"+id("identity"),createdById:owner.id});
 await put(prisma.secretIdentityPermission,"website-identity-dev",{workspaceId,identityId:identity.id,environmentId:id("dev"),path:"/",role:"READ"});
 // Client-secret plaintext is discarded; issue one from the identity screen.
 await put(prisma.secretIdentityCredential,"website-client-secret",{workspaceId,identityId:identity.id,secretHash:createHash("sha256").update(randomBytes(32)).digest("hex"),expiresAt:new Date(Date.now()+30*86400000)});
 // Token plaintext is discarded; create a new token in the UI to use the demo.
 const token=randomBytes(32).toString("base64url");
 await put(prisma.secretServiceToken,"service-token",{workspaceId,environmentId:id("dev"),name:"Website deployment (demo)",prefix:"swws_"+id("prefix"),secretHash:createHash("sha256").update(token).digest("hex"),path:"/",expiresAt:new Date(Date.now()+30*86400000),createdById:owner.id});
 const changes=[{key:"SIGNING_KEY",path:"/",value:"fictional-demo-next-key"}];
 const change=await put(prisma.secretChange,"production-change",{workspaceId,environmentId:production.id,revision:1,createdById:owner.id,diff:[{key:"SIGNING_KEY",path:"/",operation:"set"}],...seal(JSON.stringify([production.id,"change",id("production-change")]),JSON.stringify(changes))});
 await put(prisma.approvalRequest,"production-approval",{workspaceId,subjectType:"SECRET_CHANGE",subjectId:change.id,title:"Protected environment change",requesterId:owner.id,steps:[{approverType:"ROLE",ref:"ADMIN",minApprovals:1}]});
}
