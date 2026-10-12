"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function PipelineRefresh({active}:{active:boolean}){
  const router=useRouter();
  const [enabled,setEnabled]=useState(true);
  useEffect(()=>{
    if(!active||!enabled) return;
    const interval=window.setInterval(()=>{
      if(document.visibilityState==="visible") router.refresh();
    },20000);
    return ()=>window.clearInterval(interval);
  },[active,enabled,router]);
  return <label style={{display:"inline-flex",alignItems:"center",gap:9,fontSize:12}}>
    <input type="checkbox" checked={enabled} disabled={!active} onChange={event=>setEnabled(event.target.checked)}/>
    {active?"Refresh while pipeline is active (20s)":"Auto-refresh paused: finished or review required"}
  </label>;
}
