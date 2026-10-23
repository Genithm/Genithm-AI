"use client";

import {useEffect,useRef,useState} from "react";
import {GWAS_ENGINE_VERSION,gwasSummaryTsv,gwasManhattanOrder,MAX_GWAS_GENOTYPE_BYTES,
  type GwasResult,type GwasSettings,type GwasVariant,type TraitKind} from "@/lib/gwas-association";
import styles from "./gwas.module.css";

type Evidence = {result:GwasResult;genotypeSha256:string;phenotypeSha256:string};
function download(content:string,name:string){
  const url=URL.createObjectURL(new Blob([content],{type:"text/tab-separated-values;charset=utf-8"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function number(n:number){return Number.isFinite(n)?n.toLocaleString("en-US"):"NA";}
function pLabel(p:number){return p<.0001?p.toExponential(2):p.toFixed(5);}
function GwasCharts({result}:{result:GwasResult}){
  const all=result.variants.slice().sort(gwasManhattanOrder);
  const strong=new Set(all.slice().sort((a,b)=>a.p-b.p).slice(0,300).filter(v=>v.p<5e-8));
  const sampled=all.length<=2400?all:all.filter((v,i)=>i%Math.ceil(all.length/2100)===0 || strong.has(v));
  const chr=Array.from(new Set(all.map(v=>v.chrom)));
  const offsets=new Map<string,{start:number;end:number}>();let current=0;
  for(const chromosome of chr){const variants=all.filter(v=>v.chrom===chromosome);const end=Math.max(...variants.map(v=>v.pos));
    offsets.set(chromosome,{start:current,end:current+end});current+=end+Math.max(1,Math.round(end*.04));}
  const width=840,height=300,left=45,top=15,plotHeight=height-52,plotWidth=width-left-15;
  const maxY=Math.max(8,Math.min(60,Math.ceil(Math.max(...all.map(v=>-Math.log10(v.p)))+1)));
  const dx=(v:GwasVariant)=>left+(offsets.get(v.chrom)!.start+v.pos)/current*plotWidth;
  const dy=(p:number)=>top+plotHeight-Math.min(maxY,-Math.log10(p))/maxY*plotHeight;
  const ordered=all.slice().sort((a,b)=>a.p-b.p);
  const qq=ordered.length<=500?ordered:ordered.filter((_,i)=>i%Math.ceil(ordered.length/450)===0||i<50);
  const qqMax=Math.max(2,Math.min(60,Math.ceil(Math.max(...qq.map(v=>-Math.log10(v.p)))+1)));
  return <div className={styles.charts}>
    <figure className={styles.chart}><figcaption>Manhattan plot — actual tested variants</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Genome-wide variant positions versus observed minus log10 association p values">
        <rect x={left} y={top} width={plotWidth} height={plotHeight} fill="#f7fbff"/>
        <line x1={left} y1={dy(5e-8)} x2={left+plotWidth} y2={dy(5e-8)} stroke="#c45b66" strokeDasharray="6 4"/>
        {sampled.map((v,i)=><circle key={i} cx={dx(v)} cy={dy(v.p)} r={v.bonferroni<.05?2.7:1.75}
          fill={v.bonferroni<.05?"#d34f66":chr.indexOf(v.chrom)%2?"#118d9a":"#3268b2"}/>) }
        {chr.map(c=><text key={c} x={left+(offsets.get(c)!.start+offsets.get(c)!.end)/2/current*plotWidth} y={height-19}
          textAnchor="middle" fontSize="11" fill="#54677f">{c}</text>)}
        <text x="11" y="20" fontSize="10" fill="#54677f">-log₁₀ P</text>
        <text x={left} y={height-3} fontSize="10" fill="#54677f">Chromosome · dashed line: P = 5 × 10⁻⁸</text>
      </svg><p>{sampled.length.toLocaleString()} displayed of {all.length.toLocaleString()} tested variants. Dense inputs are downsampled, retaining up to 300 strongest conventionally significant hits; the export contains every tested row.</p>
    </figure>
    <figure className={styles.chart}><figcaption>Q–Q plot — observed vs expected P-values</figcaption>
      <svg viewBox="0 0 400 300" role="img" aria-label="Quantile quantile plot of association p values">
        <rect x="43" y="14" width="338" height="246" fill="#f7fbff"/>
        <line x1="43" y1="260" x2="381" y2="14" stroke="#b36c75" strokeDasharray="6 4"/>
        {qq.map((v,i)=>{const rank=ordered.indexOf(v)+1;const expected=-Math.log10((rank-.5)/ordered.length);
          return <circle key={i} cx={43+Math.min(1,expected/qqMax)*338} cy={260-Math.min(1,-Math.log10(v.p)/qqMax)*246} r="2" fill="#1b75af"/>;})}
        <text x="16" y="18" fontSize="10" fill="#54677f">Observed</text>
        <text x="155" y="287" fontSize="11" fill="#54677f">Expected −log₁₀ P</text>
      </svg><p>Large deviations can reflect true associations or confounding. Confirm ancestry, relatedness, genomic inflation, sample and variant QC separately.</p>
    </figure>
  </div>;
}
function examples(){
  const ids=Array.from({length:100},(_,i)=>`S${String(i+1).padStart(3,"0")}`);
  const trait=ids.map((id,i)=>{const g=(i*7+Math.floor(i/5))%3;
    return `${id}\t${(1.9*g+.35*(i%7)+Math.sin(i*1.7)).toFixed(5)}\t${i%7}\t${i%3}`;});
  const variant=(chrom:string,pos:number,id:string,fn:(i:number)=>number)=>
    `${chrom}\t${pos}\t${id}\t${ids.map((_,i)=>fn(i)).join("\t")}`;
  const gt=[`CHR\tPOS\tSNP\t${ids.join("\t")}`,variant("1",100,"synthetic_signal",i=>(i*7+Math.floor(i/5))%3),
    variant("2",200,"synthetic_null",i=>(i*11+1)%3),variant("3",300,"synthetic_null2",i=>(i*17+2)%3)];
  download(`sample_id\tphenotype\tPC1\tPC2\n${trait.join("\n")}\n`,"genithm-SYNTHETIC-gwas-phenotypes.tsv");
  download(gt.join("\n")+"\n","genithm-SYNTHETIC-gwas-genotypes.tsv");
}
export function GwasWorkbench(){
  const [genotypes,setGenotypes]=useState<File|null>(null),[phenotypes,setPhenotypes]=useState<File|null>(null);
  const [trait,setTrait]=useState<TraitKind>("quantitative"),[maf,setMaf]=useState(.01),[missing,setMissing]=useState(.05);
  const [noCovars,setNoCovars]=useState(false),[running,setRunning]=useState(false),[status,setStatus]=useState("");
  const [error,setError]=useState(""),[evidence,setEvidence]=useState<Evidence|null>(null);
  const worker=useRef<Worker|null>(null);
  useEffect(()=>()=>{worker.current?.terminate();worker.current=null;},[]);
  function cancel(){worker.current?.terminate();worker.current=null;setRunning(false);setStatus("Analysis cancelled; no findings were saved.");}
  function analyze(){
    if(running||!genotypes||!phenotypes)return;
    if(genotypes.size>MAX_GWAS_GENOTYPE_BYTES||phenotypes.size>2*1024*1024||genotypes.size===0||phenotypes.size===0){
      setError("Uncompressed genotype file must be ≤64 MiB; phenotype file ≤2 MiB.");return;
    }
    setEvidence(null);setError("");setRunning(true);setStatus("Reading and validating local genotype/phenotype data…");
    const settings:GwasSettings={traitKind:trait,minMaf:maf,maxMissing:missing,noCovariateAcknowledged:noCovars};
    const next=new Worker(new URL("./gwas.worker.ts",import.meta.url));worker.current=next;
    next.onmessage=(ev:MessageEvent<({kind:"progress";count:number}|{kind:"complete"}&Evidence|{kind:"error";message:string})>)=>{
      const value=ev.data;
      if(value.kind==="progress")setStatus(`${number(value.count)} variant rows inspected on this device…`);
      else if(value.kind==="complete"){
        setEvidence({result:value.result,genotypeSha256:value.genotypeSha256,phenotypeSha256:value.phenotypeSha256});
        setStatus("Association models, QC and multiple-testing corrections completed locally.");setRunning(false);next.terminate();worker.current=null;
      }else{setError(value.message);setStatus("");setRunning(false);next.terminate();worker.current=null;}
    };
    next.onerror=()=>{setError("Local GWAS worker failed; no results were recorded.");setRunning(false);next.terminate();worker.current=null;};
    next.postMessage({genotypes,phenotypes,settings});
  }
  const lead=evidence?.result.variants.slice().sort((a,b)=>a.p-b.p).slice(0,12)??[];
  return <div className={styles.workbench}>
    <section className={styles.panel} aria-label="Local GWAS input files">
      <div className={styles.panelHeading}><span className={styles.eyebrow}>STEP 1 · GENOTYPES + PHENOTYPES</span><h2>Prepare your association study</h2>
        <p>Use a multi-sample, uncompressed VCF v4 with diploid biallelic <code>GT</code> fields, or a variant-major CSV/TSV dosage matrix with <code>CHR POS SNP sample columns</code>. Supply a second CSV/TSV with <code>sample_id phenotype</code> and optional numeric columns such as ancestry PCs, age or sex. Samples are matched by exact ID.</p></div>
      <div className={styles.inputs}><label>Genotypes (.vcf, .tsv, .csv)<input type="file" accept=".vcf,.tsv,.csv,.txt" disabled={running} onChange={e=>{setGenotypes(e.currentTarget.files?.[0]??null);setEvidence(null);}}/></label>
        <label>Phenotype and covariates (.tsv, .csv)<input type="file" accept=".tsv,.csv,.txt" disabled={running} onChange={e=>{setPhenotypes(e.currentTarget.files?.[0]??null);setEvidence(null);}}/></label></div>
      <div className={styles.settings}><label>Trait type<select value={trait} disabled={running} onChange={e=>{setTrait(e.target.value as TraitKind);setEvidence(null);}}><option value="quantitative">Quantitative (linear regression)</option><option value="binary">Binary 0/1 (logistic score test)</option></select></label>
        <label>Minimum minor-allele frequency<select value={maf} disabled={running} onChange={e=>{setMaf(Number(e.target.value));setEvidence(null);}}><option value="0.01">1%</option><option value="0.05">5%</option><option value="0.1">10%</option></select></label>
        <label>Maximum missing genotype rate<select value={missing} disabled={running} onChange={e=>{setMissing(Number(e.target.value));setEvidence(null);}}><option value="0.01">1%</option><option value="0.05">5%</option><option value="0.1">10%</option></select></label></div>
      <label className={styles.checkbox}><input type="checkbox" checked={noCovars} disabled={running} onChange={e=>{setNoCovars(e.target.checked);setEvidence(null);}}/> I understand running without ancestry PCs/covariates risks confounded associations; permit an unadjusted exploratory run if my phenotype file has no covariate columns.</label>
      <div className={styles.actions}><button className={styles.primary} onClick={analyze} disabled={!genotypes||!phenotypes||running}>Analyze selected real data</button>
        {running?<button className={styles.secondary} type="button" onClick={cancel}>Stop analysis</button>:null}
        <button className={styles.secondary} type="button" onClick={examples} disabled={running}>↓ Download clearly labeled synthetic practice files</button></div>
      {status?<p className={styles.status} role="status">{status}</p>:null}
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      <p className={styles.footnote}>Local limits: 64 MiB input, 2 MiB phenotype, 2,000 sample columns, 50,000 variants and 12 million genotype cells. Full biobank-scale GWAS, imputation, family structure, mixed models and PLINK binary files require separate validated compute infrastructure. Neither file leaves your browser.</p>
    </section>
    {evidence?<><section className={styles.panel} aria-label="Actual association results">
      <div className={styles.panelHeading}><span className={styles.eyebrow}>STEP 2 · REAL STATISTICS</span><h2>GWAS association results</h2>
        <p>{evidence.result.associationMethod} · {evidence.result.covariates.length?"Covariates: "+evidence.result.covariates.join(", "):"Unadjusted exploratory model"}</p></div>
      <div className={styles.metrics}><article><small>Matched samples</small><strong>{number(evidence.result.samplesMatched)}</strong></article>
        <article><small>Variants tested</small><strong>{number(evidence.result.variantsTested)}</strong></article>
        <article><small>Variants excluded</small><strong>{number(evidence.result.variantsSeen-evidence.result.variantsTested)}</strong></article>
        <article><small>Bonferroni P &lt; .05</small><strong>{number(evidence.result.significantBonferroni)}</strong></article></div>
      <GwasCharts result={evidence.result}/>
      <div className={styles.tableWrap}><table><caption>Most significant tested variants — exploratory estimates</caption><thead><tr><th>CHR</th><th>Position</th><th>ID</th><th>MAF</th><th>N</th><th>P</th><th>Bonferroni P</th><th>BH FDR</th></tr></thead>
        <tbody>{lead.map(v=><tr key={`${v.chrom}:${v.pos}:${v.id}`}><td>{v.chrom}</td><td>{v.pos}</td><td>{v.id}</td><td>{v.maf.toFixed(3)}</td><td>{v.n}</td><td>{pLabel(v.p)}</td><td>{pLabel(v.bonferroni)}</td><td>{pLabel(v.fdr)}</td></tr>)}</tbody></table></div>
      <button className={styles.primary} type="button" onClick={()=>download(gwasSummaryTsv(evidence.result,evidence.genotypeSha256,evidence.phenotypeSha256),
        `genithm-gwas-${evidence.genotypeSha256.slice(0,10)}.tsv`)}>↓ Export ALL tested variants (TSV, source checksums)</button>
      <details className={styles.provenance}><summary>Method, provenance and exclusions</summary>
        <p>Engine {GWAS_ENGINE_VERSION}. Genotype SHA-256: <code>{evidence.genotypeSha256}</code></p>
        <p>Phenotype SHA-256: <code>{evidence.phenotypeSha256}</code></p>
        <p>Excluded variants: {Object.entries(evidence.result.excluded).map(([k,v])=>`${k}: ${v}`).join(" · ")}</p>
        {evidence.result.warnings.map(w=><p key={w}>{w}</p>)}</details>
    </section></>:null}
  </div>;
}
