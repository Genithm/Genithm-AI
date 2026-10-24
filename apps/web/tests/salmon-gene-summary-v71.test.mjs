import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {inspectSalmonQuantifications} from '../lib/salmon-quant-matrix.ts';
import {
  summarizeSalmonGenes, parseTx2GeneMapping, SalmonGeneSummaryError,
  MAX_TX2GENE_BYTES, MAX_GENE_MATRIX_CELLS
} from '../lib/salmon-gene-summary-v71.ts';

const root=dirname(fileURLToPath(import.meta.url));
const read=(name)=>readFileSync(resolve(root,'fixtures/v71/',name),'utf8');
const input=()=>[
  {sample:'CTRL1',text:read('CTRL1.quant.sf')},
  {sample:'TREAT1',text:read('TREAT1.quant.sf')}
];
const mapping=()=>read('tx2gene.tsv');
const checked=()=>inspectSalmonQuantifications(input());
const mustFail=(f,code)=>assert.throws(f,e=>e instanceof SalmonGeneSummaryError&&e.code===code);

test('V71 makes real gene TPM and estimated-fragment summaries from V70 outputs',()=>{
  const actual=summarizeSalmonGenes(checked(),mapping());
  assert.equal(actual.schema,'genithm-salmon-gene-summary/1');
  assert.equal(actual.status,'summarized_external_salmon_outputs_only');
  assert.equal(actual.transcripts,3);
  assert.equal(actual.genes,2);
  assert.equal(actual.multi_transcript_genes,1);
  assert.equal(actual.mapped_transcripts,3);
  assert.equal(actual.mapping_rows_not_quantified,0);
  assert.match(actual.gene_tpm_tsv,/GENE_A\t750000\t200000/);
  assert.match(actual.gene_tpm_tsv,/GENE_B\t250000\t800000/);
  assert.match(actual.gene_estimated_fragments_tsv,/GENE_A\t90.5\t19.75/);
  assert.match(actual.gene_estimated_fragments_tsv,/GENE_B\t9.5\t80.25/);
  assert.match(actual.gene_transcript_counts_tsv,/GENE_A\t2/);
  assert.match(actual.gene_transcript_counts_tsv,/GENE_B\t1/);
  assert.deepEqual(actual.sample_summaries.map(s=>s.summarized_gene_estimated_fragments),[100,100]);
  assert.deepEqual(actual.sample_summaries.map(s=>s.summarized_gene_tpm),[1000000,1000000]);
  assert.equal(actual.source_reads_verified,false);
  assert.equal(actual.tximport_equivalent,false);
  assert.equal(actual.transcriptome_reference_verified,false);
  assert.equal(actual.gene_level_differential_expression_performed,false);
  assert.match(actual.warnings.join(' '),/NOT tximport\/tximeta/);
});

test('V71 exact ID matching is independent of transcript row and map order',()=>{
  const reverse=['transcript_id\tgene_id','TX003\tGENE_A','TX002\tGENE_B','TX001\tGENE_A'].join('\n')+'\n';
  const a=summarizeSalmonGenes(checked(),mapping());
  const b=summarizeSalmonGenes(checked(),reverse);
  assert.equal(a.gene_tpm_tsv,b.gene_tpm_tsv);
  assert.equal(a.gene_estimated_fragments_tsv,b.gene_estimated_fragments_tsv);
  assert.equal(a.gene_transcript_counts_tsv,b.gene_transcript_counts_tsv);
});

test('V71 strictly rejects unmapped, ambiguous and misleading mapping assignments',()=>{
  mustFail(()=>summarizeSalmonGenes(checked(),mapping().replace('TX002\tGENE_B\n','')),'unmapped');
  mustFail(()=>parseTx2GeneMapping(mapping()+'TX001\tGENE_Y\n'),'duplicate');
  mustFail(()=>parseTx2GeneMapping(mapping().replace('TX002\tGENE_B','TX002\t=INJECT')),'identifier');
  mustFail(()=>parseTx2GeneMapping(mapping().replace('TX003\tGENE_A','TX003\tGENE A')),'identifier');
  mustFail(()=>parseTx2GeneMapping(mapping().replace('TX003\tGENE_A','TX003\tGENE_A\tX')),'columns');
  mustFail(()=>parseTx2GeneMapping('transcript\tgene\nTX001\tGENE_A\n'),'header');
  mustFail(()=>parseTx2GeneMapping(mapping().replace('TX001\tGENE_A','TX001\tGENE_A\rjunk')),'rows');
  mustFail(()=>parseTx2GeneMapping(mapping().replace('TX001\tGENE_A','TX001\tGENE_A\u0000')),'control');
  mustFail(()=>parseTx2GeneMapping('x'.repeat(MAX_TX2GENE_BYTES+1)),'size');
});

test('V71 ignores surplus reference transcripts only after quantification matches completely',()=>{
  const extra='TX_EXTRA\tGENE_X\n';
  const actual=summarizeSalmonGenes(checked(),mapping()+extra);
  assert.equal(actual.genes,2);
  assert.equal(actual.mapping_rows_not_quantified,1);
  assert.match(actual.warnings.join(' '),/1 mapping entries were not/);
  assert.ok(!actual.gene_tpm_tsv.includes('GENE_X'));
});

test('V71 refuses forged V70 result dimensions or conservation claims',()=>{
  const original=checked();
  const mutated={...original,status:'not-ready'};
  mustFail(()=>summarizeSalmonGenes(mutated,mapping()),'source');
  const corrupted={...original,sample_stats:original.sample_stats.map(x=>({...x}))};
  corrupted.sample_stats[0].total_reported_tpm=900000;
  mustFail(()=>summarizeSalmonGenes(corrupted,mapping()),'conservation');
  const reversed={...original,transcript_estimated_fragments_tsv:original.transcript_estimated_fragments_tsv.replace('TX001','TX_WRONG')};
  mustFail(()=>summarizeSalmonGenes(reversed,mapping()),'matrix');
  const samples={...original,transcript_tpm_tsv:original.transcript_tpm_tsv.replace('CTRL1','CROSS_USER')};
  mustFail(()=>summarizeSalmonGenes(samples,mapping()),'matrix');
  const lying={...original,quantification_performed_by_genithm:true};
  mustFail(()=>summarizeSalmonGenes(lying,mapping()),'source');
  assert.ok(MAX_GENE_MATRIX_CELLS<=1000000);
});

test('V71 accepts BOM/CRLF mapping and zero-expression genes without invented signal',()=>{
  const win='\uFEFF'+mapping().replaceAll('\n','\r\n');
  const answer=summarizeSalmonGenes(checked(),win);
  assert.equal(answer.genes,2);
  const zero=summarizeSalmonGenes(checked(),
    'transcript_id\tgene_id\nTX001\tA\nTX002\tB\nTX003\tUNEXPRESSED\n');
  assert.match(zero.gene_tpm_tsv,/UNEXPRESSED\t0\t0/);
  assert.match(zero.gene_estimated_fragments_tsv,/UNEXPRESSED\t0\t0/);
});

test('V71 browser UI has no network, shell or gene-level DE execution path',()=>{
  const src=readFileSync(resolve(root,'../app/dashboard/rnaseq/salmon-gene-workbench.tsx'),'utf8');
  const logic=readFileSync(resolve(root,'../lib/salmon-gene-summary-v71.ts'),'utf8');
  assert.match(src,/inspectSalmonQuantifications\(inputs\)/);
  assert.match(src,/summarizeSalmonGenes\(quant,tx2geneText\)/);
  assert.match(src,/crypto\.subtle\.digest/);
  assert.match(src,/not a DESeq2/);
  assert.doesNotMatch(src,/fetch\(|axios|supabase\.from\(/);
  assert.doesNotMatch(logic,/execSync|spawn\(|fetch\(|eval\(/);
});
