/** Web Worker only. Raw count/design bytes never leave the user's browser. */
import {analyzeExpression, MAX_COUNT_BYTES, MAX_DESIGN_BYTES,
  type ExpressionSettings} from "@/lib/expression-analysis";

type Task = {counts: File; design: File; settings: ExpressionSettings};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Task>) => void) | null;
  postMessage: (event: unknown) => void;
};
async function sha256(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}
scope.onmessage = async event => {
  try {
    const {counts, design, settings} = event.data;
    if (!(counts instanceof File) || !(design instanceof File) ||
        counts.size < 1 || counts.size > MAX_COUNT_BYTES || design.size < 1 || design.size > MAX_DESIGN_BYTES)
      throw new Error("Select raw gene-count TSV/CSV up to 32 MiB and sample design TSV/CSV up to 512 KiB.");
    const [rawCounts, rawDesign] = await Promise.all([counts.arrayBuffer(), design.arrayBuffer()]);
    const decoder = new TextDecoder("utf-8", {fatal: true});
    const countText = decoder.decode(rawCounts);
    const designText = decoder.decode(rawDesign);
    const result = analyzeExpression(countText, designText, settings,
      count => scope.postMessage({kind: "progress", count}));
    const [countsSha256, designSha256] = await Promise.all([sha256(rawCounts), sha256(rawDesign)]);
    scope.postMessage({kind: "complete", result, countsSha256, designSha256});
  } catch (cause) {
    scope.postMessage({kind: "error", message: cause instanceof Error ? cause.message : "RNA expression analysis failed."});
  }
};
