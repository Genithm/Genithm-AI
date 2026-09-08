export function aiEvidenceFactHref(interpretationId: string, evidenceId: string) {
  const encodedEvidenceId = encodeURIComponent(evidenceId);
  return `/dashboard/ai/evidence/${encodeURIComponent(interpretationId)}?fact=${encodedEvidenceId}#evidence-${encodedEvidenceId}`;
}

export function aiEvidenceExplorerHref(interpretationId: string) {
  return `/dashboard/ai/evidence/${encodeURIComponent(interpretationId)}`;
}
