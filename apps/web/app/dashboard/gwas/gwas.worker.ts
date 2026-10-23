import { calculateGwas, MAX_GWAS_GENOTYPE_BYTES, MAX_GWAS_PHENOTYPE_BYTES,
  type GwasSettings } from "@/lib/gwas-association";

type Task = {genotypes:File; phenotypes:File; settings:GwasSettings};
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<Task>)=>void)|null;postMessage:(value:unknown)=>void};
function sha(data:ArrayBuffer):Promise<string>{
  return crypto.subtle.digest("SHA-256",data).then(buffer=>
    Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join(""));
}
scope.onmessage=async(event)=>{
  try{
    const {genotypes,phenotypes,settings}=event.data;
    if(!(genotypes instanceof File)||!(phenotypes instanceof File)||
      genotypes.size<1||genotypes.size>MAX_GWAS_GENOTYPE_BYTES||
      phenotypes.size<1||phenotypes.size>MAX_GWAS_PHENOTYPE_BYTES)
      throw new Error("Choose uncompressed genotype data ≤64 MiB and phenotype data ≤2 MiB.");
    const [gt,pt]=await Promise.all([genotypes.arrayBuffer(),phenotypes.arrayBuffer()]);
    const decoder=new TextDecoder("utf-8",{fatal:true});
    const [gtText,ptText]=[decoder.decode(gt),decoder.decode(pt)];
    const result=calculateGwas(gtText,ptText,settings,count=>scope.postMessage({kind:"progress",count}));
    const [genotypeSha256,phenotypeSha256]=await Promise.all([sha(gt),sha(pt)]);
    scope.postMessage({kind:"complete",result,genotypeSha256,phenotypeSha256});
  }catch(cause){scope.postMessage({kind:"error",message:cause instanceof Error?cause.message:"GWAS could not be completed."});}
};
