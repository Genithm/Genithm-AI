import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseComparisonIds, buildVerifiedComparison, verifiedComparisonTsv,
} from "../lib/verified-scientific-comparison.ts";
import { verifiedExplorerTsv } from "../lib/verified-explorer-export.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const shaA = "a".repeat(64);
const shaB = "b".repeat(64);

const protein = (length, aCount) => ({
  kind: "protein", length,
  composition: [{residue:"A",count:aCount},{residue:"C",count:length-aCount}],
  properties: [
    {label:"Molecular weight (Da)",value:1200.25},
    {label:"Aromaticity",value:0},
    {label:"GRAVY",value:-0.41},
    {label:"Estimated charge (pH 7)",value:-0.25},
    {label:"Estimated pI",value:5.2},
  ],
});
const run = (id, sha256, view, jobType="protein_properties") =>
  ({id,sha256,view,jobType,toolVersion:"genithm-1.0"});

test("V35 rejects duplicated, oversized or malformed comparison selectors", () => {
  assert.deepEqual(parseComparisonIds(a+","+b),[a,b]);
  assert.deepEqual(parseComparisonIds(a+","+b+","+c),[a,b,c]);
  assert.equal(parseComparisonIds(a+","+a),null);
  assert.equal(parseComparisonIds("bad,"+a),null);
  assert.equal(parseComparisonIds(a),null);
  assert.equal(parseComparisonIds(a+","+b+","+c+","+a),null);
  assert.equal(parseComparisonIds(undefined),null);
});

test("V35 compare protein residues and scientific model values from verified projections", () => {
  const model = buildVerifiedComparison([
    run(a,shaA,protein(10,7)), run(b,shaB,protein(20,5)),
  ]);
  assert.equal(model.kind,"protein_properties");
  assert.deepEqual(model.metrics.find(m=>m.key==="residue_A").values,[70,25]);
  assert.deepEqual(model.metrics.find(m=>m.key==="length").values,[10,20]);
  assert.deepEqual(model.metrics.find(m=>m.key==="gravy").values,[-0.41,-0.41]);
  assert.match(model.description,/model estimates/);
  const tsv=verifiedComparisonTsv(model);
  assert.match(tsv,/sha256-verified/);
  assert.ok(tsv.includes(shaA) && tsv.includes(shaB));
  assert.ok(tsv.includes(a) && tsv.includes(b));
  assert.match(tsv,/A residue frequency\t%\t70\t25/);
});

test("V35 pairwise comparison handles gap columns without claiming biological identity", () => {
  const pair = {kind:"pairwise",offset:0,total:10,a:"ACGT",b:"ATGT",markers:"|.||",match:7,mismatch:2,gaps:1};
  const comp = buildVerifiedComparison([
    run(a,shaA,pair,"pairwise_alignment"),
    run(b,shaB,{...pair,match:6,mismatch:3},"pairwise_alignment"),
  ]);
  assert.deepEqual(comp.metrics.find(m=>m.key==="match_fraction").values,[70,60]);
  assert.match(comp.description,/not evolutionary/);
});

test("V35 comparisons reject mismatched types, inconsistent counts and duplicate IDs", () => {
  assert.throws(()=>buildVerifiedComparison([run(a,shaA,protein(10,7)),run(a,shaB,protein(10,5))]),/distinct/);
  assert.throws(()=>buildVerifiedComparison([run(a,shaA,protein(10,7)),run(b,shaB,protein(20,5),"pairwise_alignment")]),/same type|alignment counts/);
  assert.throws(()=>buildVerifiedComparison([run(a,shaA,protein(10,11)),run(b,shaB,protein(20,5))]),/residue count|composition/);
  assert.throws(()=>buildVerifiedComparison([run(a,shaA,protein(10,7))]),/between two and four/);
  const bad={kind:"pairwise",offset:0,total:3,a:"AAA",b:"AAA",markers:"|||",match:4,mismatch:0,gaps:0};
  assert.throws(()=>buildVerifiedComparison([run(a,shaA,bad,"pairwise_alignment"),run(b,shaB,bad,"pairwise_alignment")]),/inconsistent/);
});

test("V35 single-run export includes only integrity-checked bounded viewer data", () => {
  const file = verifiedExplorerTsv({
    verification:"sha256-verified",sha256:shaA,jobType:"protein_properties",view:protein(10,7),
  });
  assert.match(file,/bounded, not full artifact/);
  assert.match(file,/Result SHA-256/);
  assert.ok(file.includes(shaA));
  assert.match(file,/Amino-acid count\tA\t7/);
  assert.throws(()=>verifiedExplorerTsv({
    verification:"pending",sha256:shaA,jobType:"protein_properties",view:protein(10,7),
  }),/integrity-checked/);
  assert.throws(()=>verifiedExplorerTsv({
    verification:"sha256-verified",sha256:shaA,jobType:"phylogenetic_tree",view:protein(10,7),
  }),/disagree/);
});

test("V35 exports alignment windows and phylogeny evidence without full artifacts", () => {
  const pair = verifiedExplorerTsv({verification:"sha256-verified",sha256:shaA,jobType:"pairwise_alignment",
    view:{kind:"pairwise",offset:96,total:1000,match:50,mismatch:41,gaps:5,a:"ATGC",b:"ATGG",markers:"|||."}});
  assert.match(pair,/Window start \(1-based\)\t97/);
  assert.match(pair,/Alignment viewport\tConcordance\t\|\|\|\./);
  const tree=verifiedExplorerTsv({verification:"sha256-verified",sha256:shaB,jobType:"phylogenetic_tree",
    view:{kind:"tree",model:"gtr_cat",leaves:2,nodes:[
      {id:0,parent:null,label:null,length:0,support:null},
      {id:1,parent:0,label:"seq1",length:0.1,support:null},
      {id:2,parent:0,label:"seq2",length:0.2,support:null},
    ]}});
  assert.match(tree,/Tree node\t1\tseq1/);
});

test("V35 is connected to real authenticated results and existing verified explorer", () => {
  const compare=read("../app/dashboard/results/compare/page.tsx");
  const viewer=read("../components/verified-comparison-viewer.tsx");
  const selector=read("../components/scientific-comparison-picker.tsx");
  const results=read("../app/dashboard/results/page.tsx");
  const explorer=read("../app/dashboard/scientific-jobs/[id]/scientific-result-explorer.tsx");
  assert.match(compare,/getClaims\(\)/);
  assert.match(compare,/\.eq\("requested_by", userId\)/);
  assert.match(compare,/parseComparisonIds\(/);
  assert.match(compare,/status === "completed"/);
  assert.match(viewer,/\/explore/);
  assert.match(viewer,/data\.verification !== "sha256-verified"/);
  assert.match(viewer,/data\.sha256 !== job\.sha256/);
  assert.match(viewer,/buildVerifiedComparison\(verified\)/);
  assert.match(viewer,/verifiedComparisonTsv\(comparison\)/);
  assert.match(selector,/selected\.length >= 2/);
  assert.match(results,/ScientificComparisonPicker choices=/);
  assert.match(explorer,/verifiedExplorerTsv\(payload\)/);
  assert.doesNotMatch(compare,/createServiceClient\s*\(|Math\.random/);
  assert.doesNotMatch(viewer,/fakeResult|mockResult|Math\.random/);
});
