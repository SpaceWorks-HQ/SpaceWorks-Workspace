import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { exportEstimate, exportProductOps } from "@/lib/productOps/exports";
import { SECTIONS, id, type Section } from "@/lib/productOps/schema";
import { ProductError } from "@/lib/productOps/access";
export async function GET(request:Request,{params}:RouteContext<"/api/w/[workspaceSlug]/product-ops/export">){
 const {workspaceSlug}=await params;const actor=await getWorkspaceForAction(workspaceSlug,"MEMBER");
 if(!actor)return new Response("Not found",{status:404});
 if(await isActionRateLimited("action",actor.user.id))return new Response("Try again shortly.",{status:429});
 const paramsQuery=new URL(request.url).searchParams; const filters=Object.fromEntries(paramsQuery);
 try{
  let body:string;
  if(paramsQuery.has("estimate"))body=await exportEstimate(actor,id.min(1).parse(paramsQuery.get("estimate")),paramsQuery.has("version")?z.coerce.number().int().min(1).parse(paramsQuery.get("version")):undefined);
  else{const section=(paramsQuery.get("section")??"roadmap") as Section;if(!SECTIONS.includes(section))return new Response("Not found",{status:404});body=await exportProductOps(actor,section,filters);}
  return new Response(body,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=product-budget.csv","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){return new Response(error instanceof ProductError||error instanceof z.ZodError?"Not found":"Couldn't export. Try again.",{status:error instanceof ProductError||error instanceof z.ZodError?404:500,headers:{"Cache-Control":"no-store"}});}
}
