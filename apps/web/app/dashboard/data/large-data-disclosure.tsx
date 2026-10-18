"use client";
import {useState} from "react";
import {LargeDataPanel} from "./large-data-panel";

/** Do not create auth/network work for a collapsed opt-in tool. Closing pauses local work. */
export function LargeDataDisclosure({projects}:{projects:{id:string;name:string}[]}){
 const [open,setOpen]=useState(false);
 return <details className="genithm-disclosure" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Large files: resumable private upload</summary>
  {open?<LargeDataPanel projects={projects}/>:null}
 </details>;
}
