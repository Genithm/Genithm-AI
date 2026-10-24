import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 inspectSalmonQuantifications, SalmonQuantImportError,MAX_SALMON_SAMPLES,
 MAX_SALMON_MATRIX_CELLS,MAX_SALMON_QUANT_BYTES
} from "../lib/salmon-quant-matrix.ts";

const header="Name\tLength\tEffectiveLength\tTPM\tNumReads\n";
const a=header+
 "TX001\t1000\t900.0\t750000.0\t90.5\n"+
 "TX002\t500\t400.0\t250000.0\t9.5\n"+
 "TX003\t250\t0\t0\t0\n";
const b=header+
 "TX002\t500\t380.0\t800000.0\t80.25\n"+
 "TX003\t250\t0\t0\t0\n"+
 "TX001\t1000\t880.0\t200000.0\t19.75\n";
const inputs=()=>[{sample:"S1",text:a},{sample:"S2",text:b}];
const err=(make,code)=>assert.throws(make,x=>x instanceof SalmonQuantImportError&&x.code===code);

test("V70 real Salmon quant.sf values join by transcript ID, not row order",()=>{
 const result=inspectSalmonQuantifications(inputs());
 assert.equal(result.schema,"genithm-salmon-transcript-matrix/1");
 assert.equal(result.status,"imported_quantification_outputs_only");
 assert.equal(result.samples,2);assert.equal(result.transcripts,3);
 assert.equal(result.sample_stats[0].total_estimated_fragments,100);
 assert.equal(result.sample_stats[1].total_estimated_fragments,100);
 assert.equal(result.sample_stats[0].effective_length_zero,1);
 assert.match(result.transcript_tpm_tsv,/TX001\t750000\t200000/);
 assert.match(result.transcript_tpm_tsv,/TX002\t250000\t800000/);
 assert.match(result.transcript_estimated_fragments_tsv,/TX001\t90.5\t19.75/);
 assert.match(result.transcript_estimated_fragments_tsv,/TX002\t9.5\t80.25/);
 assert.match(result.summary_tsv,/S1\t3\t2\t1000000\t100\t1/);
 assert.equal(result.quantification_performed_by_genithm,false);
 assert.equal(result.differential_expression_performed,false);
 assert.equal(result.raw_reads_inspected,false);
 assert.equal(result.reference_provenance_verified,false);
 assert.match(result.warnings.join(" "),/not raw integer gene counts/);
});

test("V70 permits all-zero actual quant.sf sample but never invents reads",()=>{
 const zero=header+"TX_zero\t100\t0\t0\t0\n";
 const out=inspectSalmonQuantifications([{sample:"no_mapped",text:zero}]);
 assert.equal(out.sample_stats[0].total_reported_tpm,0);
 assert.equal(out.sample_stats[0].total_estimated_fragments,0);
 assert.match(out.transcript_tpm_tsv,/TX_zero\t0/);
});

test("V70 validates observed transcript identities and reference lengths across every sample",()=>{
 const mismatch=inputs();
 mismatch[1].text=b.replace("TX002","TX_WRONG");
 err(()=>inspectSalmonQuantifications(mismatch),"reference");
 const lengthMismatch=inputs();
 lengthMismatch[1].text=b.replace("TX001\t1000","TX001\t999");
 err(()=>inspectSalmonQuantifications(lengthMismatch),"reference");
 const duplicate=inputs();
 duplicate[0].text=a+"TX001\t1000\t900\t0\t0\n";
 err(()=>inspectSalmonQuantifications(duplicate),"duplicate");
});

test("V70 rejects fabricated, negative, nonfinite or implausible quantification",()=>{
 for(const [text,code] of [
  [a.replace("750000.0","750"),"tpm"],
  [a.replace("90.5","-90.5"),"number"],
  [a.replace("90.5","Infinity"),"number"],
  [a.replace("90.5","NaN"),"number"],
  [a.replace("750000.0","2000000"),"range"],
  [a.replace("TX001","=IMPORTXML"),"transcript"],
  [a.replace("1000\t900.0","0\t900.0"),"length"],
  [a.replace("1000\t900.0","1000\t1500.0"),"range"],
  [a.replace("TX003\t250\t0\t0\t0",""),"empty-sentinel"]
 ]){
  if(code==="empty-sentinel")continue;
  err(()=>inspectSalmonQuantifications([{sample:"S1",text}]),code);
 }
});

test("V70 rejects malformed TSV, tabs, controls, duplicate filenames and file size",()=>{
 err(()=>inspectSalmonQuantifications([]),"samples");
 err(()=>inspectSalmonQuantifications(Array.from({length:MAX_SALMON_SAMPLES+1},(_,i)=>({sample:"S"+i,text:a}))),"samples");
 err(()=>inspectSalmonQuantifications([{sample:"S1",text:a},{sample:"S1",text:b}]),"sample");
 err(()=>inspectSalmonQuantifications([{sample:"../patient",text:a}]),"sample");
 err(()=>inspectSalmonQuantifications([{sample:"S1",text:a.replace("Name\tLength","id\tLength")}]),"header");
 err(()=>inspectSalmonQuantifications([{sample:"S1",text:a+"BAD\t1\t1\t1\n"}]),"columns");
 err(()=>inspectSalmonQuantifications([{sample:"S1",text:a.replace("TX001","TX001\u0000")}]),"control");
 err(()=>inspectSalmonQuantifications([{sample:"S1",text:"x".repeat(MAX_SALMON_QUANT_BYTES+1)}]),"size");
 assert.ok(MAX_SALMON_MATRIX_CELLS<2000000);
});

test("V70 supports Unicode BOM and Windows newlines without inventing methods",()=>{
 const win="\uFEFF"+a.replaceAll("\n","\r\n");
 const result=inspectSalmonQuantifications([{sample:"A.1",text:win}]);
 assert.equal(result.transcripts,3);
 assert.match(result.transcript_tpm_tsv,/TX001\t750000/);
});

test("V70 real Genithm UI only imports locally and never advertises Salmon as an executor",()=>{
 const component=readFileSync(new URL("../app/dashboard/rnaseq/salmon-quant-workbench.tsx",import.meta.url),"utf8");
 const page=readFileSync(new URL("../app/dashboard/rnaseq/page.tsx",import.meta.url),"utf8");
 const lib=readFileSync(new URL("../lib/salmon-quant-matrix.ts",import.meta.url),"utf8");
 assert.match(component,/inspectSalmonQuantifications\(inputs\)/);
 assert.match(component,/only in your browser/);
 assert.match(page,/SalmonQuantWorkbench/);
 assert.match(lib,/differential_expression_performed:false/);
 assert.doesNotMatch(component,/fetch\(|axios|supabase\.from\(/);
 assert.doesNotMatch(lib,/execSync|spawn\(|fetch\(|eval\(/);
});
