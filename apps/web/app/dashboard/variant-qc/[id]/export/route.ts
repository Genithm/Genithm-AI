import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { validateVcfQcSummary, vcfQcSummaryTsv } from "@/lib/vcf-quality-control";

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEADERS={
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Vary":"Cookie",
};
function fail(status:number){
  return NextResponse.json({error:"QC summary unavailable."},{status,headers:HEADERS});
}
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  if(!UUID.test(id))return fail(404);
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const userId=auth?.claims?.sub;
  if(!userId||authError)return fail(401);
  const {data,error}=await supabase.from("variant_qc_snapshots")
    .select("id,created_by,summary,source_sha256,total_records,source_verification")
    .eq("id",id).eq("created_by",userId).maybeSingle();
  if(error||!data)return fail(404);
  if(!validateVcfQcSummary(data.summary)||
    data.summary.totalRecords!==data.total_records ||
    data.source_verification!=="client_computed_unverified")return fail(409);
  try{
    return new NextResponse(vcfQcSummaryTsv(data.summary,data.source_sha256),{
      status:200,
      headers:{
        ...HEADERS,
        "Content-Type":"text/tab-separated-values; charset=utf-8",
        "Content-Disposition":'attachment; filename="genithm-vcf-qc-'+id.slice(0,8)+'.tsv"',
      },
    });
  }catch{return fail(409);}
}
