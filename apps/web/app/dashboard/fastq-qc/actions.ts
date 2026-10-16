"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { FASTQ_QC_VERSION, validateFastqQcSummary } from "@/lib/fastq-quality-control";
import type { Json } from "@/lib/report-database.types";

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;

export async function saveFastqQcSnapshot(form:FormData):Promise<{id?:string;error?:string}> {
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const owner=auth?.claims?.sub;
  if(authError||!owner)return {error:"Please sign in."};
  const projectId=String(form.get("project_id")??"");
  const title=String(form.get("title")??"").trim();
  const payload=String(form.get("summary")??"");
  const hashText=String(form.get("source_hashes")??"");
  const hashes=hashText.split(",");
  if(!UUID.test(projectId)||title.length<3||title.length>160||
      payload.length>120000||!payload.length||!hashes.every(h=>SHA.test(h))||
      (hashes.length!==1&&hashes.length!==2)){
    return {error:"Invalid project, title, source fingerprints or QC summary."};
  }
  let raw:unknown;
  try{raw=JSON.parse(payload);}catch{return {error:"Malformed quality-control summary."};}
  if(!validateFastqQcSummary(raw)||raw.reads.length!==hashes.length||
    raw.analyzerVersion!==FASTQ_QC_VERSION)
    return {error:"Invalid FASTQ QC metric consistency. Re-run local analysis."};
  // No raw reads, headers, per-read quality or identifiers are accepted.
  const {data,error}=await supabase.from("fastq_qc_snapshots").insert({
    project_id:projectId,created_by:owner,title,mode:raw.mode,
    read_count:raw.reads[0].readCount,source_hashes:hashes,
    analyzer_version:FASTQ_QC_VERSION,summary:raw as unknown as Json,
  }).select("id").maybeSingle();
  if(error||!data)return {error:"Could not save aggregate QC. Check project access."};
  revalidatePath("/dashboard/fastq-qc");
  return {id:data.id};
}

export async function deleteFastqQcSnapshot(form:FormData) {
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const owner=auth?.claims?.sub;
  if(authError||!owner)redirect("/login");
  const id=String(form.get("snapshot_id")??"");
  if(!UUID.test(id))redirect("/dashboard/fastq-qc?error=Invalid%20QC%20snapshot");
  const {data,error}=await supabase.from("fastq_qc_snapshots")
    .delete().eq("id",id).eq("created_by",owner).select("id").maybeSingle();
  if(error||!data)redirect("/dashboard/fastq-qc?error=QC%20snapshot%20not%20deleted");
  revalidatePath("/dashboard/fastq-qc");
  redirect("/dashboard/fastq-qc?deleted=1");
}
