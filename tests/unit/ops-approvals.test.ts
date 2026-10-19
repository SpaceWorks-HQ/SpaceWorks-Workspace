import { describe, expect, it } from "vitest";
import { applicableSteps, decisionBlocker, requiredApprovals, transition, approvalStepsSchema } from "@/lib/approvals/machine";
const step={approverType:"ROLE" as const,ref:"ADMIN",minApprovals:2};
describe("approval state machine",()=>{
 it("requires distinct eligible people and blocks self approval",()=>{
  expect(decisionBlocker({status:"PENDING",actorId:"a",requesterId:"a",eligible:new Set(["a"]),alreadyDecided:false})).toContain("own request");
  expect(decisionBlocker({status:"APPROVED",actorId:"b",requesterId:"a",eligible:new Set(["b"]),alreadyDecided:false})).toContain("already");
  expect(decisionBlocker({status:"PENDING",actorId:"b",requesterId:"a",eligible:new Set(),alreadyDecided:false})).toContain("not an approver");
  expect(requiredApprovals(step,3)).toBe(2);expect(requiredApprovals(step,1)).toBe(2);
 });
 it("advances only after quorum and finishes the last step",()=>{
  expect(transition({currentStep:0,stepCount:2,decision:"APPROVED",approvalsAtStep:1,required:2}).advanced).toBe(false);
  expect(transition({currentStep:0,stepCount:2,decision:"APPROVED",approvalsAtStep:2,required:2})).toMatchObject({advanced:true,currentStep:1,status:"PENDING"});
  expect(transition({currentStep:1,stepCount:2,decision:"APPROVED",approvalsAtStep:2,required:2})).toMatchObject({final:true,status:"APPROVED"});
 });
 it("rejects or requests changes immediately",()=>{ for(const decision of ["REJECTED","CHANGES_REQUESTED"] as const) expect(transition({currentStep:0,stepCount:2,decision,approvalsAtStep:0,required:2}).status).toBe(decision); });
 it("filters amount thresholds and validates role steps",()=>{
  expect(applicableSteps([{...step,minAmountMinor:100}],99)).toEqual([]);expect(applicableSteps([{...step,minAmountMinor:100}],100)).toHaveLength(1);
  expect(approvalStepsSchema.safeParse([{...step,ref:"GUEST"}]).success).toBe(false);
 });
});
