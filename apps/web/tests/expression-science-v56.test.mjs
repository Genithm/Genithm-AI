import test from "node:test";
import assert from "node:assert/strict";
import {analyzeExpression, expressionTsv, expressionGeneList} from "../lib/expression-analysis.ts";
import {benjaminiHochberg,studentTTwoSidedP} from "../lib/research-statistics.ts";

const sampleIds=Array.from({length:8},(_,i)=>`S${i+1}`);
const design=()=>"sample_id\tcondition\n"+sampleIds.map((id,i)=>`${id}\t${i<4?'control':'treated'}`).join("\n")+"\n";
function matrix({geneCount=80,scale=1}={}){
 const rows=["gene_id\t"+sampleIds.join("\t")];
 for(let gene=0;gene<geneCount;gene++){
  const vals=sampleIds.map((_,i)=>{
   const mean=100+(gene%11)*12;
   const variation=((gene*7+i*13)%17)-8;
   const signal=gene===0&&i>=4?450:0;
   const libraryBias=i%2===0?1.3:.9;
   return Math.max(1,Math.round((mean+variation+signal)*libraryBias*scale));
  });
  rows.push(`GENE${String(gene+1).padStart(4,'0')}\t${vals.join('\t')}`);
 }
 return rows.join("\n")+"\n";
}

test("V56 true count-matrix workflow returns tested P, FDR and donor-level sample QC",()=>{
 const r=analyzeExpression(matrix(),design(),{minCpm:1});
 assert.equal(r.schema,"genithm-expression/1");
 assert.equal(r.referenceGroup,"control");
 assert.equal(r.comparisonGroup,"treated");
 assert.equal(r.genesSeen,80);
 assert.equal(r.samplesMatched,8);
 assert.equal(r.samples.length,8);
 assert.ok(r.pcaFeatures>=20);
 assert.equal(r.genes.length,r.genesTested);
 assert.ok(r.genes.every(g=>g.p>0&&g.p<=1&&g.fdr>=g.p&&g.fdr<=1));
 assert.ok(r.samples.every(s=>Number.isFinite(s.sizeFactor)&&Number.isFinite(s.pc1)&&Number.isFinite(s.pc2)));
 const signal=r.genes.find(x=>x.geneId==='GENE0001');
 assert.ok(signal, 'planted gene should survive the QC');
 assert.ok(signal.log2FoldChange>1.2,`real normalized signal should be strong: ${signal.log2FoldChange}`);
 assert.ok(signal.p<.001,`actual Welch test must identify signal: ${signal.p}`);
 assert.ok(signal.fdr<.05,`BH must identify signal: ${signal.fdr}`);
 assert.match(r.warnings.join(' '),/not DESeq2/);
 const report=expressionTsv(r);
 assert.match(report,/welch_df/);
 assert.match(report,/GENE0001/);
 assert.match(expressionGeneList(r,true),/GENE0001/);
 assert.match(expressionGeneList(r,false),/GENE0079/);
});

test("V56 Welch P-values match high-precision reference tail across t and df",()=>{
 // Independent scipy.stats.t.sf reference values, computed on scientific fixtures.
 const cases=[[0,6,1],[1,6,.35591768374958205],[2,6,.09242631153167503],
  [4,8,.003949772803445322],[6.5,12,2.9365035686748113e-5],
  [0.9,2.2,.4555781778902538]];
 for(const [t,df,p] of cases){
  const actual=studentTTwoSidedP(t,df);
  assert.ok(Math.abs(actual-p)<1e-5,`${t} ${df}: ${actual} vs ${p}`);
 }
});

test("V56 BH is monotone by rank and uses all tested genes",()=>{
 const a=benjaminiHochberg([.01,.04,.03,.001,.9,1]);
 assert.deepEqual(a.map(x=>Number(x.toFixed(3))),[.03,.06,.06,.006,1,1]);
});

test("V56 expression normalization removes major sample-depth effect",()=>{
 const a=analyzeExpression(matrix(),design(),{minCpm:1});
 const scaled=matrix().split('\n').map((line,i)=>i===0||!line?line:line.split('\t').map((cell,j)=>j?String(Number(cell)*2):cell).join('\t')).join('\n');
 const b=analyzeExpression(scaled,design(),{minCpm:1});
 const signalA=a.genes.find(x=>x.geneId==='GENE0001');
 const signalB=b.genes.find(x=>x.geneId==='GENE0001');
 assert.ok(Math.abs(signalA.log2FoldChange-signalB.log2FoldChange)<1e-9);
 assert.ok(Math.abs(signalA.p-signalB.p)<1e-9);
});

test("V56 groups are matched by ID and cannot silently be re-assigned by row order",()=>{
 const lines=design().trim().split('\n');
 const reverse=lines[0]+'\n'+lines.slice(1).reverse().join('\n')+'\n';
 const a=analyzeExpression(matrix(),design(),{minCpm:1});
 const b=analyzeExpression(matrix(),reverse,{minCpm:1});
 for(const gene of a.genes){
  const other=b.genes.find(x=>x.geneId===gene.geneId);
  assert.ok(other);
  assert.ok(Math.abs(other.p-gene.p)<1e-12);
 }
});

test("V56 explicitly chosen reference reverses the effect direction",()=>{
 const a=analyzeExpression(matrix(),design(),{minCpm:1,referenceGroup:'control'});
 const b=analyzeExpression(matrix(),design(),{minCpm:1,referenceGroup:'treated'});
 const x=a.genes.find(x=>x.geneId==='GENE0001');
 const y=b.genes.find(x=>x.geneId==='GENE0001');
 assert.ok(Math.abs(x.log2FoldChange+y.log2FoldChange)<1e-10);
 assert.ok(Math.abs(x.p-y.p)<1e-12);
});

test("V56 rejects absent/mismatched/duplicate sample IDs and invalid design",()=>{
 const m=matrix();
 assert.throws(()=>analyzeExpression(m,design().replace('S8\ttreated','S9\ttreated')),/Every count-matrix sample/);
 assert.throws(()=>analyzeExpression(m,design().replace('S8\ttreated','S1\ttreated')),/Duplicate design sample/);
 assert.throws(()=>analyzeExpression(m,design().replace('S7\ttreated','S7\tcontrol').replace('S8\ttreated','S8\tcontrol')),/at least three/);
 assert.throws(()=>analyzeExpression(m,design().replace('sample_id\tcondition','sample_id\tcondition\tbatch')),/exactly sample_id and condition/);
 assert.throws(()=>analyzeExpression(m,design(),{minCpm:101}),/minCpm/);
 assert.throws(()=>analyzeExpression(m,design(),{minCpm:1,referenceGroup:'invented'}),/Reference group/);
});

test("V56 rejects normalized, negative, missing, duplicated or malformed raw counts",()=>{
 const m=matrix();
 assert.throws(()=>analyzeExpression(m.replace(/\t\d+\t/, '\t-10\t'),design()),/nonnegative integer/);
 assert.throws(()=>analyzeExpression(m.replace(/\t\d+\t/, '\tNA\t'),design()),/nonnegative integer/);
 assert.throws(()=>analyzeExpression(m.replace(/\t\d+\t/, '\t2.2\t'),design()),/nonnegative integer/);
 assert.throws(()=>analyzeExpression(m+'\n'+m.split('\n')[1],design()),/Duplicate gene/);
 assert.throws(()=>analyzeExpression(m.replace('GENE0001','\'=CALC'),design()),/gene_id/);
 assert.throws(()=>analyzeExpression(m.replace('GENE0001','GENE0001\tEXTRA'),design()),/exactly 8 counts/);
});

test("V56 input limits and degenerate counts fail closed",()=>{
 const m=matrix();
 assert.throws(()=>analyzeExpression(m.repeat(20000),design()),/size limit|gene rows/);
 assert.throws(()=>analyzeExpression('gene_id\t'+sampleIds.join('\t')+'\nGENE1\t'+Array(8).fill(2).join('\t'),design()),/gene rows/);
 const uniform=['gene_id\t'+sampleIds.join('\t'),...Array.from({length:20},(_,i)=>'G'+(i+1)+'\t'+Array(8).fill(100).join('\t'))].join('\n');
 assert.throws(()=>analyzeExpression(uniform,design(),{minCpm:1}),/No genes survived/);
 const csv=analyzeExpression(m.replace(/\t/g,','),design(),{minCpm:1});
 assert.ok(csv.genes.some(g=>g.geneId==='GENE0001'));
});

test("V56 local gene exports are headed and use explicit comparison direction",()=>{
 const r=analyzeExpression(matrix(),design(),{minCpm:1});
 const genes=expressionGeneList(r,true).split('\n').filter(Boolean);
 assert.equal(genes[0],'gene_id');
 assert.ok(genes.includes('GENE0001'));
 assert.ok(r.method.includes('Welch'));
 assert.equal(r.genesTested+r.excluded.low_expression+r.excluded.zero_variance,r.genesSeen);
});
