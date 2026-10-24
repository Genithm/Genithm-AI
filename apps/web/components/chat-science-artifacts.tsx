/** V58: persisted chat attachments, not text-only fake results. */
const MARKER=/\[\[genithm_science_run:(gwas|expression|pathways|public-airway|fastq-qc|vcf-qc|fasta-qc|fastq-trim|orf-scan):([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?::(paired|single))?\]\]/i;
const FILES=[
  ['complete-results.zip','Complete reproducible results (.zip)'],
  ['association.tsv','Variant association statistics (.tsv)'],
  ['manhattan.svg','Manhattan plot'],['qq.svg','Q–Q plot'],
  ['expression.tsv','All gene expression statistics (.tsv)'],
  ['significant_genes.txt','Significant gene IDs'],['measured_genes.txt','Measured gene universe'],
  ['sample_qc.tsv','Sample QC and PCA coordinates'],['volcano.svg','Volcano plot'],
  ['sample-pca.svg','Sample PCA plot'],
  ['pathway-enrichment.tsv','Gene-set enrichment results'],['enrichment.svg','Pathway enrichment plot'],
  ['fastq-qc.tsv','FASTQ read and per-cycle QC'],['quality-by-cycle.svg','Read quality by cycle'],['read-lengths.svg','Read-length chart'],
  ['vcf-qc.tsv','VCF variant QC'],['variant-types.svg','Variant type chart'],
  ['fasta-stats.tsv','FASTA per-sequence statistics'],['sequence-lengths.svg','Sequence length chart'],
  ['trimmed_R1.fastq.gz','Cleaned R1 reads (.fastq.gz)'],['trimmed_R2.fastq.gz','Cleaned R2 mate reads (.fastq.gz)'],
  ['trimming-summary.tsv','Read preprocessing report'],['post-trim-qc.tsv','After-trimming quality statistics'],
  ['read-retention.svg','Read retention plot'],
  ['orfs.tsv','Candidate ORF coordinates (.tsv)'],['orfs.gff3','Genome feature positions (.gff3)'],
  ['proteins.faa','Translated candidate proteins (.faa)'],['orf-lengths.svg','ORF length chart'],
  ['summary.json','Computed summary (.json)'],['provenance.json','Input hashes and methods (.json)'],['METHODS.md','Methods report'],
] as const;
export function ChatScienceArtifacts({content}:{content:string}){
 const match=MARKER.exec(content);if(!match)return null;
 const kind=match[1]==='public-airway'?'expression':match[1],run=match[2],mateMode=match[3]||null;
 // No server-provided file list in the chat text; links for other engines
 // are never offered; the signed-in server rechecks ownership and hashes.
 const names=FILES.filter(([name])=>name==='complete-results.zip'||name==='summary.json'||name==='provenance.json'||name==='METHODS.md'||
  (kind==='gwas'&&['association.tsv','manhattan.svg','qq.svg'].includes(name))||
  (kind==='expression'&&['expression.tsv','significant_genes.txt','measured_genes.txt','sample_qc.tsv','volcano.svg','sample-pca.svg'].includes(name))||
  (kind==='pathways'&&['pathway-enrichment.tsv','enrichment.svg'].includes(name))||
  (kind==='fastq-qc'&&['fastq-qc.tsv','quality-by-cycle.svg','read-lengths.svg'].includes(name))||
  (kind==='vcf-qc'&&['vcf-qc.tsv','variant-types.svg'].includes(name))||
  (kind==='fasta-qc'&&['fasta-stats.tsv','sequence-lengths.svg'].includes(name))||
  (kind==='fastq-trim'&&['trimmed_R1.fastq.gz','trimmed_R2.fastq.gz','trimming-summary.tsv','post-trim-qc.tsv','read-retention.svg'].includes(name)&&
    (name!=='trimmed_R2.fastq.gz'||mateMode==='paired'))||
  (kind==='orf-scan'&&['orfs.tsv','orfs.gff3','proteins.faa','orf-lengths.svg'].includes(name)));
 return <section aria-label="Computed scientific files" style={{display:'grid',gap:10,marginTop:14,padding:16,border:'1px solid #a7cad0',borderRadius:12,background:'#f6fbfd'}}>
   <strong>Genithm scientific results — download your files</strong>
   <p style={{margin:0,fontSize:12}}>Actual computed output from verified source bytes. Result links are account-private, SHA-256 checked and expire after 48 hours.</p>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{names.map(([file,label])=><a key={file}
     href={`/api/ai/science-results?run=${encodeURIComponent(run)}&file=${encodeURIComponent(file)}`}
     download={`genithm-${file}`}
     style={{fontSize:12,padding:'7px 9px',background:'#fff',borderRadius:8,border:'1px solid #a7cad0',color:'#175e83',textDecoration:'none'}}>{label} ↓</a>)}</div>
   <small>Raw private input files are deleted after calculation. Save a copy of your reports; this is not permanent research storage.</small>
 </section>;
}
