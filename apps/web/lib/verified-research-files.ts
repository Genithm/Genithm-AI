/** Explicit V48 chat evidence: checks the privately authenticated API's *verified* file report.
 * The model receives a bounded aggregate only. Raw file bodies are never downloaded here. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const SCOPES = new Set(["bytes_only", "full_fastq_aggregate_qc", "full_fasta_structural_summary", "full_vcf_site_qc", "full_gff3_feature_qc"]);
const MAX_REPORT = 80_000;
type RecordValue = Record<string, unknown>;
function object(x: unknown): RecordValue {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Research file evidence is invalid.");
  return x as RecordValue;
}
function uint(x: unknown): number {
  if (!Number.isSafeInteger(x) || (x as number) < 0) throw new Error("Invalid file evidence count.");
  return x as number;
}
export type VerifiedVcfSiteQc = {
  schema: "genithm-vcf-site-qc/1";
  record_count:number; sample_count:number; contigs_seen:number;
  snv_sites:number; mnv_sites:number; indel_sites:number; complex_sites:number;
  symbolic_sites:number; reference_only_sites:number; multiallelic_sites:number;
  transitions:number; transversions:number; pass_sites:number;
  failed_filter_sites:number; unfiltered_sites:number;
  quality_available_sites:number; missing_quality_sites:number; mean_qual:number|null;
  sampling:false; genotypes_inspected:false;
};
/** Only site-level counts may reach the LLM; no sample columns, coordinates,
 * genotypes, REF/ALT values, filenames, or untrusted free text from VCF. */
function verifiedVcfSiteQc(report: RecordValue, inspection:string):VerifiedVcfSiteQc {
  const intake=object(report.intake);
  if(inspection!=="complete_vcf" || report.format!=="opaque" ||
      !["genithm-file-registry/2","genithm-file-registry/3"].includes(String(intake.registry_version)) || intake.mode!=="auto" ||
      object(intake.name_hint).format_id!=="vcf")throw new Error("VCF evidence must be fully parsed by the authorized worker.");
  const data=object(report.metrics);
  if(data.schema!=="genithm-vcf-site-qc/1"||data.engine_version!=="genithm-vcf-stream/1.0.0"||
     data.sampling!==false||data.genotypes_inspected!==false)
    throw new Error("Unsupported VCF evidence schema or processing claim.");
  const fields=["record_count","sample_count","contigs_seen","snv_sites","mnv_sites","indel_sites",
    "complex_sites","symbolic_sites","reference_only_sites","multiallelic_sites",
    "canonical_snv_alt_alleles","transitions","transversions","pass_sites",
    "failed_filter_sites","unfiltered_sites","quality_available_sites","missing_quality_sites",
    "expanded_bytes"] as const;
  const counts=Object.fromEntries(fields.map(key=>[key,uint(data[key])])) as Record<typeof fields[number],number>;
  const n=counts.record_count;
  if(counts.sample_count>100000||counts.contigs_seen>Math.min(n,100000)||
     counts.expanded_bytes<45 ||
     counts.snv_sites+counts.mnv_sites+counts.indel_sites+counts.complex_sites+
       counts.symbolic_sites+counts.reference_only_sites!==n ||
     counts.pass_sites+counts.failed_filter_sites+counts.unfiltered_sites!==n ||
     counts.quality_available_sites+counts.missing_quality_sites!==n ||
     counts.multiallelic_sites>n ||
     counts.canonical_snv_alt_alleles!==counts.transitions+counts.transversions ||
     counts.canonical_snv_alt_alleles>n*10000)
    throw new Error("Contradictory VCF site-count evidence.");
  const q=data.mean_qual;
  if((counts.quality_available_sites===0 && q!==null)||
     (counts.quality_available_sites>0 &&
      (typeof q!=="number"||!Number.isFinite(q)||q<0||q>1000000)))
    throw new Error("Invalid VCF quality evidence.");
  return {
    schema:"genithm-vcf-site-qc/1",record_count:n,sample_count:counts.sample_count,
    contigs_seen:counts.contigs_seen,snv_sites:counts.snv_sites,mnv_sites:counts.mnv_sites,
    indel_sites:counts.indel_sites,complex_sites:counts.complex_sites,symbolic_sites:counts.symbolic_sites,
    reference_only_sites:counts.reference_only_sites,multiallelic_sites:counts.multiallelic_sites,
    transitions:counts.transitions,transversions:counts.transversions,pass_sites:counts.pass_sites,
    failed_filter_sites:counts.failed_filter_sites,unfiltered_sites:counts.unfiltered_sites,
    quality_available_sites:counts.quality_available_sites,missing_quality_sites:counts.missing_quality_sites,
    mean_qual:counts.quality_available_sites? q as number:null,
    sampling:false,genotypes_inspected:false
  };
}

export type VerifiedGff3FeatureQc = {
  schema:"genithm-gff3-feature-qc/1";
  feature_rows:number;gene_features:number;transcript_features:number;exon_features:number;
  cds_features:number;utr_features:number;other_features:number;
  plus_features:number;minus_features:number;unstranded_features:number;unknown_strand_features:number;
  phased_cds_rows:number;unphased_cds_rows:number;contigs_seen:number;
  total_feature_span_bp:number;minimum_feature_bp:number;maximum_feature_bp:number;
  mean_feature_bp:number|null;embedded_fasta:boolean;
  sampling:false;attributes_interpreted:false;embedded_fasta_validated:false;
};
/** The source report has already passed the private API's digest and structure check.
 * Re-check an allowlist here: neither IDs, positions, feature attributes,
 * filenames, contig names nor embedded FASTA content may reach the LLM.
 */
function verifiedGff3FeatureQc(report:RecordValue, inspection:string):VerifiedGff3FeatureQc {
  const intake=object(report.intake);
  const hint=object(intake.name_hint);
  if(inspection!=="complete_gff3" || report.format!=="opaque" ||
     intake.registry_version!=="genithm-file-registry/3" || intake.mode!=="auto" ||
     hint.format_id!=="gff" || hint.available_inspection!=="complete_gff3")
    throw new Error("GFF3 evidence requires a complete verified scientific scan.");
  const data=object(report.metrics);
  if(data.schema!=="genithm-gff3-feature-qc/1" || data.engine_version!=="genithm-gff3-stream/1.0.0" ||
     data.sampling!==false || data.attributes_interpreted!==false ||
     data.embedded_fasta_validated!==false || typeof data.embedded_fasta!=="boolean")
    throw new Error("Unsupported GFF3 evidence schema.");
  const fields=["feature_rows","gene_features","transcript_features","exon_features","cds_features",
    "utr_features","other_features","plus_features","minus_features","unstranded_features",
    "unknown_strand_features","phased_cds_rows","unphased_cds_rows","contigs_seen",
    "total_feature_span_bp","minimum_feature_bp","maximum_feature_bp","expanded_bytes"] as const;
  const counts=Object.fromEntries(fields.map(k=>[k,uint(data[k])])) as Record<typeof fields[number],number>;
  const n=counts.feature_rows;
  if(counts.contigs_seen>Math.min(n,100000) ||
     counts.expanded_bytes<15 ||
     counts.gene_features+counts.transcript_features+counts.exon_features+counts.cds_features+
       counts.utr_features+counts.other_features!==n ||
     counts.plus_features+counts.minus_features+counts.unstranded_features+
       counts.unknown_strand_features!==n ||
     counts.phased_cds_rows+counts.unphased_cds_rows!==counts.cds_features)
    throw new Error("Contradictory GFF3 feature counts.");
  const mean=data.mean_feature_bp;
  if(n===0){
    if(counts.contigs_seen||counts.total_feature_span_bp||counts.minimum_feature_bp||
       counts.maximum_feature_bp||mean!==null)throw new Error("Contradictory empty GFF3 summary.");
  } else {
    if(counts.minimum_feature_bp<1 || counts.maximum_feature_bp<counts.minimum_feature_bp ||
       counts.total_feature_span_bp<n*counts.minimum_feature_bp ||
       counts.total_feature_span_bp>n*counts.maximum_feature_bp ||
       typeof mean!=="number" || !Number.isFinite(mean) ||
       Math.abs(mean-counts.total_feature_span_bp/n)>0.000001)
      throw new Error("Invalid GFF3 span statistics.");
  }
  return {
    schema:"genithm-gff3-feature-qc/1",feature_rows:n,
    gene_features:counts.gene_features,transcript_features:counts.transcript_features,
    exon_features:counts.exon_features,cds_features:counts.cds_features,
    utr_features:counts.utr_features,other_features:counts.other_features,
    plus_features:counts.plus_features,minus_features:counts.minus_features,
    unstranded_features:counts.unstranded_features,
    unknown_strand_features:counts.unknown_strand_features,
    phased_cds_rows:counts.phased_cds_rows,unphased_cds_rows:counts.unphased_cds_rows,
    contigs_seen:counts.contigs_seen,total_feature_span_bp:counts.total_feature_span_bp,
    minimum_feature_bp:counts.minimum_feature_bp,maximum_feature_bp:counts.maximum_feature_bp,
    mean_feature_bp:mean as number|null,embedded_fasta:data.embedded_fasta as boolean,
    sampling:false,attributes_interpreted:false,embedded_fasta_validated:false,
  };
}

export type VerifiedResearchFile = {
  id: string; project_id: string; source_sha256: string; report_sha256: string;
  source_bytes: number; format: string; scientific_scope: string; inspection: string;
  vcf_site_qc?: VerifiedVcfSiteQc;
  gff3_feature_qc?: VerifiedGff3FeatureQc;
};
export function parseVerifiedResearchFile(input: unknown, id: string, project: string): VerifiedResearchFile {
  const envelope = object(input), report = object(envelope.report);
  if (!UUID.test(id) || !UUID.test(project) || envelope.record_id !== id || envelope.project_id !== project ||
      report.schema !== "genithm-large-data-result/1" || report.verification !== "whole_object_sha256" ||
      typeof report.source_sha256 !== "string" || !HEX.test(report.source_sha256) ||
      typeof report.report_sha256 !== "string" || !HEX.test(report.report_sha256) ||
      typeof report.format !== "string" || !["fastq", "fastq.gz", "opaque"].includes(report.format) ||
      typeof report.scientific_scope !== "string" || !SCOPES.has(report.scientific_scope)) {
    throw new Error("Research file evidence is missing or does not match this project.");
  }
  const size = uint(report.source_bytes);
  if (size < 1) throw new Error("Invalid source size in the verified report.");
  let inspection = "legacy";
  if (report.intake !== undefined) {
    inspection = String(object(report.intake).inspection || "");
    if (!["complete_fastq", "complete_fasta", "complete_vcf", "complete_gff3", "integrity_only"].includes(inspection)) throw new Error("Invalid inspection status.");
  }
  if (report.scientific_scope === "full_fastq_aggregate_qc") {
    const metrics = object(report.metrics);
    if (uint(metrics.read_count) < 1 || uint(metrics.base_count) < 1) throw new Error("Missing FASTQ evidence.");
    if (inspection !== "legacy" && inspection !== "complete_fastq") throw new Error("Conflicting FASTQ inspection.");
  } else if (report.scientific_scope === "full_fasta_structural_summary") {
    const fasta = object(object(report.intake).fasta);
    if (uint(fasta.record_count) < 1 || uint(fasta.symbol_count) < 1 || inspection !== "complete_fasta")
      throw new Error("Missing complete FASTA inspection.");
  } else if (report.scientific_scope === "full_vcf_site_qc") {
    const vcf=verifiedVcfSiteQc(report,inspection);
    return {id,project_id:project,source_sha256:report.source_sha256,report_sha256:report.report_sha256,
      source_bytes:size,format:report.format,scientific_scope:report.scientific_scope,inspection,vcf_site_qc:vcf};
  } else if (report.scientific_scope === "full_gff3_feature_qc") {
    const gff3=verifiedGff3FeatureQc(report,inspection);
    return {id,project_id:project,source_sha256:report.source_sha256,report_sha256:report.report_sha256,
      source_bytes:size,format:report.format,scientific_scope:report.scientific_scope,inspection,gff3_feature_qc:gff3};
  } else if (report.metrics !== null || (inspection !== "legacy" && inspection !== "integrity_only")) {
    throw new Error("Bytes-only evidence cannot claim a scientific result.");
  }
  return {id, project_id: project, source_sha256: report.source_sha256, report_sha256: report.report_sha256,
    source_bytes: size, format: report.format, scientific_scope: report.scientific_scope, inspection};
}

export function assertMatchingEvidence(snapshot: unknown, verified: VerifiedResearchFile[]) {
  if (!Array.isArray(snapshot) || snapshot.length !== verified.length) throw new Error("Recorded file evidence is incomplete.");
  snapshot.forEach((item, i) => {
    const row = object(item), source = verified[i];
    if (row.id !== source.id || row.source_sha256 !== source.source_sha256 ||
        row.report_sha256 !== source.report_sha256 || row.source_bytes !== source.source_bytes ||
        row.format !== source.format || row.scientific_scope !== source.scientific_scope ||
        row.inspection !== source.inspection) throw new Error("Research file evidence changed before chat authorization.");
    if (row.scientific_scope === "bytes_only" && (row.fasta !== null || row.fastq !== null || row.vcf_site_qc != null || row.gff3_feature_qc != null))
      throw new Error("An uninspected file was misrepresented as scientifically analyzed.");
  });
}

/** Enrich only an already DB-bound, digest-matched, authorized turn with
 * narrowly reviewed numeric VCF and GFF3 QC subsets. SQL still owns the immutable evidence
 * snapshot and every permission check. This enrichment is LLM context only.
 * Never persist or trust a client-supplied VCF metric on this path. */
export function withVerifiedVcfSiteEvidence(context:RecordValue,verified:VerifiedResearchFile[]):RecordValue {
  if(!verified.length)return context;
  assertMatchingEvidence(context.selected_verified_research_files,verified);
  const bound=context.selected_verified_research_files as unknown[];
  const enriched=bound.map((item,i)=>{
    const vcf=verified[i].vcf_site_qc;
    const gff3=verified[i].gff3_feature_qc;
    return vcf ? {...object(item),vcf_site_qc:vcf} : gff3 ? {...object(item),gff3_feature_qc:gff3} : item;
  });
  return {...context,selected_verified_research_files:enriched};
}
export async function loadVerifiedResearchFiles(ids: string[], project: string, token: string, signal: AbortSignal): Promise<VerifiedResearchFile[]> {
  if (ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id => !UUID.test(id)))
    throw new Error("Choose no more than four distinct research files.");
  if (!ids.length) return [];
  if (!token || !UUID.test(project)) throw new Error("Research file authorization unavailable.");
  const configured = process.env.GENITHM_API_INTERNAL_URL || process.env.NEXT_PUBLIC_GENITHM_API_URL;
  if (!configured) throw new Error("Research-file API has not been configured.");
  const endpoint = new URL(configured);
  if ((endpoint.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && endpoint.hostname === "localhost" && endpoint.protocol === "http:")) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Research-file API endpoint is invalid.");
  const base = endpoint.href.replace(/\/$/, "");
  const results: VerifiedResearchFile[] = [];
  for (const id of ids) {
    const response = await fetch(`${base}/api/v1/large-data/uploads/${id}/file-report`, {
      headers: {Authorization: `Bearer ${token}`, Accept: "application/json"},
      cache: "no-store", redirect: "error", signal,
    });
    if (!response.ok) throw new Error("Selected file is not accessible or has not completed verification.");
    if (Number(response.headers.get("content-length") || 0) > MAX_REPORT)
      throw new Error("File report exceeded the permitted evidence size.");
    const data = await response.text();
    if (data.length > MAX_REPORT) throw new Error("File report exceeded the permitted evidence size.");
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { throw new Error("Invalid verified file report."); }
    results.push(parseVerifiedResearchFile(parsed, id, project));
  }
  return results;
}
