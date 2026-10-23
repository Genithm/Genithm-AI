import Link from "next/link";
import { ResearchActivityRefresh } from "@/components/research-activity-refresh";
import { activityTitle,classifyActivity,statusLabel } from "@/lib/scientific-activity";
import { GenithmIcon } from "./genithm-icon";

export type RecentScientificRun={id:string;job_type:string;status:string;created_at:string;result_sha256:string|null};
type Props={projectCount:number;scienceReady:boolean;recentRuns:RecentScientificRun[];recentRunsError:boolean};
export function GenithmToolDock({projectCount,scienceReady,recentRuns,recentRunsError}:Props){
  const active=recentRuns.some(run=>classifyActivity("scientific",run.status)==="active");
  return <aside className="genithm-tool-dock" aria-label="Bioinformatics tools and workspace status">
    <ResearchActivityRefresh active={active}/>
    <div className="genithm-dock-heading"><h2>Quick actions</h2><p>Choose your next step.</p></div>
    <div className="genithm-dock-actions">
      <Link className="genithm-dock-action" href="/dashboard/data"><span><GenithmIcon name="upload"/></span><span><strong>Upload data</strong><small>FASTA files and local QC</small></span><GenithmIcon name="arrow" size={16}/></Link>
      <Link className="genithm-dock-action" href="/dashboard/apps"><span><GenithmIcon name="run"/></span><span><strong>Run an analysis</strong><small>Choose an available tool</small></span><GenithmIcon name="arrow" size={16}/></Link>
      <Link className="genithm-dock-action" href="/dashboard/results"><span><GenithmIcon name="results"/></span><span><strong>View results</strong><small>Explore your recorded analyses</small></span><GenithmIcon name="arrow" size={16}/></Link>
    </div>
    <details className="genithm-dock-details"><summary>Recent scientific runs</summary><div>
      {recentRunsError?<p role="alert">Recent runs could not be loaded.</p>:recentRuns.length?recentRuns.slice(0,3).map(run=><Link className="genithm-recent-item" href={`/dashboard/scientific-jobs/${run.id}`} key={run.id}><strong>{activityTitle("scientific",run.job_type)}</strong><small>{statusLabel(run.status)}</small></Link>):<p>No scientific runs recorded yet.</p>}
      <Link href="/dashboard/results">View all results →</Link><Link href="/dashboard/results/studies">Saved comparisons</Link>
    </div></details>
    <details className="genithm-dock-details"><summary>Workspace status</summary><div><p>{scienceReady?"Scientific workers available. Execution still requires your approval.":"Worker-backed execution is unavailable. Chat and local QC may still be used."}</p><p>{projectCount} accessible research projects.</p><Link href="/dashboard/operations">Execution status</Link><Link href="/dashboard/pipelines">Pipelines</Link><Link href="/dashboard/workflows">Advanced workflows</Link><Link href="/dashboard/ai/research">Research history</Link><Link href="/dashboard/notebook">Scientific notebook</Link><Link href="/dashboard/tools">Advanced scientific tools</Link><Link href="/dashboard/variant-qc">Variant QC Lab</Link><Link href="/dashboard/gwas">GWAS Lab</Link><Link href="/dashboard/fastq-qc">FASTQ QC Lab</Link></div></details>
  </aside>;
}
