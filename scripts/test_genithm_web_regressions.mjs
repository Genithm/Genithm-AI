/* Run the web test files together so a UI refactor reports all regressions,
   not just the first historical source-string contract. No tests are skipped. */
import {spawnSync} from 'node:child_process';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const tests=readdirSync('apps/web/tests').filter(p=>p.endsWith('.test.mjs')).sort();
const run=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap',...tests.map(p=>'tests/'+p)],{cwd:'apps/web',encoding:'utf8',maxBuffer:32*1024*1024,timeout:240000});
const log=(run.stdout??'')+'\n'+(run.stderr??'');
mkdirSync('artifacts/genithm-regressions',{recursive:true});
writeFileSync('artifacts/genithm-regressions/all-web-tests.log',log);
// Show failing names and their short diagnostic lines; retain full assertions
// (which can include entire source files) in the downloadable artifact.
const lines=log.split('\n');let failure=false;
for(const line of lines){
 if(/^\s*not ok /.test(line)){console.log(line);failure=true;}
 else if(/^\s*ok /.test(line)){failure=false;}
 else if(failure && /^\s*(location:|error:|The input did not match|Error:|Cannot find|code:|failureType:)/.test(line)){console.log(line);}
 else if(/^# (tests|pass|fail|skipped|suites|duration_ms)/.test(line)){console.log(line);}
}
if(run.error)console.error(run.error.message);
process.exit(run.status??1);
