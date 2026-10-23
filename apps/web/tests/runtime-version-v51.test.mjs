import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWebRuntime } from '../../../scripts/check_web_runtime.mjs';

function fixture(fn, versions={}) {
  const root=mkdtempSync(join(tmpdir(),'genithm-version-'));
  const next=versions.next || '16.4.2'; const sharp=versions.sharp || '0.35.5';
  const write=(path,value)=>writeFileSync(join(root,path),JSON.stringify(value));
  mkdirSync(join(root,'node_modules/next'),{recursive:true});
  mkdirSync(join(root,'node_modules/sharp'),{recursive:true});
  write('package.json',{dependencies:{next},overrides:{sharp}});
  write('package-lock.json',{packages:{'':{dependencies:{next}},'node_modules/next':{version:versions.locked || next},'node_modules/sharp':{version:sharp}}});
  write('node_modules/next/package.json',{version:versions.installed || next});
  write('node_modules/sharp/package.json',{version:sharp});
  try { fn(root); } finally { rmSync(root,{recursive:true,force:true}); }
}
test('installed versions must match reviewed pins',()=>fixture(root=>assert.deepEqual(checkWebRuntime(root),{next:'16.4.2',sharp:'0.35.5'})));
test('stale installed Next 16.4.0 is refused',()=>fixture(root=>assert.throws(()=>checkWebRuntime(root)),{installed:'16.4.0'}));
test('old checkout cannot approve the affected version',()=>fixture(root=>assert.throws(()=>checkWebRuntime(root)),{next:'16.4.0'}));
test('unreviewed lockfile is refused',()=>fixture(root=>assert.throws(()=>checkWebRuntime(root)),{locked:'16.4.1'}));
test('old sharp is refused',()=>fixture(root=>assert.throws(()=>checkWebRuntime(root)),{sharp:'0.35.4'}));
test('missing installation is refused',()=>fixture(root=>{rmSync(join(root,'node_modules'),{recursive:true});assert.throws(()=>checkWebRuntime(root));}));
test('pre-release dependencies are not silently accepted',()=>fixture(root=>assert.throws(()=>checkWebRuntime(root)),{next:'16.4.3-canary.1'}));
test('npm dev, start and build use the guard',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 for(const command of ['predev','prestart','prebuild']) assert.equal(pkg.scripts[command],'node ../../scripts/check_web_runtime.mjs');
});
