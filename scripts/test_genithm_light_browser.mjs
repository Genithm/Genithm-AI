/* UI-only temporary harness. It imports the real components, but never reaches
 * Supabase or executes a job. The route exists only while this CI process runs. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve('apps/web/node_modules/playwright/index.mjs')).href);
const route=resolve('apps/web/app/__genithm_ui_contract');
const output=resolve('artifacts/genithm-light');
await mkdir(route,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(resolve(route,'page.tsx'),`import {notFound} from 'next/navigation';
import {GenithmWorkspaceFrame} from '@/components/genithm-workspace-frame';
import {GenithmToolDock} from '@/components/genithm-tool-dock';
import {GenithmBrand} from '@/components/genithm-brand';
import '../dashboard/workspace-chrome.css';
export default function UiContract(){
 if(process.env.GENITHM_UI_CONTRACT!=='1'||process.env.NODE_ENV!=='development')notFound();
 return <GenithmWorkspaceFrame email="ui-check@example.invalid" isPlatformAdmin={false}>
  <main className="genithm-page"><header className="genithm-page-heading"><div><div className="genithm-page-kicker">UI TEST / NO RESEARCH DATA</div><h1>Your research workspace</h1><p>The real shared navigation and light components, with an empty test workspace.</p></div></header>
  <div className="genithm-card-grid"><article className="genithm-card" data-ui-surface><GenithmBrand/><h2>Start with a question</h2><p>No fictional analysis results are shown in this UI test.</p><a className="button primary" href="/dashboard/ai">Open AI Chat</a></article><article className="genithm-card" data-ui-surface><h2>Your results</h2><p>No scientific jobs recorded yet.</p></article></div>
  <GenithmToolDock projectCount={0} scienceReady={false} recentRuns={[]} recentRunsError={false}/></main>
 </GenithmWorkspaceFrame>;
}`);
const child=spawn('npm',['run','dev','--','--hostname','127.0.0.1','--port','3099'],{cwd:resolve('apps/web'),env:{...process.env,GENITHM_UI_CONTRACT:'1',NEXT_TELEMETRY_DISABLED:'1'},stdio:'inherit',detached:true});
let browser;
try{
 let ready=false;for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:3099/__genithm_ui_contract');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
 assert.ok(ready,'UI harness started');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:3099/__genithm_ui_contract',{waitUntil:'networkidle'});
 assert.equal(await page.locator('.genithm-primary-links > a').count(),6);
 assert.equal(await page.locator('.genithm-dock-actions > a').count(),3);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
 assert.equal(await page.locator('[data-ui-surface]').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.ok(await page.locator('.genithm-brand img').first().evaluate(img=>img.complete&&img.naturalWidth>0),'Supplied logo loads');
 await page.locator('.genithm-search-trigger').click();
 await page.locator('#genithm-search-input').fill('FASTQ');
 assert.equal(await page.locator('.genithm-search-results a').count(),1);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.genithm-search-dialog').evaluate(d=>d.open),false);
 await page.keyboard.press('Control+k');
 assert.equal(await page.locator('.genithm-search-dialog').evaluate(d=>d.open),true);
 await page.keyboard.press('Escape');
 await page.screenshot({path:resolve(output,'workspace-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No mobile horizontal overflow');
 await page.locator('.genithm-mobile-menu').click();
 assert.equal(await page.locator('.genithm-mobile-menu').getAttribute('aria-expanded'),'true');
 await page.screenshot({path:resolve(output,'workspace-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: light surfaces, supplied logo, six-item navigation, three actions, search, keyboard and mobile layout.');
}finally{
 await browser?.close();try{process.kill(-child.pid,'SIGTERM');}catch{}
 await rm(route,{recursive:true,force:true});
}
