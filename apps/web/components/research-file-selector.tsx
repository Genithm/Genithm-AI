"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";

type FileRow = {id:string;project_id:string;relative_path?:string|null;original_filename:string;expected_bytes:number;state:string;summary?:{scientific_scope?:string}};
type FilePage = {project_id:string;files:FileRow[];next:string|null};
export function ResearchFileSelector({projectId,selected,onChange,disabled}:{projectId:string;selected:string[];onChange:(ids:string[])=>void;disabled:boolean}) {
  const supabase = useMemo(()=>createClient(),[]);
  const [files,setFiles]=useState<FileRow[]>([]),[next,setNext]=useState<string|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setFiles([]);setNext(null);setError("");onChange([]);
    // A project change must never retain another project's selected file IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectId]);
  async function load(more=false){
    if (loading || disabled) return;
    const base = (process.env.NEXT_PUBLIC_GENITHM_API_URL||"").replace(/\/$/,"");
    if (!base){setError("Private file service not configured.");return;}
    setLoading(true);setError("");
    try {
      const {data,error:authError}=await supabase.auth.getSession();
      if(authError||!data.session?.access_token)throw new Error("Sign in before browsing private files.");
      const query = more && next ? `?limit=100&before=${encodeURIComponent(next)}` : "?limit=100";
      const response = await fetch(`${base}/api/v1/large-data/projects/${projectId}/files${query}`,{
        headers:{Authorization:`Bearer ${data.session.access_token}`},cache:"no-store",credentials:"omit"});
      if(!response.ok)throw new Error("Private file library is unavailable.");
      const page = await response.json() as FilePage;
      if(page.project_id!==projectId||!Array.isArray(page.files))throw new Error("File library scope mismatch.");
      setFiles(old=>more?[...old,...page.files.filter(f=>!old.some(x=>x.id===f.id))]:page.files);
      setNext(page.next);
    } catch (e){setError(e instanceof Error?e.message:"Could not load files.");}
    finally{setLoading(false);}
  }
  const ready=files.filter(f=>f.state==="ready"&&f.project_id===projectId);
  return <section aria-label="Select verified research files for this message">
    <p className="genithm-note">Optional: select up to four ready research files. Only the verified aggregate report is shared with Genithm chat. Raw file bytes, sample identifiers and sequences are not sent to the AI model. Bytes-only files do not receive biological interpretation.</p>
    <button className="button" type="button" disabled={disabled||loading} onClick={()=>void load()}>{loading?"Loading files...":"Find verified files"}</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {ready.length>0&&<div style={{maxHeight:210,overflowY:"auto"}}>{ready.map(file=><label key={file.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0"}}>
      <input type="checkbox" disabled={disabled||(!selected.includes(file.id)&&selected.length>=4)} checked={selected.includes(file.id)} onChange={event=>onChange(event.target.checked?[...selected,file.id]:selected.filter(id=>id!==file.id))}/>
      <span style={{overflowWrap:"anywhere"}}>{file.relative_path||file.original_filename} — {file.summary?.scientific_scope?.replaceAll("_"," ")||"verified"}</span>
    </label>)}</div>}
    {next&&<button className="button" type="button" disabled={disabled||loading} onClick={()=>void load(true)}>More project files</button>}
    <p className="genithm-note">{selected.length} of 4 selected. Selecting a file records its source and report checksums with this message.</p>
    <p className="genithm-note">For two to four verified VCF site-QC files, ask in chat: “Compare these VCF QC reports.” Genithm calculates a deterministic side-by-side table of site counts, PASS percentages and Ti/Tv ratios. It does not compare actual variant loci or genotypes.</p>
  </section>;
}
