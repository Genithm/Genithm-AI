/* Deterministic synthetic UI fixtures only. Backend correctness is tested with
 * real PostgreSQL/storage separately; these are not production results. */
import {createHash} from 'node:crypto';
const project='20000000-0000-4000-8000-000000000001';
const ids=['61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002'];
const pairId='62000000-0000-4000-8000-000000000001';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const seal=value=>({...value,report_sha256:hash(canonical(value))});
const positionColumns=['start','end','bases','phred_sum','q20_bases','q30_bases','A','C','G','T','N','p10','p25','p50','p75','p90'];
const lengthColumns=['start','end','reads'];
const ends=[...Array.from({length:10},(_,i)=>i+1),...Array.from({length:11},(_,i)=>(i+2)*10)];
const sequence='ACGT'.repeat(30);
const raw=[20,0].map((q,i)=>Buffer.from(`@PRIVATE_PROFILE_FIXTURE/${i+1}\n${sequence}\n+\n${'I'.repeat(60)}${String.fromCharCode(33+q).repeat(60)}\n`));
function metric(tailScore,index){
 let start=1;
 const positions=ends.map(end=>{
  const n=end-start+1,q=end<=60?40:tailScore,bases=sequence.slice(start-1,end);
  const row=[start,end,n,q*n,q>=20?n:0,q>=30?n:0,...[...'ACGTN'].map(b=>[...bases].filter(x=>x===b).length),q,q,q,q,q];
  start=end+1;return row;
 });
 const mean=(40+tailScore)/2;
 return {read_count:1,base_count:120,base_counts:{A:30,C:30,G:30,T:30,N:0},mean_phred:mean,
  q20_bases:tailScore>=20?120:60,q30_bases:60,gc_percent:50,min_length:120,max_length:120,mean_length:120,
  expanded_bytes:raw[index].length,quality_encoding:'phred33_assumed',sampling:false,paired_identifiers_checked:false,
  quality_profile:{schema:'genithm-read-quality-profile/1',engine_version:'genithm-read-quality/1.0.0',sampling:false,
   quality_encoding:'phred33_assumed',position_binning:'fixed_ranges_all_observed_bases',quantile_method:'nearest_rank_pooled_bases',
   read_mean_phred_binning:'floor_integer',read_gc_binning:'floor_percent_gc_over_acgt_N_excluded',
   position_columns:positionColumns,positions,length_columns:lengthColumns,read_lengths:[[111,120,1]],
   read_mean_phred_counts:Array.from({length:94},(_,i)=>i===mean?1:0),read_gc_percent_counts:Array.from({length:101},(_,i)=>i===50?1:0),undefined_gc_reads:0}};
}
const metrics=[metric(20,0),metric(0,1)];
const singleReport=seal({schema:'genithm-large-data-result/1',source_bytes:raw[0].length,format:'fastq',verifier_version:'genithm-large-data/1.1.0',
 verification:'whole_object_sha256',scientific_scope:'full_fastq_aggregate_qc',metrics:metrics[0],elapsed_seconds:0,source_sha256:hash(raw[0])});
const pairReport=seal({schema:'genithm-large-pair-result/1',verifier_version:'genithm-large-pair/1.0.0',verification:'both_whole_object_sha256',
 scientific_scope:'ordered_paired_fastq_qc',source_ids:ids,source_sha256:raw.map(hash),source_bytes:raw.map(b=>b.length),pair_count:1,
 explicit_mate_labels:1,partially_labeled_pairs:0,unlabeled_pairs:0,identical_source_hashes:false,sampling:false,unique_identifiers_checked:false,
 biological_pairing_proven:false,mates:metrics.map(m=>({...m,paired_identifiers_checked:true})),elapsed_seconds:0});
const envelope=(id,report,sources_available)=>({schema:'genithm-quality-report-envelope/1',record_id:id,project_id:project,sources_available,report});
const single=envelope(ids[0],singleReport,true),paired=envelope(pairId,pairReport,false);
function brief(report){const copy=structuredClone(report);for(const m of copy.mates||[copy.metrics]){delete m.quality_profile;m.quality_profile_available=true;}return copy;}
function tsv(env){
 const report=env.report,rows=[['# Synthetic UI fixture: not production evidence'],['# record_id',env.record_id],['# report_sha256',report.report_sha256],['# sources_available',env.sources_available],['# Phred+33 assumed; range quantiles use pooled bases and nearest rank; no sampling']];
 for(const [i,m] of (report.mates||[report.metrics]).entries()){
  const p=m.quality_profile,label=report.mates?`R${i+1}`:'single';
  rows.push(['# positions',label],positionColumns,...p.positions,['# read_lengths',label],lengthColumns,...p.read_lengths,['# read_mean_phred',label],['score','reads'],...p.read_mean_phred_counts.map((n,q)=>[q,n]),['# read_gc_percent',label],['percent','reads'],...p.read_gc_percent_counts.map((n,gc)=>[gc,n]),['# undefined_gc_reads',p.undefined_gc_reads]);
 }
 return rows.map(row=>row.join('\t')).join('\n')+'\n';
}
export default {single,paired,single_summary:brief(singleReport),pair_summary:brief(pairReport),tsv:tsv(single),pair_tsv:tsv(paired)};
