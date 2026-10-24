import Link from "next/link";

const RESULT=/\[\[genithm_rice_gwas_run:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/i;
const FILES=[
  ["rice-gwas-results.zip","Download all GWAS files (.zip)"],
  ["association.tsv","All tested SNP associations (.tsv)"],
  ["manhattan.svg","Manhattan plot (.svg)"],
  ["qq.svg","Q–Q plot (.svg)"],
  ["provenance.json","Published sources + source checksums (.json)"],
  ["summary.json","Top-marker and QC summary (.json)"],
  ["README.md","Methods and interpretation report (.md)"],
] as const;

/** Only renders a fixed server-authored marker. Access is rechecked by the GET route. */
export function PublicRiceGwasArtifacts({content}:{content:string}){
  const run=RESULT.exec(content)?.[1];
  if(!run)return null;
  return <section aria-label="Research files: published rice GWAS" style={{display:"grid",gap:10,marginTop:14,padding:15,border:"1px solid #9dcad6",borderRadius:12,background:"#f1fbff"}}>
    <strong style={{fontSize:14}}>Real rice GWAS — result files</strong>
    <p style={{margin:0,fontSize:12}}>Computed from the published Rice Diversity Panel. Your downloadable files are private to your signed-in account and expire after 48 hours. ZIP includes every table, plot, method and source checksum.</p>
    <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>{FILES.map(([file,title])=><a key={file} href={`/api/ai/public-rice-gwas?run=${encodeURIComponent(run)}&file=${encodeURIComponent(file)}`}
      download={`genithm-rice-${file}`} style={{fontSize:12,color:"#175e83",padding:"7px 9px",border:"1px solid #9ac3d6",borderRadius:8,background:"white",textDecoration:"none"}}>{title} ↓</a>)}</div>
    <small>Not a permanent research archive; download files to your device. No private genomics files were used.</small>
    <Link href="/dashboard/gwas" style={{fontSize:12}}>Run a different GWAS using your own study data →</Link>
  </section>;
}
