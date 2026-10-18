import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('V45 uses existing authenticated API under explicit opt-in disclosure',()=>{
 const panel=read('../app/dashboard/data/large-pair-panel.tsx');
 const parent=read('../app/dashboard/data/large-data-panel.tsx');
 assert.match(panel,/open\?<PairControls/);
 assert.match(panel,/key=\{props.project\}/);
 assert.match(panel,/"\/pairs"/);
 assert.match(parent,/sources=\{overview.uploads\} call=\{call\}/);
 assert.match(parent,/Authorization:"Bearer "/);
 assert.doesNotMatch(panel,/fetch\(|localStorage|sessionStorage|Math.random/);
});
test('V45 gates jobs on distinct verified FASTQ sources and reports real statuses only',()=>{
 const p=read('../app/dashboard/data/large-pair-panel.tsx');
 assert.match(p,/s.state==="ready"/);
 assert.match(p,/\["fastq","fastq.gz"\]/);
 assert.match(p,/r1===r2/);
 assert.match(p,/request.current\?\?=crypto.randomUUID\(\)/);
 assert.match(p,/job.state==="ready"&&job.summary/);
 assert.match(p,/sources_available===false/);
 assert.match(p,/biological pairing or identifier uniqueness/);
 assert.match(p,/Cancel pair validation/);
});
