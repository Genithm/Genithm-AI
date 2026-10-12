import { NextResponse } from "next/server";

import {
  ScientificResultIntegrityError,
  scientificResultDescriptor,
  verifiedScientificResultBytes,
} from "@/lib/scientific-result-integrity";
import { ExplorerArtifactError, projectScientificArtifact } from "@/lib/scientific-result-explorer";
import { createClient } from "@/lib/supabase/server";

const secureHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Cookie",
};

function failure(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: secureHeaders });
}
function intParam(raw: string | null) {
  if (raw === null) return 0;
  if (!/^(0|[1-9]\d{0,7})$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number <= 10000000 ? number : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return failure(404, "Scientific job not found.");
  const url = new URL(request.url);
  const offset = intParam(url.searchParams.get("offset"));
  const row = intParam(url.searchParams.get("row"));
  if (offset === null || row === null || row > 49) {
    return failure(400, "Invalid scientific viewer window.");
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return failure(401, "Authentication required.");

  // IMPORTANT: Use only the authenticated, RLS-scoped client. Never a service-role client.
  const { data: job, error } = await supabase
    .from("scientific_jobs")
    .select("id,organization_id,project_id,job_type,status,result_object_path,result_sha256,result_bytes,result_summary")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return failure(404, "Scientific job not found.");
  let descriptor: ReturnType<typeof scientificResultDescriptor>;
  try {
    descriptor = scientificResultDescriptor(job);
  } catch (err) {
    if (err instanceof ScientificResultIntegrityError) {
      return failure(409, "A completed, internally consistent scientific artifact is required.");
    }
    throw err;
  }
  const { data, error: readError } = await supabase.storage
    .from("analysis-results")
    .download(descriptor.objectPath);
  if (readError || !data) return failure(404, "Private scientific artifact is unavailable.");

  try {
    const verified = await verifiedScientificResultBytes(data, descriptor.expectedBytes, descriptor.expectedSha256);
    const projection = projectScientificArtifact(job.job_type, verified, job.result_summary, offset, row);
    return NextResponse.json({
      verification: "sha256-verified",
      sha256: descriptor.expectedSha256,
      jobType: job.job_type,
      view: projection,
    }, { headers: secureHeaders });
  } catch (err) {
    if (err instanceof ScientificResultIntegrityError || err instanceof ExplorerArtifactError) {
      // Never return partial biological content on a validation failure.
      return failure(409, "Scientific result failed integrity or display-format validation.");
    }
    throw err;
  }
}
