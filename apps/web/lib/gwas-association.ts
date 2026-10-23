/**
 * Genithm V54: real, bounded, local-only GWAS on multisample uncompressed VCF v4
 * (diploid, biallelic GT) or variant-major dosage TSV/CSV. No fabricated signals.
 * Phenotype and optional numeric covariates are matched by exact sample ID.
 * All computation is deterministic; no backend, API keys, or file upload.
 */
export const GWAS_ENGINE_VERSION = "genithm-local-gwas/1.0.0";
export const MAX_GWAS_GENOTYPE_BYTES = 64 * 1024 * 1024;
export const MAX_GWAS_PHENOTYPE_BYTES = 2 * 1024 * 1024;
export const MAX_GWAS_VARIANTS = 50000;
export const MAX_GWAS_SAMPLES = 2000;
export const MAX_GWAS_CELLS = 12000000;
const missing = new Set(["", ".", "NA", "N/A", "nan", "-9"]);
const chromosome = /^(?:chr)?(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT|M)$/i;
const columnName = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

export class GwasInputError extends Error {
  constructor(message: string) { super(message); this.name = "GwasInputError"; }
}
function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GwasInputError(message);
}
export type TraitKind = "quantitative" | "binary";
export type GwasSettings = { traitKind: TraitKind; minMaf: number; maxMissing: number; noCovariateAcknowledged: boolean };
export type GwasVariant = { chrom: string; pos: number; id: string; n: number; maf: number; missingRate: number;
  method: "linear" | "logistic-score"; beta: number | null; se: number | null; statistic: number; p: number;
  bonferroni: number; fdr: number };
export type GwasResult = { schema: "genithm-local-gwas/1"; engineVersion: string;
  mode: "vcf-gt" | "dosage-matrix"; traitKind: TraitKind; associationMethod: string;
  samplesInGenotypes: number; samplesMatched: number; covariates: string[];
  variantsSeen: number; variantsTested: number; excluded: Record<string, number>;
  thresholds: { minMaf: number; maxMissing: number }; significantBonferroni: number;
  warnings: string[]; variants: GwasVariant[] };

type Phenotype = { trait: number; covariates: number[] };
function lines(text: string, name: string): string[] {
  requireInput(text.length > 0 && !text.includes("\0"), `${name} must be nonempty UTF-8 text, without binary bytes.`);
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter(line => line.length > 0 && !line.startsWith("##"));
}
function fields(line: string, delimiter: string): string[] {
  const cells = line.split(delimiter);
  requireInput(cells.every(c => !c.includes('"') && !c.includes("\0")), "Use plain, unquoted tab-separated or comma-separated data.");
  return cells.map(c => c.trim());
}
function numeric(raw: string, context: string): number | null {
  if (missing.has(raw)) return null;
  requireInput(raw.length <= 40 && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw), `${context} contains a nonnumeric value.`);
  const val = Number(raw);
  requireInput(Number.isFinite(val) && Math.abs(val) <= 1e10, `${context} contains an invalid or extreme number.`);
  return val;
}
function phenotypeRows(text: string, settings: GwasSettings): { map: Map<string, Phenotype>; covariates: string[] } {
  requireInput(text.length <= MAX_GWAS_PHENOTYPE_BYTES, "Phenotype file exceeds 2 MiB.");
  const rows = lines(text, "Phenotype file");
  requireInput(rows.length >= 21 && rows.length <= MAX_GWAS_SAMPLES + 5001, "Phenotype table must contain 20–7,000 rows.");
  const delimiter = rows[0].includes("\t") ? "\t" : ",";
  const header = fields(rows[0], delimiter);
  requireInput(header[0]?.toLowerCase() === "sample_id" && header[1]?.toLowerCase() === "phenotype", "Phenotype table header must start with sample_id, phenotype.");
  const covariates = header.slice(2);
  requireInput(covariates.length <= 8 && header.every(x => columnName.test(x)) && new Set(header).size === header.length,
    "Phenotype column names must be unique and valid, with at most 8 numeric covariates.");
  requireInput(covariates.length > 0 || settings.noCovariateAcknowledged,
    "Without population-structure covariates, GWAS may be confounded. Explicitly acknowledge an unadjusted exploratory run.");
  const map = new Map<string, Phenotype>();
  for (let index = 1; index < rows.length; index++) {
    const cells = fields(rows[index], delimiter);
    requireInput(cells.length === header.length, `Phenotype row ${index+1} has the wrong column count.`);
    const id = cells[0];
    requireInput(columnName.test(id) && !map.has(id), `Phenotype sample ID on row ${index+1} is invalid or duplicated.`);
    const trait = numeric(cells[1], `Phenotype row ${index+1}`);
    if (trait !== null && settings.traitKind === "binary")
      requireInput(trait === 0 || trait === 1, `Binary phenotype on row ${index+1} must be 0 (control) or 1 (case).`);
    const values = cells.slice(2).map((c,i) => numeric(c, `Covariate ${covariates[i]} on row ${index+1}`));
    if (trait !== null && values.every(v => v !== null)) map.set(id, { trait, covariates: values as number[] });
    else map.set(id, { trait: NaN, covariates: [] });
  }
  return { map, covariates };
}

/** Continued fraction used by the regularized incomplete beta distribution. */
function logGamma(z: number): number {
  const p = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI*z)) - logGamma(1-z);
  z -= 1; let x=p[0]; for(let i=1;i<p.length;i++)x+=p[i]/(z+i);
  const t=z+7.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
}
function betaCF(a:number,b:number,x:number):number {
  const FPMIN=1e-300;const qab=a+b,qap=a+1,qam=a-1;
  let c=1,d=1-qab*x/qap;if(Math.abs(d)<FPMIN)d=FPMIN;d=1/d;let h=d;
  for(let m=1;m<=300;m++){
    const m2=2*m;let aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;
    const delta=d*c;h*=delta;if(Math.abs(delta-1)<3e-12)break;
  }
  return h;
}
function regBeta(x:number,a:number,b:number):number {
  if(x<=0)return 0;if(x>=1)return 1;
  const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  return Math.max(0,Math.min(1,x<(a+1)/(a+b+2)?bt*betaCF(a,b,x)/a:1-bt*betaCF(b,a,1-x)/b));
}
function studentTwoSided(t:number,df:number):number {
  const xx=df/(df+t*t);return Math.max(1e-300,regBeta(xx,df/2,.5));
}
// Numerical Recipes erfc approximation; appropriate for genome-wide exploratory score P-values.
function erfc(x:number):number {
  const z=Math.abs(x),t=1/(1+.5*z);
  const ans=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277)))))))));
  return x>=0?ans:2-ans;
}

/** Modified Gram-Schmidt with reorthogonalization; reject rank-deficient covariates. */
function orthonormal(columns:number[][]):number[][]|null {
  const basis:number[][]=[];
  for(const column of columns){
    const residual=column.slice();
    for(let turn=0;turn<2;turn++)for(const q of basis){
      let dot=0;for(let i=0;i<q.length;i++)dot+=q[i]*residual[i];
      for(let i=0;i<q.length;i++)residual[i]-=dot*q[i];
    }
    let sq=0;for(const r of residual)sq+=r*r;
    const orig=column.reduce((s,x)=>s+x*x,0);
    if(!(sq>Math.max(orig*1e-20,1e-20)))return null;
    const norm=Math.sqrt(sq);basis.push(residual.map(x=>x/norm));
  }
  return basis;
}
function residual(vector:number[],basis:number[][]):number[]{
  const result=vector.slice();for(const q of basis){let dot=0;
    for(let i=0;i<q.length;i++)dot+=q[i]*result[i];
    for(let i=0;i<q.length;i++)result[i]-=dot*q[i];
  }return result;
}
function dot(a:number[],b:number[]):number {let total=0;for(let i=0;i<a.length;i++)total+=a[i]*b[i];return total;}
function linearTest(y:number[],g:number[],covs:number[][]): {statistic:number;p:number;beta:number;se:number}|null {
  const n=y.length,k=covs[0].length;
  const xs=[Array(n).fill(1) as number[],...Array.from({length:k},(_,c)=>covs.map(v=>v[c]))];
  const q=orthonormal(xs);if(!q)return null;
  const gy=residual(g,q), yy=residual(y,q), gg=dot(gy,gy);
  if(gg<1e-10)return null;
  const beta=dot(gy,yy)/gg,df=n-k-2;
  if(df<10)return null;
  const res=yy.map((v,i)=>v-beta*gy[i]);const rss=dot(res,res);
  if(rss<1e-16)return null;
  const se=Math.sqrt(rss/df/gg);const statistic=beta/se;
  return {beta,se,statistic,p:studentTwoSided(statistic,df)};
}
function logisticScore(y:number[],g:number[],covs:number[][]):{statistic:number;p:number;beta:null;se:null}|null{
  const n=y.length,k=covs[0].length;
  const x=y.map((_,i)=>[1,...covs[i]]);
  const ymean=y.reduce((a,b)=>a+b,0)/n;if(ymean<.05||ymean>.95)return null;
  let coefficients=Array(k+1).fill(0) as number[];coefficients[0]=Math.log(ymean/(1-ymean));
  let probabilities:number[]=[];let weights:number[]=[];let converged=false;
  for(let step=0;step<35;step++){
    probabilities=x.map(row=>{const a=dot(row,coefficients);return 1/(1+Math.exp(-Math.max(-30,Math.min(30,a))));});
    weights=probabilities.map(p=>Math.max(p*(1-p),1e-7));
    const weightedBasis=orthonormal(Array.from({length:k+1},(_,col)=>x.map((row,i)=>row[col]*Math.sqrt(weights[i]))));
    if(!weightedBasis)return null;
    const weightedResidual=(y.map((v,i)=>(v-probabilities[i])/Math.sqrt(weights[i])));
    // Solve the weighted least-squares update with Gaussian elimination.
    const a=Array.from({length:k+1},(_,u)=>Array.from({length:k+2},(_,v)=>{
      if(v===k+1)return x.reduce((s,row,i)=>s+row[u]*(y[i]-probabilities[i]),0);
      return x.reduce((s,row,i)=>s+row[u]*row[v]*weights[i],0);
    }));
    let valid=true;
    for(let c=0;c<k+1;c++){
      let pivot=c;for(let j=c+1;j<k+1;j++)if(Math.abs(a[j][c])>Math.abs(a[pivot][c]))pivot=j;
      if(Math.abs(a[pivot][c])<1e-10){valid=false;break;}
      [a[pivot],a[c]]=[a[c],a[pivot]];
      const scale=a[c][c];for(let j=c;j<=k+1;j++)a[c][j]/=scale;
      for(let i=0;i<k+1;i++)if(i!==c){const f=a[i][c];for(let j=c;j<=k+1;j++)a[i][j]-=f*a[c][j];}
    }
    if(!valid)return null;
    const delta=a.map(row=>row[k+1]);
    const max=Math.max(...delta.map(Math.abs));
    const damping=max>2?2/max:1;
    coefficients=coefficients.map((v,i)=>v+damping*delta[i]);
    if(max<1e-7){converged=true;break;}
  }
  if(!converged)return null;
  probabilities=x.map(row=>1/(1+Math.exp(-Math.max(-30,Math.min(30,dot(row,coefficients))))));
  weights=probabilities.map(p=>Math.max(p*(1-p),1e-7));
  const basis=orthonormal(Array.from({length:k+1},(_,col)=>x.map((row,i)=>row[col]*Math.sqrt(weights[i]))));
  if(!basis)return null;
  const weightedG=g.map((v,i)=>v*Math.sqrt(weights[i]));
  const adjusted=residual(weightedG,basis);
  const info=dot(adjusted,adjusted);if(info<=1e-10)return null;
  const score=g.reduce((s,v,i)=>s+v*(y[i]-probabilities[i]),0);
  const statistic=score*score/info;
  return {statistic,p:Math.max(1e-300,Math.min(1,erfc(Math.sqrt(statistic/2)))),beta:null,se:null};
}
function chromRank(chr:string):number{const v=chr.replace(/^chr/i,"").toUpperCase();return /^(?:[1-9]|1[0-9]|2[0-2])$/.test(v)?Number(v):v==="X"?23:v==="Y"?24:25;}
export function gwasManhattanOrder(a:GwasVariant,b:GwasVariant):number {
  return chromRank(a.chrom)-chromRank(b.chrom)||a.pos-b.pos||a.id.localeCompare(b.id);
}
export function gwasSummaryTsv(v:GwasResult,shaGenotypes:string,shaPhenotypes:string):string {
  requireInput(/^[a-f0-9]{64}$/.test(shaGenotypes)&&/^[a-f0-9]{64}$/.test(shaPhenotypes),"Valid source checksums required.");
  // Spreadsheet formula injection protection, including arbitrary variant IDs.
  const safe=(value:string|number|null)=>{const s=String(value??"NA").replace(/[\r\n\t]/g," ");return /^[=+@]|^-(?!\d)/.test(s)?"'"+s:s;};
  const hdr=["CHR","POS","ID","N","MAF","MISSING_RATE","METHOD","BETA","SE","STATISTIC","P","P_BONFERRONI","Q_BH_FDR"];
  const rows=[`# Genithm ${GWAS_ENGINE_VERSION}; local exploratory analysis; NOT clinical`,
    `# genotype_sha256=${shaGenotypes}; phenotype_sha256=${shaPhenotypes}`,
    `# trait=${v.traitKind}; covariates=${v.covariates.join(",")||"none"}; tested_variants=${v.variantsTested}`,
    hdr.join("\t")];
  for(const z of v.variants)rows.push([z.chrom,z.pos,z.id,z.n,z.maf,z.missingRate,z.method,z.beta,z.se,z.statistic,z.p,z.bonferroni,z.fdr].map(safe).join("\t"));
  return rows.join("\n")+"\n";
}
export function calculateGwas(genotypeText:string,phenotypeText:string,settings:GwasSettings,
  onProgress?:(variantsSeen:number)=>void):GwasResult{
  requireInput(settings.traitKind==="quantitative"||settings.traitKind==="binary","Choose a quantitative or binary phenotype.");
  requireInput(Number.isFinite(settings.minMaf)&&settings.minMaf>=0&&settings.minMaf<=.5 &&
    Number.isFinite(settings.maxMissing)&&settings.maxMissing>=0&&settings.maxMissing<=.5,"GWAS QC thresholds are invalid.");
  requireInput(genotypeText.length>0 && genotypeText.length<=MAX_GWAS_GENOTYPE_BYTES,"Genotype input must be under 64 MiB.");
  const {map, covariates}=phenotypeRows(phenotypeText,settings);
  const rows=lines(genotypeText,"Genotype file");
  requireInput(rows.length>=2,"Genotype data must have a header and at least one variant.");
  const isVcf=rows[0].startsWith("#CHROM");
  if(isVcf)requireInput(/^##fileformat=VCFv4\.[0-9]+(?:\r\n|\n|\r)/.test(genotypeText.replace(/^\uFEFF/,"")),
    "Multi-sample VCF requires an explicit VCFv4.x fileformat declaration.");
  const delim=isVcf||rows[0].includes("\t")?"\t":",";
  const header=fields(rows[0],delim);
  const sampleIds=isVcf?header.slice(9):header.slice(3);
  requireInput(isVcf?header.slice(0,9).join("\t")==="#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT":
    header.slice(0,3).map(x=>x.toUpperCase()).join("\t")==="CHR\tPOS\tSNP",
    "Use multisample VCF v4 (#CHROM...) or a dosage table starting CHR POS SNP.");
  requireInput(sampleIds.length>=20&&sampleIds.length<=MAX_GWAS_SAMPLES&&new Set(sampleIds).size===sampleIds.length&&
    sampleIds.every(s=>columnName.test(s)),"Genotypes require 20–2,000 unique sample IDs.");
  const selected=sampleIds.map((id,i)=>({index:i,pheno:map.get(id)})).filter(v=>v.pheno&&Number.isFinite(v.pheno.trait));
  requireInput(selected.length>=20,"At least 20 genotype sample IDs must have complete, matching phenotype and covariates.");
  requireInput((rows.length-1)*sampleIds.length<=MAX_GWAS_CELLS,"Analysis exceeds 12 million sample-variant cells; use a dedicated GWAS compute service.");
  requireInput(rows.length<=MAX_GWAS_VARIANTS+1,"GWAS input exceeds 50,000 variant rows.");
  const excluded:Record<string,number>={multiallelic:0,invalid_genotype:0,missingness:0,rare_allele:0,insufficient_samples:0,rank_or_convergence:0};
  const variants:GwasVariant[]=[];
  for(let i=1;i<rows.length;i++){
    if(i%1000===0)onProgress?.(i);
    const line=fields(rows[i],delim);
    requireInput(line.length===header.length,`Genotype row ${i+1} has the wrong number of fields.`);
    const chrom=line[0].replace(/^chr/i,"");
    requireInput(chromosome.test(chrom),`Invalid chromosome in genotype row ${i+1}.`);
    const position=Number(line[1]);
    requireInput(Number.isSafeInteger(position)&&position>0&&position<=2147483647,`Invalid position on genotype row ${i+1}.`);
    if(isVcf){
      requireInput(/^[ACGTN]+$/i.test(line[3]) && /^[ACGTN,]+$/i.test(line[4]) && line[3].length<=300 && line[4].length<=300,
        `VCF row ${i+1} has invalid or unsupported REF/ALT alleles.`);
      if(line[4].includes(",")){excluded.multiallelic++;continue;}
    }
    const variantId=(line[2]==="."?`${chrom}:${position}${isVcf?":"+line[3]+":"+line[4]:""}`:line[2]);
    requireInput(variantId.length>0&&variantId.length<=120 && !/[\t\r\n\0]/.test(variantId),`Variant ID is invalid on row ${i+1}.`);
    let gtIndex=0;
    if(isVcf){gtIndex=line[8].split(":").indexOf("GT");if(gtIndex<0){excluded.invalid_genotype++;continue;}}
    const y:number[]=[],g:number[]=[],x:number[][]=[];
    let missingCount=0,sumDosage=0;
    for(const {index,pheno} of selected){
      if(!pheno)continue;
      const raw=line[(isVcf?9:3)+index];
      let dosage:number|null;
      if(isVcf){
        const gt=raw.split(":")[gtIndex]??".";
        if(gt==="./."||gt===".|."||gt===".")dosage=null;
        else if(/^[01][\|/][01]$/.test(gt))dosage=Number(gt[0])+Number(gt[2]);
        else throw new GwasInputError(`VCF row ${i+1} contains non-diploid or non-biallelic GT. Handle haploid, partial and multiallelic genotypes in a specialized GWAS backend.`);
      }else{
        dosage=numeric(raw,`Genotype at variant ${i+1}`);
        if(dosage!==null)requireInput(dosage>=0&&dosage<=2,`Genotype dosage must be between 0 and 2 on variant ${i+1}.`);
      }
      if(dosage===null){missingCount++;continue;}
      y.push(pheno.trait);g.push(dosage);x.push(pheno.covariates);sumDosage+=dosage;
    }
    const missRate=missingCount/selected.length;
    if(missRate>settings.maxMissing){excluded.missingness++;continue;}
    if(g.length<Math.max(20,covariates.length+13)){excluded.insufficient_samples++;continue;}
    const af=sumDosage/(2*g.length),maf=Math.min(af,1-af);
    if(maf<settings.minMaf || 2*g.length*maf<5){excluded.rare_allele++;continue;}
    if(settings.traitKind==="binary"){
      const cases=y.reduce((s,v)=>s+v,0);
      if(cases<8||y.length-cases<8){excluded.insufficient_samples++;continue;}
    }
    const fit=settings.traitKind==="binary"?logisticScore(y,g,x):linearTest(y,g,x);
    if(!fit){excluded.rank_or_convergence++;continue;}
    variants.push({chrom,pos:position,id:variantId,n:g.length,maf,missingRate:missRate,
      method:settings.traitKind==="binary"?"logistic-score":"linear",...fit,bonferroni:1,fdr:1});
  }
  requireInput(variants.length>0,`No variants passed GWAS QC and model checks. Exclusions: ${JSON.stringify(excluded)}.`);
  const m=variants.length;
  const sorted=variants.slice().sort((a,b)=>a.p-b.p);
  let minFdr=1;
  for(let i=m-1;i>=0;i--){const v=sorted[i];v.bonferroni=Math.min(1,v.p*m);minFdr=Math.min(minFdr,v.p*m/(i+1));v.fdr=minFdr;}
  variants.sort(gwasManhattanOrder);
  const warnings=["Exploratory association only; population structure, relatedness, batch effects and HWE require independent QC.",
    "Source genotypes and phenotype were processed locally and were not uploaded or saved.",
    covariates.length?`Adjusted for ${covariates.length} supplied numeric covariate(s); confirm these include relevant ancestry PCs.`:
      "Unadjusted model: high risk of population stratification and confounding.",
    "For cohort-scale GWAS, rare variants, related subjects or clinical claims, run validated PLINK2/REGENIE/SAIGE infrastructure."];
  return {schema:"genithm-local-gwas/1",engineVersion:GWAS_ENGINE_VERSION,mode:isVcf?"vcf-gt":"dosage-matrix",
    traitKind:settings.traitKind,associationMethod:settings.traitKind==="binary"?"Covariate-adjusted logistic score test (1 df)":"Covariate-adjusted additive OLS (two-sided t)",
    samplesInGenotypes:sampleIds.length,samplesMatched:selected.length,covariates,variantsSeen:rows.length-1,variantsTested:m,
    excluded,thresholds:{minMaf:settings.minMaf,maxMissing:settings.maxMissing},
    significantBonferroni:variants.filter(v=>v.bonferroni<.05).length,warnings,variants};
}
