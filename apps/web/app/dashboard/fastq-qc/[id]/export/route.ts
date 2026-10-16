import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { fastqQcTsv,validateFastqQcSummary } from "@/lib/fastq-quality-control";

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const BASE={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Vary":"Cookie"};
const fail=(status:number)=>NextResponse.json({error:"QC report unavailable."},{status,headers:BASE});
export async function GET(_req:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  if(!UUID.test(id))return fail(404);
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const owner=auth?.claims?.sub;
  if(authError||!owner)return fail(401);
  const {data,error}=await supabase.from("fastq_qc_snapshots")
    .select("id,summary,mode,read_count,source_hashes,source_verification")
    .eq("id",id).eq("created_by",owner).maybeSingle();
  if(error||!data)return fail(404);
  const summary=data.summary;
  if(!validateFastqQcSummary(summary)||summary.mode!==data.mode||
    summary.reads[0].readCount!==data.read_count||
    data.source_verification!=="client_computed_unverified")return fail(409);
  try{
    return new NextResponse(fastqQcTsv(summary,data.source_hashes),{
      status:200,headers:{...BASE,"Content-Type":"text/tab-separated-values; charset=utf-8",
        "Content-Disposition":'attachment; filename="genithm-fastq-qc-'+id.slice(0,8)+'.tsv"'},
    });
  }catch{return fail(409);}
}
