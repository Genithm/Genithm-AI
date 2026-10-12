"use client";

import Link from "next/link";
import { useMemo,useState } from "react";
import styles from "./studies.module.css";

type Project={id:string;name:string};
type Run={id:string;projectId:string;accession:string;finishedAt:string|null;jobId:string|null};

export function StudySelector({projects,runs}:{projects:Project[];runs:Run[]}){
  const [project,setProject]=useState(projects[0]?.id??"");
  const [selected,setSelected]=useState<string[]>([]);
  const [search,setSearch]=useState("");
  const available=useMemo(()=>runs.filter(r=>r.projectId===project&&
    (r.accession.toLowerCase().includes(search.toLowerCase().trim())||
     r.id.toLowerCase().includes(search.toLowerCase().trim()))),
    [project,runs,search]);
  const selectedSet=new Set(selected);
  const query=()=>{
    const p=new URLSearchParams({project_id:project});
    [...selected].sort().forEach(id=>p.append("run_id",id));
    return p.toString();
  };
  function toggle(id:string,checked:boolean){
    setSelected(prev=>checked?
      prev.includes(id)||prev.length>=8?prev:[...prev,id]:
      prev.filter(x=>x!==id));
  }
  const ready=selected.length>=2&&selected.length<=8;
  return <div className={styles.layout}>
    <section className={styles.panel}>
      <div className={styles.heading}><div className={styles.kicker}>01 / Choose research project</div>
        <span className={styles.counter}>{selected.length}/8 selected</span></div>
      <h2>Completed autonomous experiments</h2>
      <div className={styles.filters}>
        <label>Project
          <select value={project} onChange={e=>{setProject(e.target.value);setSelected([]);setSearch("");}}>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            {!projects.length?<option value="">No authorized projects</option>:null}
          </select>
        </label>
        <label>Find accession or pipeline ID
          <input type="search" value={search} maxLength={120}
            onChange={e=>setSearch(e.target.value)} placeholder="NP_000537.3"/>
        </label>
      </div>
      <p className={styles.note}>Select 2–8 different completed runs from one project.
        Report integrity and every input dependency are checked again when the study opens.</p>
      <div className={styles.runList}>
        {available.map(r=><label key={r.id} className={styles.run}>
          <input type="checkbox" checked={selectedSet.has(r.id)}
            disabled={!selectedSet.has(r.id)&&selected.length>=8}
            onChange={e=>toggle(r.id,e.target.checked)}/>
          <span className={styles.runText}>
            <strong>{r.accession}</strong>
            <small>Pipeline {r.id}</small>
            <small>Finished {r.finishedAt?new Date(r.finishedAt).toLocaleString():"Not recorded"}</small>
          </span>
          <span className={styles.status}>Completed</span>
        </label>)}
        {!available.length?<div className={styles.empty}>
          No completed autonomous protein pipelines match this project. Start a pipeline and generate its sealed report first.
        </div>:null}
      </div>
    </section>
    <aside className={styles.panel}>
      <div className={styles.kicker}>02 / Verify & assemble</div>
      <h2>Reproducible study</h2>
      <p className={styles.note}>Every selected pipeline must have one valid source retrieval,
        a one-record protein FASTA with matching SHA-256, an exact scientific_job_inputs dependency,
        a completed protein-properties job and a reverified sealed report.</p>
      <div className={styles.selection}>
        {selected.map((id,i)=>{
          const run=runs.find(r=>r.id===id);
          return <div className={styles.chosen} key={id}>
            <span>{String(i+1).padStart(2,"0")}</span>
            <strong>{run?.accession??"Selected run"}</strong>
            <button type="button" aria-label={"Remove pipeline "+id} onClick={()=>toggle(id,false)}>×</button>
          </div>;
        })}
      </div>
      {ready?<div className={styles.actions}>
        <Link className="button primary" href={"/dashboard/pipeline-studies/review?"+query()}>Compare verified results</Link>
        <a className="button" href={"/dashboard/pipeline-studies/export/json?"+query()}>Download study JSON</a>
        <a className="button" href={"/dashboard/pipeline-studies/export/markdown?"+query()}>Download study Markdown</a>
      </div>:<p className={styles.note}>Choose at least two pipelines to activate verification and exports.</p>}
      <div className={styles.notice}>No further computational jobs are launched by a study.
        A study captures existing source and report evidence at the time of export.</div>
    </aside>
  </div>;
}
