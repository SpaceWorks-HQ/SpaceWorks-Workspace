"use client";
import { useState } from "react";
import { OpsForm } from "@/components/requests/OpsForm";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import type { FormField } from "@/lib/forms/schema";
import type { ActionResult } from "@/lib/actionResult";
export function Intake({fields,action,formId}:{fields:FormField[];action:(data:FormData)=>Promise<ActionResult<string>>;formId?:string}) {
 const [answers,setAnswers]=useState<Record<string,unknown>>(() => Object.fromEntries(fields.filter(f=>f.type==="checkbox").map(f=>[f.key,false]))); const [sent,setSent]=useState(false);
 const change=(key:string,value:unknown)=>setAnswers(v=>({...v,[key]:value}));
 if(sent)return <p role="status" className="text-body">Response received. Thank you.</p>;
 return <OpsForm action={async data=>{const r=await action(data);if(r.ok)setSent(true);return r;}} hidden={{...(formId?{formId}:{}),answers:JSON.stringify(answers)}} label="Send response"><div className="hidden" aria-hidden="true"><label>Leave this blank<input tabIndex={-1} name="website" autoComplete="off" /></label></div>{fields.map(f=>f.type==="checkbox"?<CheckboxField key={f.key} label={f.label} checked={answers[f.key]===true} onCheckedChange={v=>change(f.key,v===true)} required={f.required} />:<Field key={f.key} label={f.label} required={f.required} optional={!f.required}>{f.type==="textarea"?<Textarea maxLength={5000} onChange={e=>change(f.key,e.target.value)} />:f.type==="select"?<Dropdown defaultValue="" onChange={e=>change(f.key,e.target.value)}><option value="">Choose…</option>{f.options?.map(o=><option key={o} value={o}>{o}</option>)}</Dropdown>:<Input type={f.type} maxLength={500} onChange={e=>change(f.key,f.type==="number"?(e.target.value===""?undefined:Number(e.target.value)):e.target.value)} />}</Field>)}</OpsForm>;
}
