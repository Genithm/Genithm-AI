import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  assembleDossier, DossierValidationError, validateDossierSelection,
  type Dossier, type SealedReport,
} from "@/lib/research-dossier";

export type DossierLoadResult =
  | { ok: true; dossier: Dossier; projectName: string }
  | { ok: false; status: 400 | 401 | 404 | 409 | 413 | 503; message: string };

/**
 * All report access passes through get_scientific_report() which recomputes
 * report integrity under the caller's authenticated permissions.
 * Never call the RPC with service-role credentials.
 */
export async function loadDossier(
  projectId: string,
  reportIds: readonly string[],
): Promise<DossierLoadResult> {
  let selection: ReturnType<typeof validateDossierSelection>;
  try {
    selection = validateDossierSelection(projectId, reportIds);
  } catch {
    return { ok: false, status: 400, message: "Select 2–8 different reports from one project." };
  }
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return { ok: false, status: 401, message: "Authentication required." };
  }
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,name")
    .eq("id", selection.projectId)
    .maybeSingle();
  if (projectError) return { ok: false, status: 503, message: "Project evidence could not be loaded." };
  if (!project) return { ok: false, status: 404, message: "Research project not found." };

  const queried = await Promise.all(selection.reportIds.map(reportId =>
    supabase.rpc("get_scientific_report", { report_id: reportId }),
  ));
  if (queried.some(result => result.error)) {
    return { ok: false, status: 503, message: "One or more scientific report records could not be verified." };
  }
  const reports = queried.map(result => result.data?.[0]);
  if (reports.some(report => !report)) {
    return { ok: false, status: 404, message: "One or more selected reports are unavailable." };
  }
  try {
    const dossier = await assembleDossier(
      selection.projectId, selection.reportIds, reports as SealedReport[],
    );
    return { ok: true, dossier, projectName: project.name };
  } catch (error) {
    if (error instanceof DossierValidationError) {
      const oversized = error.message.includes("too large") || error.message.includes("size budget");
      return { ok: false, status: oversized ? 413 : 409,
        message: oversized
          ? "Selected reports exceed the bounded dossier export size."
          : "A selected scientific report failed project-scope or integrity validation.",
      };
    }
    return { ok: false, status: 503, message: "The research dossier could not be prepared." };
  }
}
