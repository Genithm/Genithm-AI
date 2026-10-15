/** V25: purely structural selection; caller must first enforce Supabase RLS
 * and prove every selected run belongs to a consented message in this chat.
 * The selected old run is placed first so a bounded dossier cannot evict it.
 */
export const MAX_CONVERSATION_EVIDENCE_RUNS = 100;

export function selectEvidenceRuns<T extends { id: string }>(
  recentlyLinkedRuns: readonly T[],
  explicitlyAuthorizedRun: T | null,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const run of [
    ...(explicitlyAuthorizedRun ? [explicitlyAuthorizedRun] : []),
    ...recentlyLinkedRuns,
  ]) {
    if (!run.id || seen.has(run.id)) continue;
    seen.add(run.id);
    selected.push(run);
    if (selected.length >= MAX_CONVERSATION_EVIDENCE_RUNS) break;
  }
  return selected;
}
