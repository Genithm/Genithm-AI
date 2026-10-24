import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('V64 universal data page presents real VCF site QC and no genotype capability claim',()=>{
 const panel=read('../app/dashboard/data/large-data-panel.tsx');
 const library=read('../app/dashboard/data/universal-file-panel.tsx');
 assert.match(panel,/genithm-vcf-site-qc\/1/);
 assert.match(panel,/Whole-file VCF QC/);
 assert.match(panel,/genotypes not analyzed/);
 assert.match(panel,/quality-report.*tsv/);
 assert.match(library,/Complete VCF site QC/);
 assert.match(library,/Genotypes, allele frequencies and pathogenicity were not analyzed/);
 assert.match(library,/Preserve bytes only; do not parse FASTA, FASTQ or VCF/);
});