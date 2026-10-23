import test from "node:test";
import assert from "node:assert/strict";
import { calculateGwas, gwasSummaryTsv, gwasManhattanOrder, MAX_GWAS_CELLS } from "../lib/gwas-association.ts";
const settings={traitKind:"quantitative",minMaf:0.01,maxMissing:0.05,noCovariateAcknowledged:true};
function fixture(n=100,format="matrix",binary=false,covars=true){
  const ids=Array.from({length:n},(_,i)=>`S${i+1}`);
  const g1=ids.map((_,i)=>(i*7+Math.floor(i/5))%3),g2=ids.map((_,i)=>(i*13+2)%3);
  const p=ids.map((id,i)=>`${id}\t${binary?Number(i%5===0||g1[i]===2): (2.7*g1[i]+(i%7)*0.6+Math.sin(i*1.8)).toFixed(5)}${covars?'\t'+(i%7):''}`);
  const phenotype=`sample_id\tphenotype${covars?'\tage':''}\n`+p.join("\n");
  const matrix=`CHR\tPOS\tSNP\t${ids.join("\t")}\n1\t100\trs1\t${g1.join("\t")}\n2\t200\trs2\t${g2.join("\t")}`;
  const vcf=`##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${ids.join("\t")}\n`+
    `1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t${g1.map(g=>g===0?'0/0':g===1?'0/1':'1/1').join("\t")}\n`+
    `2\t200\trs2\tC\tT\t.\tPASS\t.\tGT\t${g2.map(g=>g===0?'0/0':g===1?'0/1':'1/1').join("\t")}`;
  return {phenotype,genotypes:format==="vcf"?vcf:matrix};
}
test("quantitative GWAS computes real covariate-adjusted P and beta",()=>{
  const {genotypes,phenotype}=fixture();const r=calculateGwas(genotypes,phenotype,settings);
  assert.equal(r.mode,"dosage-matrix");assert.equal(r.variantsTested,2);assert.equal(r.samplesMatched,100);
  const lead=r.variants.find(v=>v.id==="rs1");assert.ok(lead);
  assert.ok(Math.abs(lead.beta-2.7)<0.15,JSON.stringify(lead));
  assert.ok(lead.p<1e-20,JSON.stringify(lead));
  assert.ok(lead.fdr<=lead.bonferroni);
});
test("same quantitative GWAS signals from standard diploid VCF genotype data",()=>{
  const m=fixture(),v=fixture(100,"vcf");
  const a=calculateGwas(m.genotypes,m.phenotype,settings),b=calculateGwas(v.genotypes,v.phenotype,settings);
  assert.equal(b.mode,"vcf-gt");assert.deepEqual(a.variants.map(x=>x.p),b.variants.map(x=>x.p));
});
test("case/control GWAS fits logistic null and performs covariate-adjusted score test",()=>{
  const {genotypes,phenotype}=fixture(100,"matrix",true);
  const r=calculateGwas(genotypes,phenotype,{...settings,traitKind:"binary"});
  assert.equal(r.variantsTested,2);assert.ok(r.variants.every(v=>v.method==="logistic-score"&&v.beta===null&&v.se===null));
  assert.ok(r.variants.find(v=>v.id==="rs1").p<.05,JSON.stringify(r.variants));
});
test("reject unacknowledged GWAS without covariates",()=>{
  const {genotypes,phenotype}=fixture(80,"matrix",false,false);
  assert.throws(()=>calculateGwas(genotypes,phenotype,{...settings,noCovariateAcknowledged:false}),/Explicitly acknowledge/);
});
test("reject sample ID duplication, mismatched cell count, invalid phenotype and dosage",()=>{
 const f=fixture(50);
 assert.throws(()=>calculateGwas(f.genotypes.replace('S1\tS2','S1\tS1'),f.phenotype,settings),/unique sample/);
 assert.throws(()=>calculateGwas(f.genotypes,f.phenotype.replace('S1\t','S2\t'),settings),/duplicated/);
 assert.throws(()=>calculateGwas(f.genotypes.replace('rs1\t','rs1\t3\t'),f.phenotype,settings),/wrong number/);
 assert.throws(()=>calculateGwas(f.genotypes.replace('rs1\t0','rs1\t4'),f.phenotype,settings),/between 0 and 2/);
 assert.throws(()=>calculateGwas(f.genotypes,f.phenotype,{...settings,traitKind:"binary"}),/must be 0/);
});
test("missing and rare variants are excluded, without inventing significance",()=>{
 const f=fixture(60);let cols=f.genotypes.split('\n');cols.push('3\t333\tmissing\t'+Array(60).fill('NA').join('\t'));
 const r=calculateGwas(cols.join('\n'),f.phenotype,settings);
 assert.equal(r.variantsSeen,3);assert.equal(r.excluded.missingness,1);assert.equal(r.variantsTested,2);
});
test("spreadsheet formula injection is escaped on export",()=>{
 const f=fixture(60);const r=calculateGwas(f.genotypes.replace('rs1\t','=HYPERLINK(1)\t'),f.phenotype,settings);
 const out=gwasSummaryTsv(r,'a'.repeat(64),'b'.repeat(64));
 assert.match(out,/\t'=HYPERLINK\(1\)\t/);
 assert.match(out,/genotype_sha256=/);
});
test("invalid files cannot silently be interpreted as GWAS",()=>{
 const f=fixture(50);
 assert.throws(()=>calculateGwas('FASTA\n>atgc',f.phenotype,settings),/dosage table/);
 assert.throws(()=>calculateGwas(f.genotypes,'not a phenotype table',settings),/20/);
});
