/** V58: authenticated chat scientific uploads and verified file downloads.
 * User-supplied files are sent only after explicit upload-to-compute consent;
 * originals are deleted immediately after bounded isolated computation.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { chatScienceAvailable, chatScienceRequiredFiles, chatScienceAcceptsRoles, getChatScienceArtifact,
  runChatScience, type ChatScienceKind } from '@/lib/chat-science-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BODY=68*1024*1024;

export async function POST(request:NextRequest){
  const db=await createClient();
  const { data, error }=await db.auth.getClaims();
  const userId=data?.claims?.sub;
  if(error||!userId)return Response.json({error:'Sign in to run scientific analyses.'},{status:401});
  if(!chatScienceAvailable())return Response.json({error:'This deployment has no isolated scientific worker. Run Genithm in a configured private Codespace.'},{status:503});
  const contentLength=Number(request.headers.get('content-length'));
  if(!Number.isFinite(contentLength)||contentLength<=0||contentLength>MAX_BODY)
    return Response.json({error:'Scientific request exceeds the bounded upload size.'},{status:413});
  let form:FormData;
  try {form=await request.formData();}
  catch{return Response.json({error:'Unable to read the scientific file upload.'},{status:400});}
  const projectId=String(form.get('project_id')||'');
  const kind=String(form.get('kind')||'') as ChatScienceKind;
  if(!UUID.test(projectId)||!['gwas','expression','pathways','fastq-qc','vcf-qc','fasta-qc','fastq-trim','orf-scan','genomic-overlap'].includes(kind)||form.get('approved_private_compute')!=='yes')
    return Response.json({error:'Choose a project, supported analysis, and explicitly approve temporary processing of your original research files.'},{status:422});
  // Enforce the signed-in researcher's exact existing Supabase project scope,
  // not client-provided org data or an elevated service-role read.
  const {data:project,error:projectError}=await db.from('projects').select('id').eq('id',projectId).eq('status','active').maybeSingle();
  if(projectError||!project)return Response.json({error:'Project is not accessible to this user.'},{status:403});
  const expected=chatScienceRequiredFiles(kind);
  const names=Object.keys(expected);
  const files:Record<string,File>={};
  for(const [role,ceiling] of Object.entries(expected)){
    const entry=form.get(role);
    if((kind==='fastq-qc'||kind==='fastq-trim')&&role==='r2'&&entry===null)continue;
    if(!(entry instanceof File)||entry.size<1||entry.size>ceiling)
      return Response.json({error:`Please attach a valid ${role} file up to ${Math.ceil(ceiling/1024/1024)} MiB.`},{status:422});
    files[role]=entry;
  }
  const provided=[...form.keys()].filter(k=>!['project_id','kind','approved_private_compute'].includes(k));
  if(!chatScienceAcceptsRoles(kind,provided)||provided.some(k=>!names.includes(k))||
     Object.values(files).reduce((total,file)=>total+file.size,0)>MAX_BODY)
    return Response.json({error:'Scientific input file count or total size is invalid.'},{status:422});
  try{
    const result=await runChatScience(userId,projectId,kind,files,request.signal,()=>{});
    return Response.json({run_id:result.runId,kind,summary:result.summary,files:result.files},
      {headers:{'Cache-Control':'no-store'}});
  }catch(err){
    const message=err instanceof Error?err.message:'Scientific execution failed.';
    const status=/already running/.test(message)?429:/cancelled/.test(message)?409:/not match|must|requires|missing|invalid|exceeds|no variants|No gene|No pathways|Count matrix|Sample design|gene ID|genotype|phenotype/i.test(message)?422:503;
    // Error strings from the reviewed scientific validators are bounded and
    // contain no original dataset contents. Never emit child stderr or file bytes.
    return Response.json({error:message.slice(0,300)},{status,headers:{'Cache-Control':'no-store'}});
  }
}
export async function GET(request:NextRequest){
  const db=await createClient();
  const {data,error}=await db.auth.getClaims();
  const userId=data?.claims?.sub;
  if(error||!userId)return Response.json({error:'Sign in to download your scientific results.'},{status:401});
  const run=request.nextUrl.searchParams.get('run')||'';
  const file=request.nextUrl.searchParams.get('file')||'';
  try{
    const {data:bytes,type,projectId}=await getChatScienceArtifact(userId,run,file);
    // Revoking project membership also immediately revokes access to
    // its temporary research artifacts, even before their TTL expires.
    const {data:project,error:projectError}=await db.from('projects').select('id').eq('id',projectId).eq('status','active').maybeSingle();
    if(projectError||!project)throw new Error('Research project permission is no longer valid.');
    return new Response(new Uint8Array(bytes),{
      headers:{'Content-Type':type+(type.startsWith('text/')||type==='application/json'?'; charset=utf-8':''),
        'Content-Disposition':`attachment; filename="genithm-${file}"`,
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; sandbox"},
    });
  }catch{return Response.json({error:'This result is unavailable, expired, or does not belong to your account.'},{status:404,headers:{'Cache-Control':'no-store'}});}
}
