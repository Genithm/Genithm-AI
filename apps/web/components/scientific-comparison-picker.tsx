"use client";
import Link from "next/link";
import {useState} from "react";
import styles from "@/app/dashboard/results/results.module.css";
import type {ComparableJobType} from "@/lib/verified-scientific-comparison";
export type ComparableChoice={id:string;jobType:ComparableJobType;projectName:string;createdAt:string};
const typeLabel:Record<ComparableJobType,string>={protein_properties:"Protein properties",pairwise_alignment:"Pairwise alignment"};
export function ScientificComparisonPicker({choices}:{choices:ComparableChoice[]}){
  const [selected,setSelected]=useState<string[]>([]);const [candidate,setCandidate]=useState("");
  const picked=selected.map(id=>choices.find(c=>c.id===id)).filter((c):c is ComparableChoice=>Boolean(c));
  const allowedType=picked[0]?.jobType??null;
  const available=choices.filter(c=>!selected.includes(c.id)&&(allowedType===null||c.jobType===allowedType));
  const next=available.some(c=>c.id===candidate)?candidate:(available[0]?.id??"");
  function addSelected(){if(!next||selected.length>=4)return;setSelected(current=>[...current,next]);setCandidate("");}
  return <details className={styles.comparePicker} aria-label="Select completed scientific analyses to compare"><summary>Compare completed analyses</summary>
    <div className={styles.compareHeading}><div><h2>Compare research runs</h2><p>Choose 2–4 compatible completed analyses. Every source artifact is checked before its measurements appear.</p></div><span className={styles.compareCount}>{picked.length} / 4 selected</span></div>
    {choices.length<2?<p className={styles.compareEmpty}>Complete at least two protein analyses or pairwise alignments to compare results.</p>:<div className={styles.compareControls}><label htmlFor="compare-select">Completed analysis<select id="compare-select" value={next} onChange={e=>setCandidate(e.target.value)} disabled={!available.length||selected.length>=4}>{available.length?available.map(c=><option value={c.id} key={c.id}>{typeLabel[c.jobType]} · {c.projectName} · {c.id.slice(0,8)}</option>):<option value="">No more compatible results</option>}</select></label><button type="button" onClick={addSelected} disabled={!next||selected.length>=4}>Add run</button>{selected.length >= 2?<Link className={styles.compareLaunch} href={"/dashboard/results/compare?ids="+encodeURIComponent(selected.join(","))}>Compare {selected.length} runs →</Link>:<span className={styles.compareHint}>Choose two runs of the same type</span>}</div>}
    {picked.length?<div className={styles.compareChips} aria-live="polite">{picked.map((c,i)=><span className={styles.compareChip} key={c.id}>Run {i+1}: {c.id.slice(0,8)}<button type="button" aria-label={"Remove run "+(i+1)} onClick={()=>setSelected(old=>old.filter(id=>id!==c.id))}>×</button></span>)}<button className={styles.compareClear} type="button" onClick={()=>{setSelected([]);setCandidate("");}}>Clear all</button></div>:null}
  </details>;
}
