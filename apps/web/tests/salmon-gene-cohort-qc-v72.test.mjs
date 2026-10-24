import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {inspectSalmonQuantifications} from '../lib/salmon-quant-matrix.ts';
import {summarizeSalmonGenes} from '../lib/salmon-gene-summary-v71.ts';
import {deriveTx2GeneFromGtf} from '../lib/gtf-transcript-mapping-v72.ts';
import {inspectSalmonGeneCohort,SalmonCohortQcError,MAX_COHORT_CELLS} from '../lib/salmon-gene-cohort-qc-v72.ts';
const dir=dirname(fileURLToPath(import.meta.url));
const read=(n)=>readFileSync(resolve(dir,'fixtures/',n),'utf8');
const cohort=()=>{
 const quant=inspectSalmonQuantifications([
   {sample:'CTRL1',text:read('v71/CTRL1.quant.sf')},
   {sample:'TREAT1',text:read('v71/TREAT1.quant.sf')}]);
 return summarizeSalmonGenes(quant,deriveTx2GeneFromGtf(read('v72/mapped-annotation.gtf')).transcript_to_gene_tsv);
};
const mustFail=(code,fn)=>assert.throws(fn,e=>e instanceof SalmonCohortQcError&&e.code===code);

test('V72 calculates measured sample-detection and Pearson correlation from actual gene TPM',()=>{
 const result=inspectSalmonGeneCohort(cohort());
 assert.equal(result.schema,'genithm-salmon-gene-cohort-qc/1');
 assert.equal(result.status,'descriptive_imported_gene_qc_only');
 assert.equal(result.genes,2);
 assert.equal(result.samples,2);
 assert.equal(result.metrics[0].genes_tpm_ge_1,2);
 assert.equal(result.metrics[0].nonzero_genes,2);
 assert.equal(result.metrics[0].summed_gene_tpm,1000000);
 assert.equal(result.metrics[1].summed_estimated_fragments,100);
 assert.equal(result.correlations.length,1);
 assert.equal(result.correlations[0].pearson_log2_tpm_plus_one,-1);
 assert.equal(result.correlations[0].genes_compared,2);
 assert.match(result.sample_qc_tsv,/CTRL1\t2\t2\t1000000\t100/);
 assert.match(result.correlation_tsv,/CTRL1\tTREAT1\t2\t-1/);
 assert.equal(result.differential_expression_performed,false);
 assert.equal(result.source_fastq_verified,false);
 assert.match(result.warnings.join(' '),/No differential expression, p-values/);
});

test('V72 explicitly represents sample comparisons as undefined with zero variance',()=>{
 const q='Name\tLength\tEffectiveLength\tTPM\tNumReads\nTX001\t1000\t900\t500000\t50\nTX002\t1000\t900\t500000\t50\n';
 const result=inspectSalmonGeneCohort(summarizeSalmonGenes(
   inspectSalmonQuantifications([{sample:'A',text:q},{sample:'B',text:q}]),
   'transcript_id\tgene_id\nTX001\tG1\nTX002\tG2\n'));
 assert.equal(result.correlations[0].pearson_log2_tpm_plus_one,null);
 assert.match(result.correlation_tsv,/A\tB\t2\tNA/);
 assert.match(result.warnings.join(' '),/Zero-variance samples/);
});

test('V72 detects missing or forged cohort source, cross-sample label and count changes',()=>{
 const source=cohort();
 mustFail('source',()=>inspectSalmonGeneCohort({...source,tximport_equivalent:true}));
 mustFail('source',()=>inspectSalmonGeneCohort({...source,source_reads_verified:true}));
 mustFail('conservation',()=>inspectSalmonGeneCohort({...source,gene_tpm_tsv:source.gene_tpm_tsv.replace('750000','749999')}));
 mustFail('conservation',()=>inspectSalmonGeneCohort({...source,gene_estimated_fragments_tsv:source.gene_estimated_fragments_tsv.replace('90.5','99.5')}));
 mustFail('reference',()=>inspectSalmonGeneCohort({...source,gene_tpm_tsv:source.gene_tpm_tsv.replace('GENE_B','GENE_C')}));
 mustFail('reference',()=>inspectSalmonGeneCohort({...source,gene_estimated_fragments_tsv:source.gene_estimated_fragments_tsv.replace('TREAT1','DIFFERENT')}));
});

test('V72 rejects negative/non-finite/duplicate genes and untrusted spreadsheet formulas',()=>{
 const source=cohort();
 for(const text of ['-1','NaN','Infinity','=cmd']){
  const corrupted={...source,gene_tpm_tsv:source.gene_tpm_tsv.replace('750000',text)};
  assert.throws(()=>inspectSalmonGeneCohort(corrupted));
 }
 mustFail('matrix',()=>inspectSalmonGeneCohort({...source,gene_tpm_tsv:source.gene_tpm_tsv.replace('GENE_B','GENE_A')}));
 mustFail('header',()=>inspectSalmonGeneCohort({...source,gene_tpm_tsv:source.gene_tpm_tsv.replace('gene_id','locus')}));
 assert.equal(MAX_COHORT_CELLS,1000000);
});

test('V72 cohort QC does not infer significance or biological sample relationships',()=>{
 const qc=inspectSalmonGeneCohort(cohort());
 assert.equal(qc.correlations.length,1);
 assert.ok(qc.correlations.every(x=>typeof x.pearson_log2_tpm_plus_one==='number'||x.pearson_log2_tpm_plus_one===null));
 assert.match(qc.warnings.join(' '),/cannot prove correct biological labels/);
 assert.ok(!JSON.stringify(qc).includes('p_value'));
});

test('V72 scales a real 8-sample, 2,000-transcript Salmon cohort within bounded matrix limits',()=>{
 const n=2000,samples=8;
 const names=Array.from({length:samples},(_,i)=>'B'+(i+1));
 const input=names.map((sample,i)=>{
   const rows=['Name\tLength\tEffectiveLength\tTPM\tNumReads'];
   for(let t=0;t<n;t++){
     const tp=(t+i)%2===0?600:400;
     rows.push(['TX'+String(t).padStart(5,'0'),'1000','800',String(tp),'12.5'].join('\t'));
   }
   return {sample,text:rows.join('\n')+'\n'};
 });
 const ref='transcript_id\tgene_id\n'+Array.from({length:n},(_,i)=>
   'TX'+String(i).padStart(5,'0')+'\tG'+String(Math.floor(i/2)).padStart(5,'0')+'\n').join('');
 const checked=inspectSalmonQuantifications(input);
 const gene=summarizeSalmonGenes(checked,ref);
 const qc=inspectSalmonGeneCohort(gene);
 assert.equal(qc.genes,1000);
 assert.equal(qc.samples,8);
 assert.equal(qc.correlations.length,28);
 assert.equal(qc.metrics[0].summed_gene_tpm,1000000);
 assert.equal(qc.metrics[0].summed_estimated_fragments,25000);
 assert.ok(qc.correlations.every(x=>x.pearson_log2_tpm_plus_one===null));
});
