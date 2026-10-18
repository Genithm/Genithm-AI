/* Actual app routes, isolated loopback auth/data fixtures. NOT production E2E
 * or database RLS testing. No app source replacements or production secrets. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
assert.ok(process.env.GENITHM_PLAYWRIGHT_ROOT,'Use isolated browser tooling');
const tooling=resolve(process.env.GENITHM_PLAYWRIGHT_ROOT,'node_modules');
const {chromium}=await import(pathToFileURL(resolve(tooling,'playwright/index.mjs')).href);
const axeSource=await readFile(resolve(tooling,'axe-core/axe.min.js'),'utf8');
const output=resolve('artifacts/genithm-product-verification');
await mkdir(output,{recursive:true});
const base='http://127.0.0.1:3199',backend='http://127.0.0.1:3198';
const userId='10000000-0000-4000-8000-000000000001',projectId='20000000-0000-4000-8000-000000000001',orgId='30000000-0000-4000-8000-000000000001';
const stamp='2026-01-01T12:00:00Z';
const user={id:userId,email:'ui-fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:stamp};
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const kid=randomUUID(),jwk={...publicKey.export({format:'jwk'}),kid,alg:'ES256',use:'sig'};
const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const payload=encode({alg:'ES256',kid,typ:'JWT'})+'.'+encode({sub:userId,email:user.email,aud:'authenticated',role:'authenticated',iss:backend+'/auth/v1',iat:now,exp:now+3600,aal:'aal1',session_id:randomUUID(),is_anonymous:false});
const token=payload+'.'+sign('sha256',Buffer.from(payload),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
const cookie='base64-'+encode({access_token:token,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:now+3600,user});
const requests=[];let mode='normal';
const pairIds=['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002'];
const pairId='70000000-0000-4000-8000-000000000001';let pairedFixture=null;

const api=createServer((req,res)=>{
 const url=new URL(req.url,backend),authenticated=req.headers.authorization==='Bearer '+token;
 requests.push({method:req.method,path:url.pathname,query:url.search,authenticated});
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Credentials':'true'});res.end(JSON.stringify(value));};
 if(req.method==='OPTIONS')return json(200,{});
 if(url.pathname==='/auth/v1/.well-known/jwks.json')return json(200,{keys:[jwk]});
 if(url.pathname==='/auth/v1/user')return json(authenticated?200:401,authenticated?user:{message:'Invalid fixture token'});
 if(url.pathname==='/auth/v1/logout'&&authenticated)return json(200,{});
 if(url.pathname==='/rest/v1/rpc/is_platform_admin')return json(200,false);
 if(!authenticated)return json(401,{message:'Fixture authorization required'});
 if(url.pathname.startsWith('/api/v1/large-data')){
  if(mode!=='paired-fixture')return json(503,{detail:'paired_data_not_enabled'});
  const uploads=pairIds.map((id,i)=>({id,project_id:projectId,original_filename:`fixture-R${i+1}.fastq`,expected_bytes:256,expected_sha256:String(i+1).repeat(64),data_format:'fastq',state:'ready',checked_bytes:256}));
  if(url.pathname===`/api/v1/large-data/projects/${projectId}`)return json(200,{uploads,limits:{enabled:true,capacity_bytes:1024,charged_bytes:512,max_file_bytes:1024,verifier_ready:true}});
  if(url.pathname===`/api/v1/large-data/pairs/projects/${projectId}`)return json(200,{worker_ready:true,jobs:pairedFixture?[pairedFixture]:[]});
  if(url.pathname==='/api/v1/large-data/pairs'&&req.method==='POST'){
   let text='';req.on('data',x=>text+=x);req.on('end',()=>{const body=JSON.parse(text);assert.equal(body.read1_id,pairIds[0]);assert.equal(body.read2_id,pairIds[1]);
    pairedFixture={id:pairId,title:body.title,state:'queued',read1_id:pairIds[0],read2_id:pairIds[1],read1_bytes:256,read2_bytes:256,checked_read1_bytes:0,checked_read2_bytes:0,error_code:null};json(202,pairedFixture);});return;
  }
  if(url.pathname===`/api/v1/large-data/pairs/${pairId}`&&pairedFixture){
   const metrics={read_count:2,base_count:200,mean_phred:40,q20_bases:200,q30_bases:200,gc_percent:50};
   pairedFixture={...pairedFixture,state:'ready',checked_read1_bytes:256,checked_read2_bytes:256,
    result:{matched_pairs:2,both_mate_annotations_checked:2,identifier_order_only_pairs:0,identical_source_bytes:false,r1:{sha256:'1'.repeat(64),metrics},r2:{sha256:'2'.repeat(64),metrics}},result_sha256:'3'.repeat(64)};
   return json(200,pairedFixture);
  }
  if(url.pathname===`/api/v1/large-data/pairs/${pairId}/report`&&pairedFixture?.state==='ready'){
   res.writeHead(200,{'Content-Type':'text/tab-separated-values','Access-Control-Allow-Origin':base,'Cache-Control':'no-store'});return res.end('Synthetic browser interaction fixture\nMatched ordered pairs\t2\n');
  }
  return json(404,{detail:'not_found'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{message:'Fixture is read-only'});
 const table=url.pathname.split('/').at(-1);
 if(table==='projects'&&mode==='project-error')return json(503,{message:'Fixture project query failure'});
 let rows=[];
 if(table==='projects'&&mode!=='onboarding')rows=[{id:projectId,organization_id:orgId,name:'UI fixture project',description:'Synthetic UI fixture, not research data.',status:'active',created_at:stamp}];
 if(table==='organizations'&&mode!=='onboarding')rows=[{id:orgId,name:'UI fixture team',created_at:stamp}];
 if(table==='ai_conversations'&&mode==='normal')rows=Array.from({length:8},(_,i)=>({id:`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,project_id:projectId,title:`UI fixture conversation ${i+1}`,status:'active',created_at:stamp,updated_at:stamp}));
 if(req.headers.accept?.includes('application/vnd.pgrst.object+json'))return rows.length===1?json(200,rows[0]):json(406,{code:'PGRST116',message:'No fixture record'});
 return json(200,rows);
});
await new Promise(resolve=>api.listen(3198,'127.0.0.1',resolve));
const env={...process.env};for(const key of Object.keys(env))if(/SUPABASE|OPENROUTER|GENITHM|CODESPACE/i.test(key))delete env[key];
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:backend,NEXT_PUBLIC_GENITHM_API_URL:backend,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-not-a-secret',GENITHM_APP_URL:base,GENITHM_SCIENCE_V22_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'});
const child=spawn('npm',['run','dev','--','--hostname','127.0.0.1','--port','3199'],{cwd:resolve('apps/web'),env,stdio:['ignore','pipe','pipe'],detached:true});
let serverLog='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{serverLog+=chunk;});
const results=[],runtimeErrors=[],externalRequests=[];let browser,page;
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS: '+name);}catch(e){results.push({name,passed:false,error:String(e.message)});console.log('FAIL: '+name+': '+String(e.message).slice(0,900));if(page)await page.screenshot({path:resolve(output,'failure-'+results.length+'.png'),fullPage:true}).catch(()=>{});}}
async function visit(path){const response=await page.goto(base+path,{waitUntil:'networkidle'});assert.equal(response.status(),200,path);}
async function scan(label){await page.evaluate(axeSource);const report=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));const violations=report.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));await writeFile(resolve(output,label+'-accessibility.json'),JSON.stringify(violations,null,2));assert.deepEqual(violations,[],label+' accessibility');}
async function downloadText(button){const pending=page.waitForEvent('download');await button.click();return readFile(await(await pending).path(),'utf8');}
const fastq='@PRIVATE_FIXTURE_READ_A/1\nACGTN\n+\nIIIII\n@PRIVATE_FIXTURE_READ_B/1\nGCAA\n+\n5555\n';
const fqFile={name:'ui-fixture.fastq',mimeType:'text/plain',buffer:Buffer.from(fastq)};
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(base+'/login',{signal:AbortSignal.timeout(5000)})).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error('Next server exited');await new Promise(r=>setTimeout(r,1000));}assert.ok(ready,'Next application started');
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='blob:'||url.protocol==='data:')return route.continue();externalRequests.push(url.origin);return route.abort();});
 page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 await check('Anonymous protected pages redirect to sign-in',async()=>{for(const path of ['/dashboard/ai','/dashboard/projects','/dashboard/data','/dashboard/results']){await page.goto(base+path,{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/login');}const r=await context.request.post(base+'/api/ai/chat',{data:{message:'fixture unauthorized check'}});assert.equal(r.status(),401);});
 for(const path of ['/login','/signup'])await check(path+' real public page accessibility and 320px layout',async()=>{await visit(path);await scan(path.slice(1));await page.setViewportSize({width:320,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path+' overflow');await scan(path.slice(1)+'-mobile');await page.screenshot({path:resolve(output,path.slice(1)+'-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});});
 await context.addCookies([{name:'sb-127-auth-token',value:cookie,url:base,sameSite:'Lax'}]);
 const routes=['/dashboard/ai','/dashboard/projects','/dashboard/data','/dashboard/apps','/dashboard/results','/dashboard/fastq-qc','/dashboard/variant-qc','/dashboard/notebook'];
 for(const path of routes)await check(path+' actual authenticated route and accessibility',async()=>{await page.setViewportSize({width:1440,height:1000});await visit(path);assert.equal(new URL(page.url()).pathname,path,'Signed fixture session accepted by real auth code');assert.equal(await page.locator('main').count(),1);assert.ok(await page.locator('h1').isVisible());const label=path.split('/').at(-1);await page.screenshot({path:resolve(output,label+'-desktop.png'),fullPage:true});await scan(label);});
 await check('Desktop zoom and narrow desktop windows retain accessible layout',async()=>{const overflow=[];for(const path of routes){await visit(path);for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);const extent=await page.evaluate(()=>document.documentElement.scrollWidth);if(extent>width+1)overflow.push({path,width,extent});}}assert.deepEqual(overflow,[]);});
 await check('Narrow desktop search has an accessible name and closes with Escape',async()=>{await visit('/dashboard/ai');await page.setViewportSize({width:390,height:844});await scan('ai-mobile');const search=page.getByRole('button',{name:/Find a page|Search pages/});await search.click();await page.locator('#genithm-search-input').fill('FASTQ');assert.equal(await page.locator('.genithm-search-results a').count(),1);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);});
 await check('Actual chat starter prefills composer and history expands/filters',async()=>{await page.setViewportSize({width:1440,height:1000});await visit('/dashboard/ai');await page.getByRole('button',{name:/Plan my research/}).click();assert.match(await page.getByRole('textbox',{name:'Message Genithm',exact:true}).inputValue(),/rigorous, reproducible/);const history=page.locator('a[href^="/dashboard/ai/4000"]');assert.equal(await history.count(),6);await page.getByRole('button',{name:/Show.*more|Show all/i}).click();assert.equal(await history.count(),8);await page.getByRole('searchbox',{name:'Search conversations'}).fill('conversation 8');assert.equal(await history.count(),1);});
 await check('Inaccessible project blocks the chat composer',async()=>{await visit('/dashboard/ai?project=50000000-0000-4000-8000-000000000001');assert.match(await page.locator('main').getByRole('alert').innerText(),/project is not available/);assert.equal(await page.getByRole('textbox',{name:'Message Genithm',exact:true}).count(),0);});
 await check('Project failure is not silently presented as a new workspace',async()=>{mode='project-error';try{await visit('/dashboard/ai');assert.match(await page.locator('main').getByRole('alert').innerText(),/Workspace access could not be loaded/);assert.equal(await page.getByRole('button',{name:'Create lab',exact:true}).count(),0);}finally{mode='normal';}});
 await check('New account onboarding uses actual forms',async()=>{mode='onboarding';try{await visit('/dashboard/ai');assert.ok(await page.getByRole('button',{name:'Create lab',exact:true}).isVisible());assert.ok(await page.getByLabel('Lab or team name').isVisible());}finally{mode='normal';}});
 await check('Real local FASTQ analysis and TSV without network upload',async()=>{await visit('/dashboard/fastq-qc');await page.locator('input[type=file]').first().setInputFiles(fqFile);const before=requests.filter(r=>r.method==='POST').length;await page.getByRole('button',{name:/Analyze actual FASTQ/}).click();await page.getByRole('heading',{name:'Export and save quality results'}).waitFor();const report=await downloadText(page.getByRole('button',{name:/Download complete per-cycle TSV/}));assert.match(report,/Read count\t2/);assert.match(report,/Q30 bases\t5/);assert.doesNotMatch(report,/PRIVATE_FIXTURE_READ|ACGTN|IIIII/);assert.equal(requests.filter(r=>r.method==='POST').length,before);await scan('fastq-results');});
 await check('FASTQ clear removes native input and permits the same file again',async()=>{await page.getByRole('button',{name:'Clear results',exact:true}).click();assert.equal(await page.locator('input[type=file]').first().evaluate(input=>input.files.length),0);await page.locator('input[type=file]').first().setInputFiles(fqFile);assert.ok(await page.getByRole('button',{name:/Analyze actual FASTQ/}).isEnabled());});
 await check('Real local VCF analysis, TSV and clear without network upload',async()=>{await visit('/dashboard/variant-qc');const vcf='##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t10\t.\tA\tG\t50\tPASS\t.\nchr1\t11\t.\tC\tA\t40\tPASS\t.\n';await page.locator('input[type=file]').setInputFiles({name:'ui-fixture.vcf',mimeType:'text/plain',buffer:Buffer.from(vcf)});const before=requests.filter(r=>r.method==='POST').length;await page.getByRole('button',{name:/Run real VCF QC/}).click();await page.getByRole('heading',{name:'Keep your QC evidence'}).waitFor();const report=await downloadText(page.getByRole('button',{name:/Download QC summary TSV/}));assert.match(report,/SNV\t2/);assert.equal(requests.filter(r=>r.method==='POST').length,before);await scan('vcf-results');await page.getByRole('button',{name:'Clear local analysis'}).click();assert.equal(await page.locator('input[type=file]').evaluate(input=>input.files.length),0);});
 await check('Phones and tablets receive desktop-required instead of the workspace',async()=>{
   for(const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile Safari/604.1','Mozilla/5.0 (Linux; Android 15; Tablet) AppleWebKit/537.36']){
     const mobile=await browser.newContext({userAgent:ua,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
     await mobile.addCookies([{name:'sb-127-auth-token',value:cookie,url:base,sameSite:'Lax'}]);
     const phone=await mobile.newPage();
     try{for(const route of ['/login','/signup','/dashboard/ai','/dashboard/fastq-qc','/preview']){
       await phone.goto(base+route+'?private-locator=must-not-be-forwarded',{waitUntil:'networkidle'});
       assert.equal(new URL(phone.url()).pathname,'/desktop-required');
       assert.equal(new URL(phone.url()).search,'');
       assert.ok(await phone.getByRole('heading',{name:'Open Genithm on a desktop or laptop'}).isVisible());
       assert.equal(await phone.locator('input[type=file],textarea').count(),0);
     }}finally{await mobile.close();}
   }
 });
 await check('Paired data controls, opt-in networking and report download against isolated API fixture',async()=>{
  mode='paired-fixture';pairedFixture=null;
  try{
   await page.setViewportSize({width:1440,height:1000});const before=requests.filter(r=>r.path.startsWith('/api/v1/large-data')).length;
   await visit('/dashboard/data');assert.equal(requests.filter(r=>r.path.startsWith('/api/v1/large-data')).length,before);
   await page.locator('summary').filter({hasText:'Large files: resumable private upload'}).click();
   await page.locator('summary').filter({hasText:'Check paired-end data (R1 + R2)'}).click();
   await page.getByLabel('Read 1',{exact:true}).selectOption(pairIds[0]);
   await page.getByLabel('Read 2',{exact:true}).selectOption(pairIds[1]);
   await page.getByLabel('Analysis title',{exact:true}).fill('Paired browser fixture');
   const run=page.getByRole('button',{name:'Approve and run paired QC',exact:true});await run.waitFor();
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Approve and run paired QC'&&!b.disabled));
   await run.click();await page.getByRole('button',{name:'Cancel paired check',exact:true}).waitFor();
   await page.getByRole('button',{name:'Refresh paired status',exact:true}).click();
   await page.getByText('2 ordered pairs matched.',{exact:true}).waitFor();
   const report=await downloadText(page.getByRole('button',{name:'Download paired QC report',exact:true}));
   assert.match(report,/Matched ordered pairs\t2/);await scan('paired-controls');
  }finally{mode='normal';await visit('/dashboard/data');}
 });
 await check('No uncaught browser errors or external service requests',async()=>{assert.deepEqual(runtimeErrors,[]);assert.deepEqual(externalRequests,[]);});
}finally{
 await browser?.close();try{process.kill(-child.pid,'SIGTERM');}catch{}await new Promise(r=>api.close(r));
 await writeFile(resolve(output,'server.log'),serverLog);
 await writeFile(resolve(output,'results.json'),JSON.stringify({scope:'Actual application routes with isolated loopback auth/data fixtures; not production E2E or database RLS testing.',results,runtimeErrors,externalRequests},null,2));
}
if(results.some(result=>!result.passed))process.exitCode=1;
