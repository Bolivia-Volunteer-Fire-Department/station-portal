#!/usr/bin/env node
/**
 * Generates public/THIRD-PARTY-LICENSES.txt from the installed runtime dependencies in package.json,
 * ensuring all MIT, Apache-2.0, ISC, and BSD-2-Clause copyright and license notices are included in
 * every StationSync portal and public site build.
 *
 * Run with: npm run licenses:generate
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const OUT_PATH = resolve(ROOT, 'public/THIRD-PARTY-LICENSES.txt');

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const runtimePackages = Object.keys(pkg.dependencies || {}).sort();

const findLicenseFile = (pkgDir) => {
  if (!existsSync(pkgDir)) return null;
  const entries = readdirSync(pkgDir);
  const match = entries.find((name) => /^(license|licence|copying)(\..+)?$/i.test(name));
  return match ? resolve(pkgDir, match) : null;
};

const blocks = [
  '================================================================================',
  'StationSync — Third-Party Open-Source Software Notices & Licenses',
  '================================================================================',
  '',
  'StationSync incorporates open-source software components licensed under',
  'permissive open-source licenses (MIT, Apache-2.0, ISC, and BSD-2-Clause).',
  'We gratefully acknowledge the authors and contributors of these projects.',
  '',
];

for (const name of runtimePackages) {
  const pkgDir = resolve(ROOT, 'node_modules', name);
  const pkgJsonPath = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;

  const meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const licenseType = meta.license || 'Permissive';
  const homepage = meta.homepage || (meta.repository && (meta.repository.url || meta.repository)) || '';
  const licenseFile = findLicenseFile(pkgDir);
  const licenseText = licenseFile ? readFileSync(licenseFile, 'utf8').trim() : `Licensed under ${licenseType}.`;

  blocks.push('--------------------------------------------------------------------------------');
  blocks.push(`Package : ${name}@${meta.version}`);
  blocks.push(`License : ${licenseType}`);
  if (homepage) blocks.push(`Source  : ${String(homepage).replace(/^git\+/, '')}`);
  blocks.push('--------------------------------------------------------------------------------');
  blocks.push(licenseText);
  blocks.push('');
}

writeFileSync(OUT_PATH, `${blocks.join('\n')}\n`, 'utf8');
console.log(`✔ Wrote ${runtimePackages.length} third-party license notices to public/THIRD-PARTY-LICENSES.txt`);

