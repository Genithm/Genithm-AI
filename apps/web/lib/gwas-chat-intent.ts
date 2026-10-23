/** Genuine GWAS execution requests route to Genithm's local, bounded analysis lab.
 * Knowledge questions still go through the normal Gemini/Groq conversation path.
 * This router never claims to have run an analysis and never extracts file bytes.
 */
const topic = /\b(?:gwas|genome[\s-]*wide association(?: study| studies| analysis| analyses)?)\b/i;
const action = /\b(?:run|perform|conduct|analy[sz]e|start|execute|compute|calculate|carry out|do|process|test|undertake)\b/i;
const question = /^(?:what|why|how|when|where|explain|define|describe|compare|summarize|teach)\b/i;
export function isGwasExecutionRequest(message: string):boolean {
  const text=message.trim();
  if(!text||text.length>8000||!topic.test(text))return false;
  if(question.test(text)&&!action.test(text))return false;
  return action.test(text)||/^(?:gwas|genome[\s-]*wide association(?: study| studies| analysis| analyses)?)\s*[.!?]?$/i.test(text);
}
export function gwasInputGuidance():string {
  return "Genithm now has a real GWAS Lab for bounded genotype–phenotype association analysis: /dashboard/gwas. " +
    "Open the lab, select an uncompressed multisample VCF v4 (diploid biallelic GT) or dosage TSV/CSV matrix, and a phenotype TSV/CSV with sample_id, phenotype, and optional numeric ancestry PCs/covariates. " +
    "Choose quantitative linear regression or 0/1 case–control logistic score testing and click Analyze. " +
    "The lab computes QC, association P-values, multiple-testing corrections, Manhattan/Q–Q plots and an exportable report from your actual files in your browser. " +
    "Nothing has been executed by this chat message. No genotype or phenotype file is sent to the AI model or the server. " +
    "Limits: 64 MiB genotype input, 2,000 samples, 50,000 variants, 12 million sample–variant cells. " +
    "Larger cohorts, PLINK binary files, mixed models or imputation still require validated dedicated compute infrastructure. "+
    "Do not interpret these exploratory associations as clinical conclusions.";
}
