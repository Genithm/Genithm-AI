/** Refuse stale or unreviewed dependencies before starting a Next.js process. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const approved = (version, minimum) => {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) return false;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
};
export function checkWebRuntime(webDir) {
  const pkg = read(resolve(webDir, 'package.json'));
  const lock = read(resolve(webDir, 'package-lock.json'));
  const versions = {};
  for (const [name, minimum] of [['next', [16, 4, 2]], ['sharp', [0, 35, 5]]]) {
    const expected = name === 'next' ? pkg.dependencies?.next : pkg.overrides?.sharp;
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    const installed = read(resolve(webDir, `node_modules/${name}/package.json`)).version;
    if (!approved(expected, minimum) || locked !== expected || installed !== expected) {
      throw new Error(`${name}: the installed version must match the reviewed package and lockfile.`);
    }
    versions[name] = installed;
  }
  if (lock.packages?.['']?.dependencies?.next !== pkg.dependencies?.next) {
    throw new Error('Next.js package.json and package-lock.json disagree.');
  }
  return versions;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web');
    const versions = checkWebRuntime(webDir);
    console.log(`[Genithm] Verified installed Next.js ${versions.next}; sharp ${versions.sharp}.`);
  } catch {
    // Do not include environment values, arbitrary file contents or filesystem paths.
    console.error('[Genithm] Missing, stale or unapproved web dependencies. Server startup was blocked.');
    console.error('Update your checkout, run npm --prefix apps/web ci from the repository root, then restart Genithm.');
    process.exitCode = 1;
  }
}
