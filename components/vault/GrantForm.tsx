"use client";
import { useState } from "react";
import { OpsForm, type Option } from "@/components/requests/OpsForm";
import { Field, Dropdown } from "@/components/ui/field";
import { saveVaultGrant } from "@/app/actions/vault";
export function GrantForm({slug,itemId,collectionId,members,teams}:{slug:string;itemId?:string;collectionId?:string;members:Option[];teams:Option[]}) {
 const [type,setType]=useState("USER");
 return <OpsForm action={saveVaultGrant.bind(null,slug)} hidden={{...(itemId?{itemId}:{}),...(collectionId?{collectionId}:{}),principalType:type}} label="Grant temporary access" fields={[{name:"principalId",label:"Who gets access",required:true,options:type==="USER"?members:type==="TEAM"?teams:[{value:"MEMBER",label:"Members and above"},{value:"ADMIN",label:"Admins and owners"},{value:"OWNER",label:"Owners"}],value:type==="ROLE"?"MEMBER":undefined},{name:"permission",label:"Permission",value:"LIST",required:true,options:[{value:"LIST",label:"List metadata"},{value:"REVEAL",label:"Reveal and copy"},{value:"EDIT",label:"Edit and rotate"},{value:"MANAGE",label:"Manage item and grants"}]},{name:"durationHours",label:"Expires after hours",type:"number",value:"24",required:true}]}><Field label="Grant applies to"><Dropdown value={type} onChange={e=>setType(e.target.value)}><option value="USER">Person</option><option value="TEAM">Team</option><option value="ROLE">Role</option></Dropdown></Field></OpsForm>;
}
