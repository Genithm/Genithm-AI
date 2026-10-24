import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {inspectSalmonQuantifications} from '../lib/salmon-quant-matrix.ts';
import {summarizeSalmonGenes} from '../lib/salmon-gene-summary-v71.ts';
import {inspectSalmonGeneCohort} from '../lib/salmon-gene-cohort-qc-v72.ts';
import {inspectSalmonCohortDesign,SalmonDesignError} from '../lib/salmon-design-cohort-v73.ts';
const base=dirname(fileURLToPath(import.meta.url));
const fixture=(n)=>readFileSync(resolve(base,'fixtures/v71',n),'utf8');
const two=()=>inspectSalmonGeneCohort(summarizeSalmonGenes(inspectSalmonQuantifications([
 {sample:'CTRL1',text:fixture('CTRL1.quant.sf')},
 {sample:'TREAT1',text:fixture('TREAT1.quant.sf')}]),fixture('tx2gene.tsv')));
const err=(code,fn)=>assert.throws(fn,x=>x instanceof SalmonDesignError && x.code===code);

test('V73 joins exact sample labels to calculated measured V72 correlations',()=>{
 const result=inspectSalmonCohortDesign(two(),'sample,condition\nTREAT1,treated\nCTRL1,control\n');
 assert.equal(result.schema,'genithm-salmon-design-cohort-qc/1');
 assert.equal(result.status,'descriptive_correlations_with_researcher_labels_only');
 assert.deepEqual(result.groups,[{condition:'control',biological_samples:1,replicates_ge_3:false},
  {condition:'treated',biological_samples:1,replicates_ge_3:false}]);
 assert.equal(result.group_pairs.length,3);
 assert.equal(result.group_pairs[0].median_pearson_log2_tpm_plus_one,null);
 assert.equal(result.group_pairs[1].median_pearson_log2_tpm_plus_one,-1);
 assert.equal(result.group_pairs[2].median_pearson_log2_tpm_plus_one,null);
 assert.equal(result.supported_two_group_replication_counts,false);
 assert.match(result.group_pair_qc_tsv,/control\ttreated\tbetween\t1\t0\t-1/);
 assert.match(result.warnings.join(' '),/researcher/);
 assert.equal(result.differential_expression_performed,false);
 assert.equal(result.fastq_and_reference_verified,false);
});

test('V73 biological replication threshold and group-type correlation medians are descriptive',()=>{
 const samples=[...Array(3)].map((_,i)=>({sample:'C'+(i+1),text:fixture('CTRL1.quant.sf')}))
   .concat([...Array(3)].map((_,i)=>({sample:'T'+(i+1),text:fixture('TREAT1.quant.sf')})));
 const q=inspectSalmonQuantifications(samples);
 const cq=inspectSalmonGeneCohort(summarizeSalmonGenes(q,fixture('tx2gene.tsv')));
 const d='sample,condition\nC1,control\nC2,control\nC3,control\nT1,treated\nT2,treated\nT3,treated\n';
 const answer=inspectSalmonCohortDesign(cq,d);
 assert.equal(answer.samples,6);
 assert.equal(answer.supported_two_group_replication_counts,true);
 assert.deepEqual(answer.group_pairs.map(x=>x.available_pairs),[3,9,3]);
 assert.deepEqual(answer.group_pairs.map(x=>x.median_pearson_log2_tpm_plus_one),[1,-1,1]);
 assert.ok(answer.warnings.every(w=>!w.includes('fewer than three')));
 assert.match(answer.matched_design_tsv,/C1\tcontrol/);
});

test('V73 rejects foreign, missing, repeated and unsafe study labels',()=>{
 err('mismatch',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nOTHER,treated\n'));
 err('duplicate',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nCTRL1,treated\n'));
 err('identifier',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nTREAT1,=HYPERLINK\n'));
 err('identifier',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nTREAT1,$(echo)\n'));
 err('conditions',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nTREAT1,control\n'));
 err('header',()=>inspectSalmonCohortDesign(two(),'sample,group\nCTRL1,control\nTREAT1,treated\n'));
 err('columns',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control,extra\nTREAT1,treated\n'));
 err('control',()=>inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nTREAT1,treated\u0000\n'));
 err('size',()=>inspectSalmonCohortDesign(two(),'sample,condition\n'+('a'.repeat(17000))));
});

test('V73 rejects forged sample pair sets, duplicate correlations and invalid r',()=>{
 const cohort=two();
 err('source',()=>inspectSalmonCohortDesign({...cohort,differential_expression_performed:true},'sample,condition\nCTRL1,control\nTREAT1,treated\n'));
 err('source',()=>inspectSalmonCohortDesign({...cohort,correlations:[]},'sample,condition\nCTRL1,control\nTREAT1,treated\n'));
 err('pair',()=>inspectSalmonCohortDesign({...cohort,correlations:[{...cohort.correlations[0],sample_b:'STRANGER'}]},'sample,condition\nCTRL1,control\nTREAT1,treated\n'));
 err('correlation',()=>inspectSalmonCohortDesign({...cohort,correlations:[{...cohort.correlations[0],pearson_log2_tpm_plus_one:5}]},'sample,condition\nCTRL1,control\nTREAT1,treated\n'));
 err('correlation',()=>inspectSalmonCohortDesign({...cohort,correlations:[{...cohort.correlations[0],pearson_log2_tpm_plus_one:NaN}]},'sample,condition\nCTRL1,control\nTREAT1,treated\n'));
});

test('V73 represents zero-variance sample correlations as undefined, not false similarity',()=>{
 const cohort=two();
 const changed={...cohort,correlations:cohort.correlations.map(c=>({...c,pearson_log2_tpm_plus_one:null}))};
 const answer=inspectSalmonCohortDesign(changed,'sample,condition\nCTRL1,control\nTREAT1,treated\n');
 assert.equal(answer.group_pairs[1].undefined_pairs,1);
 assert.equal(answer.group_pairs[1].median_pearson_log2_tpm_plus_one,null);
 assert.match(answer.group_pair_qc_tsv,/between\t0\t1\tNA/);
 assert.match(answer.warnings.join(' '),/undefined/);
});

test('V73 no execution, clinical claims or significance claims are made in design module',()=>{
 const src=readFileSync(resolve(base,'../lib/salmon-design-cohort-v73.ts'),'utf8');
 assert.doesNotMatch(src,/fetch\(|execSync|spawn\(|eval\(|supabase\.from\(/);
 const res=inspectSalmonCohortDesign(two(),'sample,condition\nCTRL1,control\nTREAT1,treated\n');
 assert.equal(res.labels_biologically_verified,false);
 assert.ok(!('p_value' in res));
});
