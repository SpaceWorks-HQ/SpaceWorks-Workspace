/* eslint-disable @next/next/no-img-element -- Private and local upload previews use authorised or blob URLs. */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadPeopleServiceFiles } from "@/app/actions/opsGaps";
import { OpsForm } from "./Form";
import { Panel } from "./Shared";
import type { AttachmentKind } from "@/lib/opsGaps/attachments";
type FileItem={id:string;filename:string;contentType:string;size:number};
export function Attachments({slug,kind,recordId,files}:{slug:string;kind:AttachmentKind;recordId:string;files:Array<{file:FileItem}>}){
 const input=useRef<HTMLInputElement>(null);const [chosen,setChosen]=useState<File[]>([]);const previews=useMemo(()=>chosen.map(f=>URL.createObjectURL(f)),[chosen]);
 useEffect(()=>()=>previews.forEach(u=>URL.revokeObjectURL(u)),[previews]);
 return <Panel title={kind==="candidate"?"CV and supporting files":"Files and evidence"}>
 <ul className="mb-5 space-y-3">{files.map(({file})=><li key={file.id}><a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center break-all text-accent-text underline">{file.filename} · Preview</a><a href={`/api/files/${file.id}?download=1`} className="ml-4 inline-flex min-h-11 items-center text-accent-text underline">Download</a>{file.contentType.startsWith("image/")?<img src={`/api/files/${file.id}`} alt={file.filename} className="max-h-48 max-w-full rounded-control object-contain"/>:null}</li>)}</ul>
 <OpsForm action={uploadPeopleServiceFiles.bind(null,slug)} hidden={{kind,recordId}} submit="Upload files">
 <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(input.current){input.current.files=e.dataTransfer.files;setChosen([...e.dataTransfer.files]);}}} className="rounded-control border border-dashed border-line-strong p-4">
 <label className="block text-label">Choose or drop images and PDFs<input ref={input} type="file" name="files" accept="image/*,application/pdf" multiple onChange={e=>setChosen([...e.target.files??[]])} className="mt-2 block min-h-11 w-full max-w-full text-sm"/></label>
 <label className="mt-3 block text-label">Take a photo<input type="file" name="files" accept="image/*,application/pdf" capture="environment" onChange={e=>setChosen([...e.target.files??[]])} className="mt-2 block min-h-11 w-full max-w-full text-sm"/></label>
 <p className="mt-2 text-sm text-ink-muted">Up to 10 files per upload, 25 MB in total. PNG, JPEG, WebP, GIF or PDF. Files stay with this record.</p>
 <ul className="mt-3 space-y-2">{chosen.map((f,i)=><li key={`${f.name}-${i}`} className="break-all text-sm text-ink-secondary">{f.name}{previews[i]?f.type.startsWith("image/")?<img src={previews[i]} alt={`Preview of ${f.name}`} className="mt-2 max-h-40 max-w-full object-contain"/>:<a href={previews[i]} target="_blank" rel="noreferrer" className="ml-3 text-accent-text underline">Preview PDF</a>:null}</li>)}</ul>
 </div></OpsForm></Panel>;
}
