import { describe, expect, it } from "vitest";
import { estimateTotals } from "@/lib/productOps/costs";
import { csv, detailSchemas, recordSchema } from "@/lib/productOps/schema";
import { canManageProductOps, canManageProductEstimates, canPublishProductChangelog } from "@/lib/roles";
const line = { item:"Copper wire", specification:"6 sq mm", category:"ELECTRICAL" as const, quantityMilli:1250, unit:"metre", unitCostMinor:12345, supplier:"Kochi electrical", quoteUrl:"", quoteFileId:"", gstBps:1800 };
describe("product operations permissions",()=>{
 it.each(["OWNER","ADMIN","MEMBER","GUEST"] as const)("gates team tools and estimates for %s",role=>{expect(canManageProductOps({role})).toBe(role!=="GUEST");expect(canManageProductEstimates({role})).toBe(["OWNER","ADMIN"].includes(role));expect(canPublishProductChangelog({role})).toBe(["OWNER","ADMIN"].includes(role));});
});
describe("funding budget arithmetic",()=>{
 it("rounds fractional quantities and tax per line before contingency",()=>{const total=estimateTotals({lines:[line],contingencyBps:1000,revisionNote:"Initial"});expect(total.baseMinor).toBe(15431);expect(total.taxMinor).toBe(2778);expect(total.contingencyMinor).toBe(1821);expect(total.totalMinor).toBe(20030);});
 it("keeps category totals and zero-tax labour separate",()=>{const total=estimateTotals({lines:[line,{...line,item:"Installation",category:"LABOUR",quantityMilli:2000,unitCostMinor:250000,gstBps:0}],contingencyBps:0,revisionNote:"Review"});expect(total.categories).toEqual([{category:"ELECTRICAL",baseMinor:15431,taxMinor:2778},{category:"LABOUR",baseMinor:500000,taxMinor:0}]);expect(total.totalMinor).toBe(518209);});
 it("does not lose precision at high supported quantities",()=>{const total=estimateTotals({lines:[{...line,quantityMilli:100000000,unitCostMinor:100000000,gstBps:2800}],contingencyBps:1000,revisionNote:"Large budget"});expect(total.totalMinor).toBe(14080000000000);});
 it.each([{quantityMilli:-1},{unitCostMinor:0.1},{gstBps:10001},{quoteUrl:"javascript:alert(1)"}])("rejects malformed line %j",patch=>{expect(()=>estimateTotals({lines:[{...line,...patch}],contingencyBps:0,revisionNote:"Review"})).toThrow();});
 it("requires lines, a revision note and a bounded contingency",()=>{expect(detailSchemas.ESTIMATE.safeParse({lines:[],contingencyBps:1000,revisionNote:""}).success).toBe(false);expect(()=>estimateTotals({lines:[line],contingencyBps:10001,revisionNote:"Review"})).toThrow();});
});
describe("manual records and exports",()=>{
 it("requires a project or funding link for estimates",()=>{expect(recordSchema.safeParse({kind:"ESTIMATE",title:"Budget",status:"DRAFT",details:{}}).success).toBe(false);});
 it("requires a release for a QA run and a dated prototype for a test",()=>{expect(recordSchema.safeParse({kind:"QA_RUN",title:"QA",status:"OPEN",details:{}}).success).toBe(false);expect(recordSchema.safeParse({kind:"TEST",title:"Test",status:"PASS",details:{}}).success).toBe(false);});
 it("validates quarter and environment facts",()=>{expect(detailSchemas.ROADMAP.safeParse({quarter:"2026-Q5"}).success).toBe(false);expect(detailSchemas.CHANGE.safeParse({environment:"",changed:"Update",rollback:"Restore"}).success).toBe(false);});
 it("quotes CSV fields and neutralises spreadsheet formulas",()=>{const text=csv([["=SUM(1,2)",'quoted "name"',"\n@command","normal"]]);expect(text).toContain('"\'=SUM(1,2)"');expect(text).toContain('"quoted ""name"""');expect(text).toContain("'\n@command");});
});
