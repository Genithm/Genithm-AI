import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: job, error } = await supabase.from("scientific_jobs")
    .select("id,job_type,status,result_object_path,result_sha256")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return NextResponse.json({ error: "Scientific job not found." }, { status: 404 });
  if (job.status !== "completed" || !job.result_object_path || !job.result_sha256) {
    return NextResponse.json({ error: "Scientific result is not available yet." }, { status: 409 });
  }

  const { data, error: downloadError } = await supabase.storage.from("analysis-results").download(job.result_object_path);
  if (downloadError || !data) return NextResponse.json({ error: "Scientific result could not be retrieved." }, { status: 404 });

  const bytes = await data.arrayBuffer();
  const filename = job.job_type === "multiple_sequence_alignment" ? `genithm-msa-${job.id}.fasta` : `genithm-pairwise-${job.id}.json`;
  const contentType = job.job_type === "multiple_sequence_alignment" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8";

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
