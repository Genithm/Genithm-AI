import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('V46 detailed reports load only on explicit disclosure and discard unmounted responses',()=>{
 const p=read('../app/dashboard/data/quality-report-viewer.tsx');
 assert.match(p,/open\?<LoadedReport/);assert.match(p,/key=\{props.path\}/);
 assert.match(p,/active=false/);assert.match(p,/if\(active\)/);
 assert.doesNotMatch(p,/localStorage|sessionStorage|fetch\(/);
 assert.match(p,/Retry report/);assert.match(p,/role="alert"/);
});
test('V46 exports use the parent authenticated request, not token query strings',()=>{
 const p=read('../app/dashboard/data/large-data-panel.tsx');
 assert.match(p,/Authorization:"Bearer "/);
 assert.match(p,/await request\(path\+"\?format="\+format\)/);
 assert.match(p,/URL.revokeObjectURL/);
 assert.match(p,/quality_profile_available/);
});
test('V46 visualization labels pooling, encoding assumptions, historical inputs and scientific limits',()=>{
 const p=read('../app/dashboard/data/quality-report-viewer.tsx');
 for(const phrase of ['not drawn to scale','not auto-detected','not a digital signature','Historical result','FastQC pass/fail','all-N reads','Exact profile data','role="img"','aria-labelledby'])assert.ok(p.includes(phrase),phrase);
 assert.match(read('../app/dashboard/data/large-pair-panel.tsx'),/mates.every\(m=>m.quality_profile_available\)/);
});
