/** Bounded exact hypergeometric pathway ORA; no external requests or storage. */
import {analyzePathways, MAX_PATHWAY_GMT_BYTES, MAX_PATHWAY_LIST_BYTES} from "@/lib/pathway-enrichment";
type Task = {selected: File; universe: File; gmt: File};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Task>) => void) | null;
  postMessage: (event: unknown) => void;
};
async function sha256(input: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}
scope.onmessage = async event => {
  try {
    const {selected, universe, gmt} = event.data;
    if (![selected, universe, gmt].every(x => x instanceof File) ||
        selected.size < 1 || selected.size > MAX_PATHWAY_LIST_BYTES ||
        universe.size < 1 || universe.size > MAX_PATHWAY_LIST_BYTES ||
        gmt.size < 1 || gmt.size > MAX_PATHWAY_GMT_BYTES)
      throw new Error("Choose a gene list and measured-gene universe ≤1 MiB each, plus GMT gene sets ≤8 MiB.");
    const [s, u, g] = await Promise.all([selected.arrayBuffer(), universe.arrayBuffer(), gmt.arrayBuffer()]);
    const decoder = new TextDecoder("utf-8", {fatal: true});
    const result = analyzePathways(decoder.decode(s), decoder.decode(u), decoder.decode(g),
      count => scope.postMessage({kind: "progress", count}));
    const [selectedSha256, universeSha256, gmtSha256] = await Promise.all([sha256(s), sha256(u), sha256(g)]);
    scope.postMessage({kind: "complete", result, selectedSha256, universeSha256, gmtSha256});
  } catch (cause) {
    scope.postMessage({kind: "error", message: cause instanceof Error ? cause.message : "Gene-set enrichment failed."});
  }
};
