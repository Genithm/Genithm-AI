"use client";

import {useState} from "react";
import {
  MAX_SALMON_SAMPLES, MAX_SALMON_QUANT_BYTES, MAX_SALMON_TOTAL_BYTES,
  inspectSalmonQuantifications, type SalmonInput
} from "@/lib/salmon-quant-matrix";
import {
  MAX_TX2GENE_BYTES, summarizeSalmonGenes, type SalmonGeneSummary
} from "@/lib/salmon-gene-summary-v71";
import {deriveTx2GeneFromGtf, MAX_GTF_BYTES, type GtfMapping} from "@/lib/gtf-transcript-mapping-v72";
import {inspectSalmonGeneCohort, type SalmonCohortQc} from "@/lib/salmon-gene-cohort-qc-v72";
import {inspectSalmonCohortDesign, MAX_DESIGN_CSV_BYTES, type DesignCohortQc} from "@/lib/salmon-design-cohort-v73";

type Selected = {id: number; file: File; sample: string};
type Evidence = {
  report: SalmonGeneSummary;
  source_quant_sha256: Array<{sample: string; sha256: string}>;
  reference_input_kind: "tsv" | "gtf";
  reference_source_sha256: string;
  derived_tx2gene_sha256: string;
  annotation_summary: GtfMapping | null;
  cohort: SalmonCohortQc;
  design_review: DesignCohortQc | null;
  design_csv_sha256: string | null;
};

function candidateSample(file: File, index: number): string {
  const rel = file.webkitRelativePath || file.name;
  const folder = rel.includes("/") ? rel.split("/").at(-2) : null;
  return (folder || file.name.replace(/(?:\.quant)?\.sf$/i, "") || "S" + (index + 1))
    .replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
}
function save(content: string, name: string, mime = "text/tab-separated-values") {
  const uri = URL.createObjectURL(new Blob([content], {type: mime + ";charset=utf-8"}));
  const link = document.createElement("a");
  link.href = uri; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(uri), 1000);
}
async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Optional downstream stage for existing Salmon quantifications.
 * Unlike V70 transcript output, gene grouping NEEDS an externally supplied
 * validated exact transcript-to-gene reference mapping.
 */
export function SalmonGeneWorkbench() {
  const [files, setFiles] = useState<Selected[]>([]);
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [referenceMode,setReferenceMode] = useState<"tsv"|"gtf">("tsv");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function clear() {setEvidence(null);setError("");}
  function changeFiles(list: FileList | null) {
    if(busy)return;
    clear();
    if (!list) return;
    if (list.length > MAX_SALMON_SAMPLES) {
      setFiles([]);setError("Select at most 24 Salmon quant.sf samples.");return;
    }
    setFiles(Array.from(list).map((file, id) => ({id, file, sample: candidateSample(file, id)})));
  }
  async function analyze() {
    if (!files.length || !mapFile || busy) return;
    clear();setBusy(true);
    try {
      const maxReferenceBytes=referenceMode==="gtf"?MAX_GTF_BYTES:MAX_TX2GENE_BYTES;
      if (mapFile.size < 1 || mapFile.size > maxReferenceBytes)
        throw new Error(referenceMode==="gtf"?"GTF must be nonempty and at most 32 MiB.":"Transcript-to-gene TSV must be nonempty and at most 8 MiB.");
      if (files.some(x => x.file.size < 1 || x.file.size > MAX_SALMON_QUANT_BYTES) ||
          files.reduce((s, x) => s + x.file.size, 0) > MAX_SALMON_TOTAL_BYTES)
        throw new Error("Each quant.sf is limited to 24 MiB, and all quant files together to 96 MiB.");
      const inputs: SalmonInput[] = await Promise.all(files.map(async x => ({
        sample: x.sample, text: await x.file.text()
      })));
      const quant = inspectSalmonQuantifications(inputs);
      const referenceText=await mapFile.text();
      const annotationSummary=referenceMode==="gtf"?deriveTx2GeneFromGtf(referenceText):null;
      const tx2geneText=annotationSummary?.transcript_to_gene_tsv??referenceText;
      const report = summarizeSalmonGenes(quant,tx2geneText);
      const cohort=inspectSalmonGeneCohort(report);
      let designReview: DesignCohortQc | null=null;
      let designSha256: string | null=null;
      if (designFile){
        if(designFile.size<1||designFile.size>MAX_DESIGN_CSV_BYTES)
          throw new Error("Optional RNA-seq sample,condition design CSV must be nonempty and at most 16 KiB.");
        designReview=inspectSalmonCohortDesign(cohort,await designFile.text());
        designSha256=await fileSha256(designFile);
      }
      const digestRows: Evidence["source_quant_sha256"] = [];
      for (const x of files) digestRows.push({sample: x.sample, sha256: await fileSha256(x.file)});
      const mappingSha256=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(tx2geneText));
      const derivedSha=[...new Uint8Array(mappingSha256)].map(n=>n.toString(16).padStart(2,"0")).join("");
      setEvidence({report,source_quant_sha256:digestRows,reference_input_kind:referenceMode,
        reference_source_sha256:await fileSha256(mapFile),derived_tx2gene_sha256:derivedSha,
        annotation_summary:annotationSummary,cohort,design_review:designReview,design_csv_sha256:designSha256});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salmon gene summary failed validation.");
    } finally {setBusy(false);}
  }
  function saveEvidence(value: Evidence) {
    const methods = {
      schema: value.report.schema, status: value.report.status,
      source_salmon_quant_sf_sha256: value.source_quant_sha256,
      reference_input_kind:value.reference_input_kind,
      reference_source_sha256:value.reference_source_sha256,
      derived_tx2gene_sha256:value.derived_tx2gene_sha256,
      annotation_summary:value.annotation_summary?{
        schema:value.annotation_summary.schema,status:value.annotation_summary.status,
        feature_rows:value.annotation_summary.source_feature_rows,
        transcript_ids:value.annotation_summary.transcript_ids,
        gene_ids:value.annotation_summary.gene_ids,
        contigs_seen:value.annotation_summary.contigs_seen,
        assembly_verified:false,salmon_index_verified:false}:null,
      matched_design_sha256:value.design_csv_sha256,
      optional_design_review:value.design_review,
      descriptive_cohort_qc:{schema:value.cohort.schema,status:value.cohort.status,
        metrics:value.cohort.metrics,correlations:value.cohort.correlations,
        warnings:value.cohort.warnings},
      samples: value.report.samples, genes: value.report.genes,
      transcripts: value.report.transcripts,
      mapped_transcripts: value.report.mapped_transcripts,
      unmatched_extra_map_rows: value.report.mapping_rows_not_quantified,
      multi_transcript_genes: value.report.multi_transcript_genes,
      sample_summaries: value.report.sample_summaries,
      warnings: value.report.warnings,
      source_reads_verified: false,
      transcriptome_reference_verified: false,
      tximport_equivalent: false,
      gene_level_differential_expression_performed: false
    };
    save(JSON.stringify(methods,null,2)+"\n", "genithm-salmon-gene-SUMMARY-ONLY-evidence.json", "application/json");
  }
  return <section className="genithm-card" aria-label="Salmon transcript-to-gene summary" style={{marginTop:24}}>
    <div className="genithm-page-kicker">PHASE 1 / RNA-SEQ GENE-LEVEL SUMMARIZATION</div>
    <h2>Summarize existing Salmon transcripts to genes</h2>
    <p>Provide Salmon quant.sf files and either the corresponding transcript-to-gene TSV or a GTF annotation from the same trusted transcriptome reference. Genithm checks exact transcript IDs and adds their existing reported TPM and estimated-fragment abundance per gene <strong>only in your browser</strong>.</p>
    <p className="genithm-note">This is not a DESeq2/edgeR result, tximport/tximeta equivalent or an independently verified gene annotation. It does not run Salmon or open FASTQ source reads.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,340px),1fr))",gap:16,marginTop:15}}>
      <div>
        <label htmlFor="salmon-v71-files"><strong>1. Salmon quant.sf files</strong></label>
        <input id="salmon-v71-files" type="file" disabled={busy} multiple accept=".sf,.tsv,text/plain"
          onChange={e => changeFiles(e.currentTarget.files)} />
        <p className="genithm-note">One existing quant.sf per biological sample, with unique sample IDs.</p>
        {files.map(x => <div key={x.id} style={{marginTop:8}}>
          <label htmlFor={"v71-sample-"+x.id}>{x.file.name}: sample ID</label>
          <input id={"v71-sample-"+x.id} maxLength={64} disabled={busy} value={x.sample}
            onChange={e => {setFiles(old=>old.map(v=>v.id===x.id?{...v,sample:e.target.value}:v));clear();}} />
        </div>)}
      </div>
      <div>
        <label htmlFor="salmon-v72-reference-mode"><strong>2. Reference input format</strong></label>
        <select id="salmon-v72-reference-mode" disabled={busy} value={referenceMode} onChange={e=>{
          setReferenceMode(e.target.value as "gtf"|"tsv");setMapFile(null);clear();
        }} style={{display:"block",marginBottom:8}}>
          <option value="tsv">Transcript-to-gene TSV</option>
          <option value="gtf">GTF gene annotation</option>
        </select>
        <label htmlFor="salmon-v71-map"><strong>{referenceMode==="gtf"?"GTF annotation (up to 32 MiB)":"Transcript-to-gene mapping (TSV)"}</strong></label>
        <input id="salmon-v71-map" disabled={busy} type="file" accept={referenceMode==="gtf"?".gtf,.txt":".tsv,.txt,text/tab-separated-values"}
          onChange={e => {setMapFile(e.currentTarget.files?.[0]??null);clear();}} />
        <p className="genithm-note">{referenceMode==="gtf"
          ?"GTF must contain nine-tab-column features and quoted gene_id / transcript_id attributes. Genithm derives the exact transcript-to-gene table locally. Genome release and Salmon-index compatibility are not proven."
          :"Two columns with exact transcript_id and gene_id header (tab-separated). Version suffixes must match the Salmon index exactly."}</p>
        {mapFile && <p className="genithm-note">Selected: {mapFile.name}</p>}
      </div>
    </div>
    <div style={{marginTop:15}}>
      <label htmlFor="salmon-v73-design"><strong>3. Optional study design (sample,condition CSV)</strong></label>
      <input id="salmon-v73-design" type="file" disabled={busy} accept=".csv,text/csv"
        onChange={e=>{setDesignFile(e.currentTarget.files?.[0]??null);clear();}} />
      <p className="genithm-note">Match biological sample names exactly to the imported Salmon files. Grouped Pearson correlations are descriptive, not differential-expression results. CSV remains in your browser.</p>
      <button className="button" type="button" disabled={busy||!files.length||!mapFile}
        onClick={()=>void analyze()}>{busy?"Summarizing measured values...":"Validate and summarize genes"}</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {evidence&&<div role="status" style={{marginTop:19}}>
      <h3>Imported gene-level sums; no inferential analysis was performed</h3>
      <p><strong>{evidence.report.samples}</strong> samples; <strong>{evidence.report.transcripts.toLocaleString()}</strong> transcripts matched to <strong>{evidence.report.genes.toLocaleString()}</strong> genes.</p>
      <p><strong>{evidence.report.multi_transcript_genes.toLocaleString()}</strong> genes have more than one measured transcript.</p>
      {evidence.annotation_summary&&<p><strong>GTF structural mapping:</strong> {evidence.annotation_summary.source_feature_rows.toLocaleString()} feature rows, {evidence.annotation_summary.transcript_ids.toLocaleString()} unique transcript identifiers, {evidence.annotation_summary.gene_ids.toLocaleString()} gene identifiers on {evidence.annotation_summary.contigs_seen.toLocaleString()} contigs. Reference and genome assembly are not verified.</p>}
      <table style={{width:"100%",textAlign:"left"}}>
        <thead><tr><th>Sample</th><th>Summarized gene TPM</th><th>Summarized estimated fragments</th></tr></thead>
        <tbody>{evidence.report.sample_summaries.map(s=><tr key={s.sample}>
          <td>{s.sample}</td><td>{s.summarized_gene_tpm.toLocaleString()}</td>
          <td>{s.summarized_gene_estimated_fragments.toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
      <div style={{display:"flex",gap:9,flexWrap:"wrap",marginTop:14}}>
        <button className="button" type="button" onClick={()=>save(evidence.report.gene_tpm_tsv,"genithm-gene-TPM.tsv")}>Download gene TPM</button>
        <button className="button" type="button" onClick={()=>save(evidence.report.gene_estimated_fragments_tsv,"genithm-gene-ESTIMATED-fragments.tsv")}>Download estimated gene fragments</button>
        <button className="button" type="button" onClick={()=>save(evidence.report.gene_transcript_counts_tsv,"genithm-gene-transcript-counts.tsv")}>Download gene mapping coverage</button>
        {evidence.annotation_summary&&<button className="button" type="button" onClick={()=>save(evidence.annotation_summary!.transcript_to_gene_tsv,"genithm-GTF-derived-tx2gene.tsv")}>Download derived tx2gene TSV</button>}
        <button className="button" type="button" onClick={()=>saveEvidence(evidence)}>Download hashes and provenance</button>
      </div>
      <h4>Descriptive gene-level sample QC</h4>
      <p>Real detection counts (TPM ≥ 1) and Pearson correlation of log2(gene TPM + 1), not differential-expression inference. Correlations are undefined for zero-variance samples.</p>
      <table style={{width:"100%",textAlign:"left"}}>
        <thead><tr><th>Sample</th><th>Genes with TPM ≥ 1</th><th>Nonzero genes</th></tr></thead>
        <tbody>{evidence.cohort.metrics.map(x=><tr key={x.sample}>
          <td>{x.sample}</td><td>{x.genes_tpm_ge_1.toLocaleString()}</td>
          <td>{x.nonzero_genes.toLocaleString()}</td></tr>)}</tbody>
      </table>
      <p>{evidence.cohort.correlations.length.toLocaleString()} sample pairs evaluated. The first 12 pairs are shown; download the complete table for all pairs.</p>
      <table style={{width:"100%",textAlign:"left"}}>
        <thead><tr><th>Sample A</th><th>Sample B</th><th>Pearson log2(TPM+1)</th></tr></thead>
        <tbody>{evidence.cohort.correlations.slice(0,12).map(x=><tr key={x.sample_a+"::"+x.sample_b}>
          <td>{x.sample_a}</td><td>{x.sample_b}</td>
          <td>{x.pearson_log2_tpm_plus_one===null?"NA":x.pearson_log2_tpm_plus_one.toFixed(3)}</td></tr>)}</tbody>
      </table>
      <div style={{display:"flex",gap:9,flexWrap:"wrap",marginTop:12}}>
        <button className="button" type="button" onClick={()=>save(evidence.cohort.sample_qc_tsv,"genithm-salmon-gene-sample-QC.tsv")}>Download sample detection QC</button>
        <button className="button" type="button" onClick={()=>save(evidence.cohort.correlation_tsv,"genithm-salmon-sample-correlations.tsv")}>Download sample correlations</button>
      </div>
      {evidence.design_review&&<>
        <h4>Researcher-labeled study design and descriptive cohort QC</h4>
        <p>{evidence.design_review.groups.length} groups matched to {evidence.design_review.samples} existing Salmon samples; no biological labels or source FASTQ data were independently verified.</p>
        <table style={{width:"100%",textAlign:"left"}}><thead><tr><th>Condition</th><th>Biological samples</th><th>At least three samples?</th></tr></thead>
          <tbody>{evidence.design_review.groups.map(x=><tr key={x.condition}><td>{x.condition}</td><td>{x.biological_samples}</td><td>{x.replicates_ge_3?"Yes":"No"}</td></tr>)}</tbody></table>
        <table style={{width:"100%",textAlign:"left"}}><thead><tr><th>Group A</th><th>Group B</th><th>Type</th><th>Median descriptive Pearson</th></tr></thead>
          <tbody>{evidence.design_review.group_pairs.map(x=><tr key={x.condition_a+"/"+x.condition_b}>
            <td>{x.condition_a}</td><td>{x.condition_b}</td><td>{x.kind}</td>
            <td>{x.median_pearson_log2_tpm_plus_one===null?"NA":x.median_pearson_log2_tpm_plus_one.toFixed(3)}</td>
          </tr>)}</tbody></table>
        <div style={{display:"flex",gap:9,flexWrap:"wrap",marginTop:12}}>
          <button type="button" className="button" onClick={()=>save(evidence.design_review!.group_pair_qc_tsv,"genithm-salmon-group-correlation-QC.tsv")}>Download grouped QC</button>
          <button type="button" className="button" onClick={()=>save(evidence.design_review!.matched_design_tsv,"genithm-salmon-matched-design.tsv")}>Download matched study design</button>
        </div>
      </>}
      <h4>Scientific scope</h4>
      <ul>{[...evidence.report.warnings,...evidence.cohort.warnings,
        ...(evidence.annotation_summary?.warnings??[]),...(evidence.design_review?.warnings??[])].map((w,i) => <li key={i}>{w}</li>)}</ul>
    </div>}
  </section>;
}
