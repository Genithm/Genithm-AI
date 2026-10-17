import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Mobile header controls retain names when visible desktop labels are hidden',()=>{
 const frame=read('../components/genithm-workspace-frame.tsx');
 assert.match(frame,/className="genithm-search-trigger" aria-label="Find a page or scientific tool"/);
 assert.match(frame,/<summary aria-label=\{`Your workspace \$\{email\} account menu`\}/);
 const css=read('../app/dashboard/workspace-chrome.css');
 assert.match(css,/\.genithm-search-trigger\{[^}]*color:var\(--g-ink\)/);
});

test('FASTQ clear resets both native file inputs and stale snapshot titles',()=>{
 const workbench=read('../app/dashboard/fastq-qc/fastq-qc-workbench.tsx');
 for(const token of ['ref={r1Input}','ref={r2Input}','r1Input.current.value=""','r2Input.current.value=""','onClick={clearFiles}','setTitle("")'])assert.ok(workbench.includes(token),token);
 assert.match(read('../app/dashboard/variant-qc/variant-qc-workbench.tsx'),/function clear\(\)\s*\{[^}]*setTitle\(""\)/);
});

test('Verification uses actual routes and never installs an authentication bypass',()=>{
 const browser=read('../../../scripts/test_genithm_product_browser.mjs');
 assert.match(browser,/generateKeyPairSync\('ec'/);
 assert.match(browser,/api\.listen\(3198,'127\.0\.0\.1'/);
 assert.match(browser,/\/dashboard\/ai/);
 assert.match(browser,/PRIVATE_FIXTURE_READ/);
 assert.match(browser,/context\.route\(/);
 assert.doesNotMatch(browser,/writeFile\([^\n]*page\.tsx/);
 // Existing comments document Codespaces sample mode. Inspect executable
 // statements, not that documentation, for test-only auth bypasses.
 const proxy=read('../proxy.ts').replace(/^\s*\/\/.*$/gm,'');
 assert.doesNotMatch(proxy,/GENITHM_UI_CONTRACT|fixture|3198/);
 assert.match(proxy,/return updateSession\(request\)/);
});

test('Permanent verification is read-only, audits the committed lockfile and builds without deploying',()=>{
 const workflow=read('../../../.github/workflows/genithm-verification.yml');
 assert.match(workflow,/contents: read/);
 assert.match(workflow,/npm audit --json/);
 assert.match(workflow,/run cf:build/);
 assert.doesNotMatch(workflow,/contents: write|audit fix|cf:deploy|secrets\./);
});
