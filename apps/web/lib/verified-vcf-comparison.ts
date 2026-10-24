/** V66: deterministic comparison of already checked VCF site-level evidence.
 *
 * No raw VCF file, variant record, genomic position, allele, sample name,
 * genotype or LLM-provided number is an input to this calculation. The caller
 * must first bind each report to its owner/project and SQL-recorded digests.
 */
import type {VerifiedResearchFile, VerifiedVcfSiteQc} from "./verified-research-files";

const COMPARE = /\b(compare|comparison|comparisons|contrasts?|differences?|versus|vs\.?|side[- ]by[- ]side)\b/i;
const ROW_LEVEL = /\b(overlap|shared variants?|concordance|intersection|individual variants?|matching variants?|same variants?|genotypes?|loci|variants? in common)\b/i;
const DIGEST = /^[a-f0-9]{64}$/;

export function isVerifiedVcfComparisonRequest(message:string, files:readonly VerifiedResearchFile[]):boolean {
  return typeof message === "string" && message.length <= 16000 && COMPARE.test(message) &&
    files.length >= 2 && files.length <= 4 &&
    files.every(file=>file.scientific_scope==="full_vcf_site_qc" &&
      file.inspection==="complete_vcf" && file.format==="opaque" &&
      DIGEST.test(file.source_sha256) && DIGEST.test(file.report_sha256) &&
      file.vcf_site_qc?.schema==="genithm-vcf-site-qc/1" &&
      file.vcf_site_qc.sampling===false && file.vcf_site_qc.genotypes_inspected===false) &&
    new Set(files.map(file=>file.id)).size === files.length &&
    new Set(files.map(file=>file.project_id)).size === 1;
}

function count(value:number):string {
  if(!Number.isSafeInteger(value)||value<0)throw new Error("Invalid VCF site-count evidence");
  return value.toLocaleString("en-US");
}
function percent(n:number,total:number):string {
  count(n);count(total);
  if(n>total)throw new Error("Inconsistent VCF site counts");
  return total===0 ? "n/a" : (100*n/total).toFixed(2)+"%";
}
function ratio(metrics:VerifiedVcfSiteQc):string {
  count(metrics.transitions);count(metrics.transversions);
  if(metrics.transversions===0)return "n/a (no transversions)";
  return (metrics.transitions/metrics.transversions).toFixed(2);
}
function quality(metric:VerifiedVcfSiteQc):string {
  count(metric.quality_available_sites);
  return metric.mean_qual===null ? "n/a" :
    typeof metric.mean_qual === "number" && Number.isFinite(metric.mean_qual) &&
    metric.mean_qual>=0 && metric.mean_qual<=1000000 ? metric.mean_qual.toFixed(2) :
    (()=>{throw new Error("Invalid VCF quality statistic")})();
}

export function renderVerifiedVcfComparison(message:string, files:readonly VerifiedResearchFile[]):string {
  if(!isVerifiedVcfComparisonRequest(message,files))
    throw new Error("VCF comparison requires two to four individually verified project VCF reports");
  const header = "## Genithm — verified VCF site-QC comparison";
  const rows = files.map((file,i)=>{
    const m=file.vcf_site_qc!;
    count(m.record_count);
    if(m.snv_sites+m.mnv_sites+m.indel_sites+m.complex_sites+
       m.symbolic_sites+m.reference_only_sites!==m.record_count ||
       m.pass_sites+m.failed_filter_sites+m.unfiltered_sites!==m.record_count ||
       m.quality_available_sites+m.missing_quality_sites!==m.record_count ||
       m.transitions+m.transversions>m.record_count*10000)
      throw new Error("VCF science summary invariants failed");
    const id=`VCF ${i+1} (${file.source_sha256.slice(0,12)})`;
    return `| ${id} | ${count(m.record_count)} | ${count(m.snv_sites)} | ${count(m.indel_sites)} | ${count(m.symbolic_sites)} | ${count(m.multiallelic_sites)} | ${count(m.pass_sites)} (${percent(m.pass_sites,m.record_count)}) | ${ratio(m)} | ${quality(m)} | ${count(m.sample_count)} |`;
  });
  const caveat=ROW_LEVEL.test(message)
    ? "You requested a record-level comparison. These reports **cannot** establish which variants overlap, match, differ, or are biologically concordant; the table below is limited to independently measured whole-file site counts."
    : "This is a comparison of independently measured QC summaries, not a read-through of individual variants.";
  return [header,"",caveat,"",
    "| Verified file (source SHA-256 prefix) | VCF sites | SNV sites | Indel sites | Symbolic sites | Multiallelic sites | PASS sites (%) | Ti/Tv | Mean available QUAL | Sample columns |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,"",
    "All figures come from the authenticated, full-file Genithm VCF scanner and were checked against the database-bound source/report hashes before this message. Files are identified in the same selection order as the chat attachment picker.",
    "",
    "**Interpretation:** PASS% = PASS sites / total records. Ti/Tv counts canonical single-base alternative alleles, so it is not a per-site ratio; it is undefined with zero transversions. Mean QUAL excludes records with missing QUAL. A higher PASS% or Ti/Tv is not proof of a better experiment or a valid biological finding.",
    "",
    "**Not analyzed:** genotype quality, per-sample variants, allele frequencies, reference correctness, variant concordance/overlap, pathogenicity, or clinical significance. This comparison created no new scientific job and did not send raw variants or genotypes to an AI provider."
  ].join("\n");
}
