/** V56: deterministic chat guidance for analyses with real local file-driven
 * engines. Do not send raw file bytes to the LLM, spawn tools or invent results.
 */
export type LocalLabKind = "expression" | "pathway";
const request = /\b(?:run|perform|conduct|analy[sz]e|start|execute|compute|calculate|carry out|do|process|test|undertake)\b/i;
const question = /^(?:what|why|how|when|where|explain|define|describe|compare|summarize|teach)\b/i;
const expression = /\b(?:differential(?:ly)?[\s-]+express(?:ed|ion)|gene[\s-]+expression|rna[\s-]*seq|transcriptomics|bulk[\s-]*rna)\b/i;
const pathway = /\b(?:pathway[\s-]+enrichment|gene[\s-]*set[\s-]+enrichment|over[\s-]*representation|\bORA\b|functional[\s-]+enrichment|GO[\s-]+enrichment|KEGG[\s-]+enrichment)\b/i;
const bareExpression = /^(?:differential(?:ly)?[\s-]+express(?:ed|ion)|rna[\s-]*seq|gene[\s-]+expression)[.!?]?$/i;
const barePathway = /^(?:pathway[\s-]+enrichment|gene[\s-]*set[\s-]+enrichment|\bORA\b)[.!?]?$/i;
export function matchLocalAnalysisRequest(message: string): LocalLabKind | null {
  const text = message.trim();
  if (!text || text.length > 8000 || (question.test(text) && !request.test(text))) return null;
  if (pathway.test(text) && (request.test(text) || barePathway.test(text))) return "pathway";
  if (expression.test(text) && (request.test(text) || bareExpression.test(text))) return "expression";
  return null;
}
export function localAnalysisGuidance(kind: LocalLabKind): string {
  if (kind === "pathway") return "Genithm can now run real, bounded pathway over-representation analysis in its Pathway Enrichment Lab: /dashboard/pathways. " +
    "Provide a selected gene list, the explicit background of all measured/tested genes, and matching GMT pathway sets. " +
    "The lab calculates exact hypergeometric upper-tail P-values, observed/expected overlaps, BH-adjusted P-values and downloadable results. " +
    "This chat has not performed the analysis or accessed raw local files. Your inputs remain in the browser and the results need interpretation against the provided gene universe.";
  return "Genithm now offers real exploratory two-condition RNA expression analysis in the RNA Expression Lab: /dashboard/expression. " +
    "Supply an existing raw integer gene-count CSV/TSV matrix (gene_id, sample columns), plus a sample_id/condition CSV/TSV with at least three independent samples per group. " +
    "The lab computes median-ratio normalization, expression filtering, sample PCA, two-sided Welch tests on log2-normalized CPM, BH-adjusted P-values, volcano plots and gene-list exports for the Pathway Enrichment Lab at /dashboard/pathways. " +
    "These tests are exploratory, not DESeq2/edgeR negative-binomial inference. This tool does NOT quantify FASTQ reads or account for batches or covariates. " +
    "Nothing has been executed from this chat text. Raw files stay in your browser and are not sent to the AI model or server.";
}
