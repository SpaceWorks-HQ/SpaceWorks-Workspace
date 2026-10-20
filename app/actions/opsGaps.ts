"use server";
import { action, instant, values } from "@/lib/opsGaps/action";
import { createTicket, triageTicket, commentTicket } from "@/lib/opsGaps/helpdesk";
import { createSafety, updateSafety, addSafetyAction, completeSafetyAction } from "@/lib/opsGaps/safety";
import { submitHours, reviewHours, withdrawHours } from "@/lib/opsGaps/volunteering";
export async function newHelpTicket(slug: string, form: FormData) { return action(slug, "helpdesk", false, async a => { const r = await createTicket(a, values(form)); return `/w/${a.workspace.slug}/helpdesk/${r.id}`; }); }
export async function saveHelpTicket(slug: string, form: FormData) { return action(slug, "helpdesk", true, async a => { await triageTicket(a, { ...values(form), dueAt: form.get("dueAt") ? instant(form,"dueAt",a) : undefined }); }); }
export async function replyHelpTicket(slug: string, form: FormData) { return action(slug, "helpdesk", false, async a => { await commentTicket(a, { ...values(form), internal: form.get("internal") === "on" }); }); }
export async function newSafetyReport(slug: string, form: FormData) { return action(slug, "safety", false, async a => { const r = await createSafety(a, { ...values(form), occurredAt: instant(form, "occurredAt", a) }); return `/w/${a.workspace.slug}/safety/${r.id}`; }); }
export async function saveSafetyReport(slug: string, form: FormData) { return action(slug, "safety", true, async a => { await updateSafety(a, values(form)); }); }
export async function newSafetyFollowUp(slug: string, form: FormData) { return action(slug, "safety", true, async a => { await addSafetyAction(a, { ...values(form), dueAt: instant(form, "dueAt", a, true) }); }); }
export async function finishSafetyFollowUp(slug: string, form: FormData) { return action(slug, "safety", true, async a => { await completeSafetyAction(a, values(form)); }); }
export async function newVolunteerHours(slug: string, form: FormData) { return action(slug, "volunteering", false, async a => { const r = await submitHours(a, { ...values(form), startsAt: instant(form, "startsAt", a), endsAt: instant(form, "endsAt", a) }); return `/w/${a.workspace.slug}/volunteering/${r.id}`; }); }
export async function decideVolunteerHours(slug: string, form: FormData) { return action(slug, "volunteering", true, async a => { await reviewHours(a, values(form)); }); }
export async function cancelVolunteerHours(slug: string, form: FormData) { return action(slug, "volunteering", false, async a => { await withdrawHours(a, values(form)); }); }

import { createOpening, updateOpening, createCandidate, updateCandidate, addInterview, convertCandidate } from "@/lib/opsGaps/hiring";
import { saveLeaveType, saveBalance, saveEngagement, cancelLeave } from "@/lib/opsGaps/leave";
import { requestTimeOff, decideTimeOff } from "@/lib/people/timeOff";
import { saveLease, saveFacilityContact } from "@/lib/opsGaps/facilities";
import { createInspectionTemplate, startInspection, recordFinding, addInspectionAction, finishInspection } from "@/lib/opsGaps/inspections";
import { attachFiles } from "@/lib/opsGaps/attachments";
import { OperationsError } from "@/lib/opsGaps/context";
export async function newHiringOpening(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{await createOpening(a,values(form));});}
export async function saveHiringOpening(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{await updateOpening(a,values(form));});}
export async function newHiringCandidate(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{const r=await createCandidate(a,values(form));return `/w/${a.workspace.slug}/hiring/${r.id}`;});}
export async function saveHiringCandidate(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{await updateCandidate(a,values(form));});}
export async function newHiringInterview(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{await addInterview(a,values(form));});}
export async function startCandidateOnboarding(slug:string,form:FormData){return action(slug,"hiring",true,async a=>{await convertCandidate(a,values(form));return `/w/${a.workspace.slug}/onboarding`;});}
export async function newLeaveType(slug:string,form:FormData){return action(slug,"leave",true,async a=>{await saveLeaveType(a,values(form));});}
export async function saveYearlyBalance(slug:string,form:FormData){return action(slug,"leave",true,async a=>{await saveBalance(a,values(form));});}
export async function saveMemberEngagement(slug:string,form:FormData){return action(slug,"leave",true,async a=>{await saveEngagement(a,values(form));});}
export async function submitLeave(slug:string,form:FormData){return action(slug,"leave",false,async a=>{if(!form.get("leaveTypeId"))throw new OperationsError("Choose a leave type. Ask an admin to add one if none are available.");const r=await requestTimeOff(a,values(form));if(!r.ok)throw new OperationsError(r.error);});}
export async function reviewLeave(slug:string,form:FormData){return action(slug,"leave",true,async a=>{const r=await decideTimeOff(a,{...values(form),approved:form.get("approved")==="true"});if(!r.ok)throw new OperationsError(r.error);});}
export async function withdrawLeave(slug:string,form:FormData){return action(slug,"leave",false,async a=>{await cancelLeave(a,values(form));});}
export async function saveFacilityLease(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await saveLease(a,values(form));});}
export async function newFacilityContact(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await saveFacilityContact(a,values(form));});}
export async function newInspectionTemplate(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await createInspectionTemplate(a,{...values(form),steps:String(form.get("steps")??"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});});}
export async function newInspection(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await startInspection(a,values(form));});}
export async function saveInspectionFinding(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await recordFinding(a,values(form));});}
export async function newInspectionAction(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await addInspectionAction(a,values(form));});}
export async function closeInspection(slug:string,form:FormData){return action(slug,"safety",true,async a=>{await finishInspection(a,values(form));});}
export async function uploadPeopleServiceFiles(slug:string,form:FormData){return action(slug,"",false,async a=>{
 const files=form.getAll("files").filter((v):v is File=>v instanceof File&&v.size>0);
 if(files.reduce((n,f)=>n+f.size,0)>25*1024*1024)throw new OperationsError("Choose files totalling 25 MB or less.");
 await attachFiles(a,{kind:form.get("kind"),recordId:form.get("recordId"),files});
});}
