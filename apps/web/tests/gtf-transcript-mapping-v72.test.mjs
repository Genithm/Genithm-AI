import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {deriveTx2GeneFromGtf,GtfMappingError,MAX_GTF_BYTES} from '../lib/gtf-transcript-mapping-v72.ts';
import {inspectSalmonQuantifications} from '../lib/salmon-quant-matrix.ts';
import {summarizeSalmonGenes} from '../lib/salmon-gene-summary-v71.ts';
const dir=dirname(fileURLToPath(import.meta.url));
const fixture=(name)=>readFileSync(resolve(dir,'fixtures/',name),'utf8');
const gtf=()=>fixture('v72/mapped-annotation.gtf');
const checked=()=>inspectSalmonQuantifications([
  {sample:'CTRL1',text:fixture('v71/CTRL1.quant.sf')},
  {sample:'TREAT1',text:fixture('v71/TREAT1.quant.sf')}]);
const line=(attrs='gene_id "GENE_A"; transcript_id "TX001";',strand='+',start=1,end=100)=>
  ['chr1','synthetic','transcript',start,end,'.',strand,'.',attrs].join('\t')+'\n';
const mustFail=(code,fn)=>assert.throws(fn,x=>x instanceof GtfMappingError&&x.code===code);

test('V72 real GTF features produce exact version-matching transcript-to-gene TSV',()=>{
  const actual=deriveTx2GeneFromGtf(gtf());
  assert.equal(actual.schema,'genithm-gtf-transcript-map/1');
  assert.equal(actual.status,'structural_gtf_mapping_only');
  assert.equal(actual.source_feature_rows,8);
  assert.equal(actual.transcript_features,3);
  assert.equal(actual.exon_features,2);
  assert.equal(actual.cds_features,1);
  assert.equal(actual.transcript_ids,3);
  assert.equal(actual.gene_ids,2);
  assert.equal(actual.multi_transcript_genes,1);
  assert.equal(actual.contigs_seen,2);
  assert.equal(actual.transcript_to_gene_tsv,'transcript_id\tgene_id\nTX001\tGENE_A\nTX002\tGENE_B\nTX003\tGENE_A\n');
  assert.equal(actual.assembly_verified,false);
  assert.equal(actual.salmon_index_verified,false);
  assert.doesNotMatch(actual.transcript_to_gene_tsv,/secret|chr1|synthetic/);
});

test('V72 generated GTF mapping actually drives measured V71 Salmon gene sums',()=>{
  const ref=deriveTx2GeneFromGtf(gtf());
  const actual=summarizeSalmonGenes(checked(),ref.transcript_to_gene_tsv);
  assert.match(actual.gene_tpm_tsv,/GENE_A\t750000\t200000/);
  assert.match(actual.gene_tpm_tsv,/GENE_B\t250000\t800000/);
  assert.equal(actual.mapping_rows_not_quantified,0);
  assert.equal(actual.tximport_equivalent,false);
  assert.equal(actual.gene_level_differential_expression_performed,false);
});

test('V72 accepts standard CRLF/BOM, exon-only GTF and escaped free text without leaking names',()=>{
  const text='\uFEFF'+gtf().replaceAll('\n','\r\n');
  assert.equal(deriveTx2GeneFromGtf(text).transcript_ids,3);
  const exon=['chr1','synthetic','exon','1','100','.','+','.','gene_id "GENE_A"; transcript_id "TX001"; gene_name "secret; \\"private\\"";'].join('\t')+'\n';
  const derived=deriveTx2GeneFromGtf(exon);
  assert.equal(derived.transcript_features,0);
  assert.equal(derived.exon_features,1);
  assert.equal(derived.transcript_to_gene_tsv,'transcript_id\tgene_id\nTX001\tGENE_A\n');
  assert.doesNotMatch(JSON.stringify(derived),/secret|private/);
});

test('V72 independently checks all transcript-to-gene conflicts and locus inconsistencies',()=>{
  mustFail('ambiguous',()=>deriveTx2GeneFromGtf(line()+line('gene_id "GENE_B"; transcript_id "TX001";')));
  mustFail('ambiguous',()=>deriveTx2GeneFromGtf(line()+line(undefined,'-')));
  mustFail('ambiguous',()=>deriveTx2GeneFromGtf(line()+line('gene_id "GENE_A"; gene_id "GENE_B"; transcript_id "TX001";')));
  mustFail('ambiguous',()=>deriveTx2GeneFromGtf(line()+line('gene_id "GENE_A"; transcript_id "TX001";').replace('chr1','chr3')));
});

test('V72 rejects wrong GTF format, bad columns, invalid one-based coordinates and score',()=>{
  mustFail('empty',()=>deriveTx2GeneFromGtf(''));
  mustFail('empty',()=>deriveTx2GeneFromGtf('#header only\n'));
  mustFail('columns',()=>deriveTx2GeneFromGtf('chr1\tgene\t1\t100\n'));
  mustFail('feature',()=>deriveTx2GeneFromGtf(line(undefined,'+',0,100)));
  mustFail('feature',()=>deriveTx2GeneFromGtf(line(undefined,'!',1,100)));
  mustFail('score',()=>deriveTx2GeneFromGtf(line().replace('\t.\t+\t.\t','\tNaN\t+\t.\t')));
  mustFail('coordinates',()=>deriveTx2GeneFromGtf(line(undefined,'+',101,100)));
  mustFail('coordinates',()=>deriveTx2GeneFromGtf(line(undefined,'+',1,Number.MAX_SAFE_INTEGER+1)));
});

test('V72 rejects hostile/missing GTF attributes, duplicated keys and control chars',()=>{
  for(const attrs of [
    'gene_id GENEA; transcript_id "TX001";',
    'gene_id "GENE_A" transcript_id "TX001";',
    'gene_id "GENE_A"; transcript_id "TX001;',
    'gene_id "=PAYLOAD"; transcript_id "TX001";',
    'transcript_id "TX001";',
    'gene_id "GENE_A"; gene_id "GENE_B"; transcript_id "TX001";'
  ]){
    assert.throws(()=>deriveTx2GeneFromGtf(line(attrs)));
  }
  mustFail('control',()=>deriveTx2GeneFromGtf(line().replace('synthetic','syn\u0000thetic')));
  mustFail('size',()=>deriveTx2GeneFromGtf('x'.repeat(MAX_GTF_BYTES+1)));
});

test('V72 never assumes source annotation and actual Salmon transcriptome are identical',()=>{
  const wrong=deriveTx2GeneFromGtf(line('gene_id "GENE_A"; transcript_id "TX_NONE";'));
  assert.equal(wrong.salmon_index_verified,false);
  assert.throws(()=>summarizeSalmonGenes(checked(),wrong.transcript_to_gene_tsv),/exact gene mapping/);
});
