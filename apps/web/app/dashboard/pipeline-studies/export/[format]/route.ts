import { NextResponse } from "next/server";
import { loadPipelineStudy } from "@/lib/pipeline-study.server";
import { renderPipelineStudyMarkdown } from "@/lib/pipeline-study";

export const dynamic="force-dynamic";
const BASE_HEADERS={
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; sandbox",
  "Vary":"Cookie",
};
export async function GET(request:Request,{params}:{
  params:Promise<{format:string}>;
}){
  const {format}=await params;
  if(format!=="json"&&format!=="markdown")
    return NextResponse.json({error:"Unsupported study export format."},
      {status:404,headers:BASE_HEADERS});
  const url=new URL(request.url);
  const result=await loadPipelineStudy(
    url.searchParams.get("project_id")??"",
    url.searchParams.getAll("run_id"),
  );
  if(!result.ok)return NextResponse.json({error:result.message},
    {status:result.status,headers:BASE_HEADERS});
  const {study,projectName}=result;
  const text=format==="json"
    ?JSON.stringify({
      schema_version:"genithm-pipeline-study-bundle/1",
      payload:study.payload,
      comparison:study.dossier.comparison,
      integrity:{
        algorithm:"SHA-256",
        scope:"payload",
        canonicalization:"recursively sorted JSON object keys; compact JSON UTF-8",
        canonical_payload_sha256:study.payload_sha256,
        sealed_dossier_sha256:study.dossier.canonical_payload_sha256,
        note:"Checksums are not signatures or independent scientific validation.",
      },
    },null,2)+"\n"
    :renderPipelineStudyMarkdown(study,projectName);
  const bytes=new TextEncoder().encode(text);
  return new Response(text,{status:200,headers:{
    ...BASE_HEADERS,
    "Content-Type":format==="json"?"application/json; charset=utf-8":"text/markdown; charset=utf-8",
    "Content-Disposition":'attachment; filename="genithm-pipeline-study-'+study.payload.project_id+
      (format==="json"?'.json"':'.md"'),
    "Content-Length":String(bytes.byteLength),
    "X-Genithm-Study-Payload-SHA256":study.payload_sha256,
    "X-Genithm-Verified-Pipeline-Count":String(study.study_count),
  }});
}
