import { describe, expect, it } from "vitest";
import { sealEnvelope, openEnvelope } from "@/lib/crypto";
import { costTotals, annualCost } from "@/lib/subscriptions/costs";
import { overlaps } from "@/lib/assets/rules";
import { fieldsSchema, answerSchema, csvCell } from "@/lib/forms/schema";
import { worstStatus, cloudStatus } from "@/lib/catalogue/status";
describe("ops domain rules",()=>{
 it("round trips independent envelopes and detects tampering",()=>{
  const key=Buffer.alloc(32,7);const a=sealEnvelope(key,"test-secret");const b=sealEnvelope(key,"test-secret");expect(a).not.toEqual(b);expect(openEnvelope(key,a)).toBe("test-secret");
  expect(()=>openEnvelope(Buffer.alloc(32,8),a)).toThrow();expect(()=>openEnvelope(key,{...a,secretEnc:a.secretEnc.slice(0,-3)+"abc"})).toThrow();
 });
 it("keeps costs separate by currency and excludes cancelled and usage",()=>{
  expect(annualCost(100,"QUARTERLY")).toBe(400);
  expect(costTotals([{amountMinor:1200,currency:"INR",period:"MONTHLY",status:"ACTIVE"},{amountMinor:1200,currency:"USD",period:"YEARLY",status:"ACTIVE"},{amountMinor:100,currency:"INR",period:"USAGE",status:"ACTIVE"},{amountMinor:999,currency:"INR",period:"MONTHLY",status:"CANCELLED"}])).toEqual({INR:{yearlyMinor:14400,monthlyMinor:1200},USD:{yearlyMinor:1200,monthlyMinor:100}});
 });
 it("allows touching bookings but rejects real intersections",()=>{
  const d=(n:number)=>new Date(n);expect(overlaps(d(0),d(10),d(10),d(20))).toBe(false);expect(overlaps(d(0),d(10),d(9),d(20))).toBe(true);expect(overlaps(d(0),d(20),d(3),d(4))).toBe(true);
 });
 it("validates field definitions, required answers and choices",()=>{
  const fields=fieldsSchema.parse([{key:"email",label:"Email",type:"email",required:true},{key:"choice",label:"Choice",type:"select",options:["One","Two"],required:true}]);
  expect(answerSchema(fields).safeParse({email:"a@example.test",choice:"One"}).success).toBe(true);expect(answerSchema(fields).safeParse({email:"bad",choice:"Three"}).success).toBe(false);expect(answerSchema(fields).safeParse({email:"a@example.test",choice:"One",unexpected:"x"}).success).toBe(false);
  expect(fieldsSchema.safeParse([{key:"x",label:"X",type:"text"},{key:"x",label:"X",type:"text"}]).success).toBe(false);
 });
 it("defuses spreadsheet formulas and quotes commas",()=>{expect(csvCell("=1+1")).toBe('"\'=1+1"');expect(csvCell('a,"b"')).toBe('"a,""b"""');});
 it("derives the worst linked check",()=>{expect(worstStatus(["UP","DOWN","DEGRADED"])).toBe("DOWN");expect(worstStatus([])).toBe("UNKNOWN");expect(cloudStatus("UNHEALTHY")).toBe("DOWN");});
});

describe("ops input boundaries", () => {
 it("rejects reserved object keys and required checkbox omissions", () => {
  expect(fieldsSchema.safeParse([{key:"constructor",label:"Unsafe key",type:"text"}]).success).toBe(false);
  const fields = fieldsSchema.parse([{key:"agree",label:"Agree",type:"checkbox",required:true},{key:"date",label:"Date",type:"date"}]);
  expect(answerSchema(fields).safeParse({agree:false}).success).toBe(false);
  expect(answerSchema(fields).safeParse({agree:true,date:"2026-02-30"}).success).toBe(false);
  expect(answerSchema(fields).safeParse({agree:true,date:""}).success).toBe(true);
 });
 it("does not report hidden costs as zero or count one-time costs as recurring", () => {
  expect(costTotals([{amountMinor:null,currency:"INR",period:"YEARLY",status:"ACTIVE"},{amountMinor:5000,currency:"USD",period:"ONE_TIME",status:"ACTIVE"}])).toEqual({});
 });
});
