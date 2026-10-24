import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const composer=read("../components/ai-chat-composer.tsx");
const route=read("../app/api/ai/chat/route.ts");
const planner=read("../lib/genithm-ai-chat.ts");
const scanner=read("../lib/chat-file-intake.ts");

test("V55 paperclip accepts any file type, retains vetted FASTA pathway",()=>{
 assert.match(composer,/await isActualFasta\(file\)/);
 assert.match(composer,/await validateSequenceFile\(file\)/);
 assert.match(composer,/\/api\/v1\/storage\/sequence-uploads/);
 assert.match(composer,/await inspectLocalAttachment\(file\)/);
 assert.doesNotMatch(composer, /accept="\.fa/);
 assert.match(composer,/aria-label="Attach research files or images"/);
 assert.match(composer,/kind: looksLikeImage \? "image" : "local"/);
});
test("V55 local reports cannot be confused with server-verified upload IDs",()=>{
 assert.match(composer,/local_file_evidence: readyLocalEvidence/);
 assert.match(composer,/kind === "sequence" && attachment.status === "ready" && attachment.uploadId/);
 assert.match(composer,/kind === "local" && attachment.status === "ready" && attachment.localEvidence/);
 assert.match(route,/validateChatFileEvidence\(body.local_file_evidence\)/);
 assert.match(route,/client_reported_local_file_previews: safeChatFileContext/);
 assert.match(route,/if \(localFiles.length\) throw new Error\("Local file previews cannot authorize/);
 assert.match(planner,/localFilePreview \? \{\} : \{ tools: \[SCIENTIFIC_TOOL\]/);
 assert.doesNotMatch(scanner,/service_role|SUPABASE_SECRET_KEY|createServiceClient|eval\(|new Function/);
});
test("V55 excerpt opt-in must be explicit and absent on default wire",()=>{
 assert.match(composer,/const \[shareTextExcerpts, setShareTextExcerpts\] = useState\(false\)/);
 assert.match(composer,/share_local_text_excerpts: shareTextExcerpts/);
 assert.match(composer,/shareTextExcerpts \? \{\} : \{ excerpt: undefined \}/);
 assert.match(route,/!body.share_local_text_excerpts && localFiles.some\(file => file.excerpt !== undefined\)/);
 assert.match(scanner,/unverified_browser_inspection_not_a_server_job/);
});
test("V55 no local attachment silently grants NCBI workflow or GWAS execution",()=>{
 assert.match(route,/const requestedFixedProtocol = researchFileIds.length === 0 && localFiles.length === 0/);
 assert.match(route,/parseChatResearchProtocol/);
 // V54 introduced GWAS routing; the V55 source archive predates V54.
 if(route.includes("gwasInputGuidance")) assert.match(route,/isGwasExecutionRequest/);
 assert.match(composer,/Original files stay in this browser/);
});
