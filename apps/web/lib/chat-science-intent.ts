/** User delegation + current conversation context; no arbitrary model tool calls. */
export type ChatScienceIntent = 'public-airway' | null;
const rna=/\b(?:rna[\s-]*seq|transcriptom(?:e|ics)|differential(?:ly)?[\s-]*express(?:ed|ion)|gene[\s-]*expression|bulk[\s-]*rna)\b/i;
const execution=/\b(?:run|perform|execute|compute|calculate|analy[sz]e|conduct|do|start|investigate|study|research)\b/i;
const questions=/^(?:what|why|how|define|teach|explain|compare|summarize|describe)\b/i;
const organism=/\b(?:rice|wheat|maize|arabidopsis|drosophila|yeast|mouse|murine|rat|zebrafish|sars|salmon|bacteria|plant|fungus)\b/i;
const chosen=/\b(?:select|pick|choose|fetch|find|download|public|yourself|on your own|any data|available data|real data|no files?|no data|don't have|do not have)\b/i;
const userFiles=/\b(?:my\s+(?:data|files?|project|samples?|counts?|experiment)|(?:already|previously)\s+uploaded|existing\s+project\s+files?)\b/i;
const alternative=/\b(?:single[\s-]*cell|ATAC|ChIP|variant calling|alignment|fastq|assembly|genome)\b/i;
export function shouldRunPublicAirway(message:string,history:unknown=[]):boolean{
  const s=message.trim();if(!s||s.length>8000||questions.test(s)||organism.test(s)||alternative.test(s)||userFiles.test(s))return false;
  if(rna.test(s)&&execution.test(s))return true;
  if(!chosen.test(s)||!Array.isArray(history))return false;
  return history.slice(-12).some(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return false;
    const row=item as Record<string,unknown>;
    if(row.role!=='user')return false;
    const prior=String(row.content||'').slice(0,8000);
    return rna.test(prior)&&execution.test(prior)&&!organism.test(prior)&&!alternative.test(prior);
  });
}
export type ChatScienceSummary = {kind:string;method:string;inputs:string;warnings:string[];[key:string]:unknown};
export function scienceCompletionText(runId:string,summary:ChatScienceSummary):string{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId))throw new Error('Invalid scientific run ID.');
  const kind=summary.kind;
  let detail='';
  if(kind==='gwas')detail=`${summary.samples} matched samples; ${summary.variants_tested} tested variants of ${summary.variants_seen}. Bonferroni-significant variants: ${summary.significant_bonferroni} (not necessarily independent loci).`;
  else if(kind==='public-airway'||kind==='expression')detail=`${summary.samples} samples; ${summary.genes_tested} tested genes of ${summary.genes_seen}. Genes with BH FDR below 0.05: ${summary.genes_fdr_below_0_05}.`;
  else if(kind==='fastq-trim')detail=`${summary.kept_reads} of ${summary.initial_reads} reads or pairs retained (${summary.retention_percent}%); ${summary.bases_before} bases before and ${summary.bases_after} after trimming. Download the actual cleaned FASTQ files below.`;
  else if(kind==='orf-scan')detail=`${summary.orfs} candidate ORFs across ${summary.contigs} nucleotide sequences (${summary.nucleotides_analyzed} bases). ${summary.plus_strand_orfs} on + and ${summary.minus_strand_orfs} on - strands; translated protein FASTA, GFF3 and complete table are downloadable.`;
  else if(kind==='fastq-qc')detail=`${summary.reads} reads (${summary.bases} bases); Phred+33 Q30 ${summary.q30_percent}%. ${summary.mode==='paired'?'Paired read IDs verified.':'Single-file read QC.'}`;
  else if(kind==='vcf-qc')detail=`${summary.variants} VCF variants, ${summary.samples} sample columns. Transition/transversion ratio: ${summary.ti_tv??'undefined'}.`;
  else if(kind==='fasta-qc')detail=`${summary.records} sequences, ${summary.total_residues} residues, N50 ${summary.n50}, L50 ${summary.l50}. Inferred molecule type: ${summary.molecule_type}.`;
  else if(kind==='pathways')detail=`${summary.selected} selected genes out of ${summary.universe} measured genes; ${summary.pathways_tested} tested pathways. Sets with BH FDR below 0.05: ${summary.pathways_fdr_below_0_05}.`;
  else throw new Error('Unsupported recorded scientific result.');
  const source=summary.inputs==='published-airway'?'**Real public research data:** Himes et al. (2014), eight airway samples, dexamethasone vs control. The raw integer count matrix and experimental metadata were selected and fetched from a pinned public source.':
    '**Your supplied research data:** Original file bytes were analyzed in the temporary isolated scientific worker, then deleted; only the derived results remain available for 48 hours.';
  return `${source}\n\n**Analysis completed by Genithm's scientific engine.** ${detail}\n\n**Method:** ${summary.method}\n\n**Result files:** Download the full statistics table, research plots, methods and source SHA-256 provenance below this message. These files were computed from actual inputs; Gemini/Groq did not generate the statistics.\n\n**Scientific limitations:** ${(summary.warnings||[]).slice(0,3).join(' ')}\n\n[[genithm_science_run:${kind}:${runId}${kind==='fastq-trim'?':'+(summary.mode==='paired'?'paired':'single'): ''}]]`;
}
