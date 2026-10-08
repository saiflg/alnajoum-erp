#!/usr/bin/env node
/**
 * Software bill of materials (Phase 22): every production dependency of the API and the web app, with its
 * exact resolved version, as CycloneDX 1.5 JSON. Generated from the lockfile through `pnpm list`, so it is what
 * is actually installed, not what package.json hopes for.
 *
 *   node scripts/sbom.mjs [--out docs/sbom.cdx.json]
 *
 * Pair it with `pnpm audit --prod` for known vulnerabilities in the same set.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const outArg = process.argv.indexOf('--out');
const out = outArg > -1 ? process.argv[outArg + 1] : 'docs/sbom.cdx.json';

const raw = execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json', '-r'], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
  shell: process.platform === 'win32',
});
const projects = JSON.parse(raw);

const components = new Map(); // purl -> component
const walk = (deps, owner) => {
  for (const [name, info] of Object.entries(deps ?? {})) {
    const version = info.version;
    if (!version || version.startsWith('link:') || version.startsWith('file:')) continue;
    const scope = name.startsWith('@') ? name.replace('@', '%40') : name;
    const purl = `pkg:npm/${scope}@${version}`;
    const existing = components.get(purl);
    if (existing) existing.usedBy.add(owner);
    else
      components.set(purl, {
        type: 'library',
        name,
        version,
        purl,
        'bom-ref': purl,
        ...(info.resolved ? { externalReferences: [{ type: 'distribution', url: info.resolved }] } : {}),
        usedBy: new Set([owner]),
      });
    walk(info.dependencies, owner);
  }
};
for (const project of projects) walk(project.dependencies, project.name);

const list = [...components.values()]
  .sort((a, b) => a.purl.localeCompare(b.purl))
  .map(({ usedBy, ...c }) => ({ ...c, properties: [{ name: 'alnajoum:used-by', value: [...usedBy].sort().join(',') }] }));

writeFileSync(
  out,
  JSON.stringify(
    {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: { type: 'application', name: 'alnajoum-erp', version: '0.1.0' },
        tools: [{ name: 'scripts/sbom.mjs (pnpm list)' }],
      },
      components: list,
    },
    null,
    2,
  ),
);
console.log(`SBOM written to ${out}: ${list.length} production components across ${projects.length} workspace packages`);
