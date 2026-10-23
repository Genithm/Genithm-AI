import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {GenithmIcon} from "@/components/genithm-icon";
export const dynamic="force-dynamic";
const tools=[
  {title:"Sequence analysis",icon:"data",description:"Upload FASTA, run alignments and BLAST, or explore protein properties.",kind:"Worker-backed tools",href:"/dashboard/tools"},
  {title:"FASTQ quality control",icon:"results",description:"Inspect read quality, GC content, and paired-end consistency locally.",kind:"Runs in your browser",href:"/dashboard/fastq-qc"},
  {title:"Variant quality control",icon:"results",description:"Inspect VCF record counts, quality scores, and variant distributions.",kind:"Runs in your browser",href:"/dashboard/variant-qc"},
  {title:"GWAS association analysis",icon:"data",description:"Run quantitative or binary genotype–phenotype association on matched VCF/dosage and phenotype inputs, with plots and corrected P-values.",kind:"Real bounded analysis in your browser",href:"/dashboard/gwas"},
  {title:"Automated pipelines",icon:"pipelines",description:"Run supported reference-sequence workflows with explicit approval.",kind:"Worker-backed workflows",href:"/dashboard/pipelines"},
  {title:"Compare results",icon:"projects",description:"Compare compatible completed analyses and save research studies.",kind:"Uses your recorded results",href:"/dashboard/results"},
  {title:"Research notebook",icon:"notebook",description:"Keep observations, interpretations, and notes alongside your projects.",kind:"Private project notes",href:"/dashboard/notebook"},
];
export default async function ToolsCatalogue(){
  const db=await createClient();const {data:auth,error}=await db.auth.getClaims();if(error||!auth?.claims?.sub)redirect("/login");
  return <main className="genithm-page"><header className="genithm-page-heading"><div><div className="genithm-page-kicker">AVAILABLE IN GENITHM</div><h1>Choose an analysis</h1><p>Start with the data you have. Keep advanced settings out of the way until you need them.</p></div><Link className="button" href="/dashboard/ai">Ask Genithm for help</Link></header><div className="genithm-card-grid">{tools.map(tool=><article className="genithm-card" key={tool.title}><span className="genithm-card-icon"><GenithmIcon name={tool.icon}/></span><h2>{tool.title}</h2><p>{tool.description}</p><span className="genithm-state">{tool.kind}</span><Link className="genithm-card-link" href={tool.href}>Open tool <GenithmIcon name="arrow" size={16}/></Link></article>)}</div><details className="genithm-disclosure"><summary>Advanced workflows and evidence</summary><div className="genithm-page-links"><Link href="/dashboard/workflows">Scientific workflows</Link><Link href="/dashboard/pipeline-studies">Pipeline studies</Link><Link href="/dashboard/results/studies">Saved comparisons</Link><Link href="/dashboard/reports">Scientific reports</Link><Link href="/dashboard/dossiers">Evidence dossiers</Link><Link href="/dashboard/operations">Execution status</Link></div></details><p className="genithm-note">Only existing tools are listed. Variant QC is not variant calling. RNA-seq differential expression and structure prediction are not represented as completed features. Scientific jobs still require supported data, running services, and your approval.</p></main>;
}
