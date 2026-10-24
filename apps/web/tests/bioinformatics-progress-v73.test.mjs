import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BIOINFORMATICS_PHASES,MERGED_MILESTONES,PARTIAL_MILESTONES,validateProgramPhases} from '../lib/bioinformatics-program-v73.ts';
const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('V73 checklist matches P0–P10 with no falsely completed end-to-end phase',()=>{
 assert.equal(validateProgramPhases(),true);
 assert.deepEqual(BIOINFORMATICS_PHASES.map(x=>x.id),Array.from({length:11},(_,i)=>'P'+i));
 assert.ok(BIOINFORMATICS_PHASES.every(x=>x.state!=='completed'&&x.remaining.length>0));
 assert.equal(BIOINFORMATICS_PHASES[0].state,'blocked');
 assert.equal(BIOINFORMATICS_PHASES[1].state,'partial');
 assert.equal(BIOINFORMATICS_PHASES[2].state,'partial');
 assert.equal(BIOINFORMATICS_PHASES[3].state,'not_started');
 assert.ok(BIOINFORMATICS_PHASES.find(x=>x.id==='P1').remaining.some(x=>x.includes('DESeq2')));
 assert.ok(BIOINFORMATICS_PHASES.find(x=>x.id==='P10').remaining.some(x=>x.includes('Nextflow')));
});

test('V73 tracks only factually merged historic releases and keeps unfinished modules pending',()=>{
 assert.deepEqual(MERGED_MILESTONES.map(x=>x.version),['V64–V68','V69','V70']);
 assert.ok(PARTIAL_MILESTONES.some(x=>x.version==='V71–V72'));
 assert.ok(PARTIAL_MILESTONES.some(x=>x.version==='V73'));
 const md=read('../../../docs/universal-bioinformatics-checklist-v73.md');
 assert.match(md,/- \[x\] V69/);assert.match(md,/- \[x\] V70/);
 assert.match(md,/- \[ \] V71–V72/);assert.match(md,/- \[ \] V73/);
 assert.match(md,/NO PHASE CERTIFIED COMPLETE/);
 assert.match(md,/0 online large-file verifiers/);
});

test('V73 signed-in progress route explicitly separates code milestones and live operation readiness',()=>{
 const page=read('../app/dashboard/capabilities/page.tsx');
 const rnaseq=read('../app/dashboard/rnaseq/page.tsx');
 assert.match(page,/auth\.getClaims\(\)/);
 assert.match(page,/redirect\("\/login"\)/);
 assert.match(page,/0 of 11 end-to-end scientific program phases/);
 assert.match(page,/\/dashboard\/operations/);
 assert.match(rnaseq,/\/dashboard\/capabilities/);
});
