import { NextResponse } from "next/server";

import {
  ScientificResultIntegrityError,
  scientificResultDescriptor,
  verifiedScientificResultBytes,
} from "@/lib/scientific-result-integrity";
import { createClient } from "@/lib/supabase/server";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return errorResponse("Authentication required.", 401);

  // The user-scoped Supabase client and scientific_jobs RLS must authorize this row.
  const { data: job, error } = await supabase.from("scientific_jobs")
    .select("id,organization_id,project_id,job_type,status,result_object_path,result_sha256,result_bytes")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return errorResponse("Scientific job not found.", 404);

  let descriptor: ReturnType<typeof scientificResultDescriptor>;
  try {
    descriptor = scientificResultDescriptor(job);
  } catch (err) {
    if (err instanceof ScientificResultIntegrityError) {
      return errorResponse("Scientific artifact is unavailable or failed metadata integrity validation.", 409);
    }
    throw err;
  }

  // Never return a signed URL or unaudited storage object to the browser.
  const { data, error: downloadError } = await supabase.storage
    .from("analysis-results")
    .download(descriptor.objectPath);
  if (downloadError || !data) return errorResponse("Scientific result could not be retrieved.", 404);

  let bytes: ArrayBuffer;
  try {
    bytes = await verifiedScientificResultBytes(data, descriptor.expectedBytes, descriptor.expectedSha256);
  } catch (err) {
    if (err instanceof ScientificResultIntegrityError) {
      return errorResponse("Downloaded scientific result failed SHA-256 or size verification. No file was served.", 409);
    }
    throw err;
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": descriptor.contentType,
      "Content-Disposition": `attachment; filename="${descriptor.filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Genithm-Result-Integrity": "sha256-verified",
    },
  });
}
