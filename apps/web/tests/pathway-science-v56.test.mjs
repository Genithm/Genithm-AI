import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePathways,geneList,hypergeometricUpperTail,pathwaysTsv} from '../lib/pathway-enrichment.ts';

const background=()=>Array.from({length:100},(_,i)=>`G${i+1}`).join('\n')+'\n';
const selected=()=>['G1','G2','G3','G4','G5'].join('\n')+'\n';
const gmt=()=>[
 'HIT\tMy synthetic pathway\tG1\tG2\tG3\tG6\tG7\tG8\tG9\tG10',
 'NOHIT\tZero overlap\tG20\tG21\tG22\tG23',
 'SOME\tLow overlap\tG4\tG16\tG17\tG18\tG19',
 'OUTSIDE\tMissing from universe\tX1\tX2\tX3',
].join('\n')+'\n';

test('V56 actual gene-set ORA returns hypergeometric p, overlap, and BH over zero-hit sets',()=>{
 const r=analyzePathways(selected(),background(),gmt());
 assert.equal(r.schema,'genithm-pathway-ora/1');
 assert.equal(r.universeGenes,100);
 assert.equal(r.inputSelectedGenes,5);
 assert.equal(r.eligibleSetsTested,3);
 assert.equal(r.excludedSets.not_in_universe,1);
 const hit=r.pathways.find(x=>x.name==='HIT');
 assert.equal(hit.overlap,3);assert.equal(hit.setSize,8);
 assert.ok(hit.p<.005, `p-value should be < 0.005: ${hit.p}`);
 assert.ok(hit.fdr<.05);
 assert.deepEqual(hit.overlapGenes,['G1','G2','G3']);
 const zero=r.pathways.find(x=>x.name==='NOHIT');
 assert.equal(zero.p,1);assert.equal(zero.fdr,1);
 assert.match(pathwaysTsv(r),/padj_BH/);
 assert.match(pathwaysTsv(r),/G1;G2;G3/);
 assert.ok(r.method.includes('ALL eligible'));
});

test('V56 hypergeometric tail matches scipy.stats.hypergeom.sf across independent fixtures',()=>{
 // calculated using scipy.stats.hypergeom.sf(k - 1, N, K, n)
 const fixtures=[[20,5,4,3,.03199174406604747],[100,8,5,3,.0031998928906145406],
   [150,16,14,6,.0010208218908160235],[1000,50,30,6,.0027259012375460824],
   [40,7,10,0,1]];
 for(const [N,K,n,k,p] of fixtures){
  const actual=hypergeometricUpperTail(N,K,n,k);
  assert.ok(Math.abs(actual-p)<1e-5, `${N} ${K} ${n} ${k}: ${actual} vs ${p}`);
 }
});

test('V56 explicit gene universe changes enrichment and prevents assumed genome-wide background',()=>{
 const a=hypergeometricUpperTail(100,8,5,3);
 const b=hypergeometricUpperTail(1000,8,5,3);
 assert.ok(b<a);
 assert.throws(()=>analyzePathways('G101\n',background(),gmt()),/absent from the measured background/);
});

test('V56 input validation prevents duplicate selected IDs and malformed GMT',()=>{
 assert.throws(()=>analyzePathways('G1\nG1\n',background(),gmt()),/duplicate/);
 assert.throws(()=>analyzePathways(selected(),background(),'HIT\tthis is not a set'),/GMT line/);
 assert.throws(()=>analyzePathways(selected(),background(),gmt().replace('G2\tG3','G2\tG2')),/repeated gene/);
 assert.throws(()=>analyzePathways(selected(),background(),gmt()+'HIT\tdup\tG70\tG71\tG72\n'),/Duplicate GMT/);
 assert.throws(()=>analyzePathways(selected(),background(),gmt().replace('G6','\'=DANGER')),/invalid or repeated/);
});

test('V56 filters absent and undersized gene sets without pretending successful analysis',()=>{
 assert.throws(()=>analyzePathways(selected(),background(),'ONLY\tx\tX1\tX2\tX3\n'),/No gene sets overlap/);
 const r=analyzePathways(selected(),background(),'SMALL\tx\tG1\tG2\nGOOD\tx\tG1\tG2\tG3\n');
 assert.equal(r.excludedSets.too_small,1);
 assert.equal(r.eligibleSetsTested,1);
});

test('V56 valid selected IDs may come from expression gene-list exports with header',()=>{
 const r=analyzePathways('gene_id\nG1\nG3\nG5\n', 'gene_id\n'+background(),gmt());
 assert.equal(r.inputSelectedGenes,3);
 assert.ok(r.pathways.every(x=>Number.isFinite(x.p)&&x.fdr>=x.p));
});

test('V56 rejects misleading metadata and invalid probabilities',()=>{
 assert.throws(()=>geneList('G1\t2\n','ids'),/invalid gene ID/);
 assert.throws(()=>hypergeometricUpperTail(20,4,5,6),/Invalid population/);
 assert.throws(()=>hypergeometricUpperTail(20.5,4,5,2),/integers/);
});
