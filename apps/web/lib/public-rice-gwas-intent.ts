/** V57: distinguish requests to execute genuine published rice GWAS from
 * ordinary educational questions and unsupported species. Conversational
 * follow-ups reuse only recent same-conversation user intent, not AI guesses. */
export function isPublicRiceGwasRequest(message:string, history:unknown = []): boolean {
  const input=message.trim();
  if(!input||input.length>8000)return false;
  const rice=/\b(?:rice|oryza[\s-]*sativa)\b/i;
  const gwas=/\b(?:gwas|genome[\s-]*wide association(?:\s+(?:study|analysis))?)\b/i;
  const execute=/\b(?:run|perform|analy[sz]e|compute|conduct|start|execute|do|carry out|pick|choose|fetch|download|retrieve|find)\b/i;
  const knowledge=/^(?:what|why|how|when|where|explain|define|describe|compare|teach|summarize)\b/i;
  if(rice.test(input)&&gwas.test(input)) return !knowledge.test(input) && (execute.test(input)||/\b(?:result|file|data|study)\b/i.test(input));
  // An explicit delegated-data follow-up should never lose the GWAS goal.
  const delegate=/\b(?:fetch|find|download|choose|pick|select|you(?:rself)?|yourself|any\s+(?:real\s+)?data|don.?t\s+have\s+(?:the\s+)?files?|have\s+no\s+files?|no\s+data|all\s+upon\s+you)\b/i;
  if(!delegate.test(input)||knowledge.test(input))return false;
  if(!Array.isArray(history))return false;
  return history.slice(-10).some(item=>{
    if(item===null||typeof item!=="object"||Array.isArray(item))return false;
    const record=item as Record<string,unknown>;
    if(record.role!=="user" && record.role!=="human")return false;
    const prior=String(record.content??record.user_message??"").slice(0,8000);
    return rice.test(prior)&&gwas.test(prior);
  });
}
export function riceGwasCompletionMessage(runId:string,result:{trait:string;matched:number;markers_source:number;markers_tested:number;significant_bonferroni:number;top_markers:Array<{chr:string;pos:number;id:string;p:number;fdr:number}>}):string{
  if(!/^[a-f0-9-]{36}$/i.test(runId))throw new Error("Invalid result reference");
  const best=result.top_markers[0];
  return `I selected **real, published Oryza sativa data** from the Rice Diversity Panel (Zhao et al., 2011), chose the measured **${result.trait}** trait, fetched and verified the corresponding genotype, phenotype, chromosome-position and population-structure files, and ran an actual association study.\n\n`+
  `- ${result.matched} real rice accessions matched to complete phenotypes and ancestry PCs.\n`+
  `- ${result.markers_tested.toLocaleString()} of ${result.markers_source.toLocaleString()} published markers passed QC and association model checks.\n`+
  `- Method: additive linear GWAS with PC1, PC2, PC3, SNP QC, Bonferroni and Benjamini-Hochberg FDR.\n`+
  `- SNPs below adjusted Bonferroni P 0.05: ${result.significant_bonferroni}.\n`+
  (best?`- Strongest association: ${best.id} (chromosome ${best.chr}, position ${best.pos}), P=${best.p.toExponential(3)}, FDR=${best.fdr.toExponential(3)}.\n`:'')+
  `\n**Research result files are ready below this message:** complete association TSV, Manhattan and Q–Q plots, source hashes, methods report and a complete ZIP.\n`+
  `\nThis is exploratory population-PC-adjusted analysis, not a kinship-adjusted mixed-model GWAS or proof of causation. Source DOI: 10.1038/ncomms1467.\n\n[[genithm_rice_gwas_run:${runId}]]`;
}
