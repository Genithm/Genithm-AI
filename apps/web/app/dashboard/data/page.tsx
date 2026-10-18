import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {SequenceUploadPanel} from "../sequence-upload-panel";
import {LargeDataDisclosure} from "./large-data-disclosure";
export const dynamic="force-dynamic";
export default async function DataPage(){
  const db=await createClient();const {data:auth,error:authError}=await db.auth.getClaims();const owner=auth?.claims?.sub;
  if(authError||!owner)redirect("/login");
  const {data:projects,error:projectError}=await db.from("projects").select("id,name,organization_id").eq("status","active").order("name",{ascending:true}).limit(100);
  const ids=(projects??[]).map(p=>p.id);
  const {data:uploads,error:uploadError}=!projectError&&ids.length?await db.from("sequence_uploads").select("id,project_id,original_filename,file_size_bytes,status,created_at").eq("created_by",owner).in("project_id",ids).order("created_at",{ascending:false}).limit(100):{data:[],error:null};
  const names=new Map((projects??[]).map(p=>[p.id,p.name]));
  return <main className="genithm-page"><header className="genithm-page-heading"><div><div className="genithm-page-kicker">RESEARCH FILES</div><h1>Data</h1><p>Upload research files of any format, including folders and large datasets. FASTA workflow inputs and local FASTQ/VCF inspection remain separate tools.</p></div></header>
    <div className="genithm-page-links"><Link href="/dashboard/fastq-qc">Analyze local FASTQ</Link><Link href="/dashboard/variant-qc">Analyze local VCF</Link><Link href="/dashboard/projects">Manage projects</Link></div>
    {projectError||uploadError?<p role="alert" className="error">Your file list could not be loaded securely. Refresh before uploading.</p>:<>
      {projects?.length?<details className="genithm-disclosure"><summary>Upload a FASTA file</summary><SequenceUploadPanel projects={projects} userId={owner}/></details>:<p className="genithm-note">Create a project before uploading FASTA. Local FASTQ and VCF inspection remain available.</p>}
      {uploads?.length?<div className="genithm-table-scroll"><table className="genithm-table"><caption className="genithm-sr-only">Your recent FASTA uploads</caption><thead><tr><th scope="col">File</th><th scope="col">Project</th><th scope="col">Size</th><th scope="col">Status</th></tr></thead><tbody>{uploads.map(file=><tr key={file.id}><td>{file.original_filename}</td><td>{names.get(file.project_id)||"Research project"}</td><td>{(file.file_size_bytes/1024/1024).toFixed(2)} MiB</td><td><span className="genithm-state">{file.status.replaceAll("_"," ")}</span></td></tr>)}</tbody></table></div>:<div className="genithm-empty">No uploaded FASTA files in your active projects yet.</div>}
      <p className="genithm-note">Showing up to 100 of your recent uploads. FASTA upload and validation need the API, storage, and scientific services. The FASTQ and VCF labs process files in your browser; they do not upload the original files.</p>
      {projects?.length?<LargeDataDisclosure projects={projects}/>:null}
    </>}
  </main>;
}
