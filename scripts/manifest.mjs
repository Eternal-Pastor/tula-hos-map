import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function tree(relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const lists = await Promise.all(entries.filter(entry => !['osrm', 'runtime', '__pycache__'].includes(entry.name)).map(entry => {
    const name = `${relative}/${entry.name}`;
    return entry.isDirectory() ? tree(name) : entry.isFile() ? [name] : [];
  }));
  return lists.flat();
}

const runtimeRequired = (await tree('hospital-map')).sort();
for (const required of ['hospital-map/index.html', 'hospital-map/developer.html', 'hospital-map/viewer-data.js']) {
  if (!runtimeRequired.includes(required)) throw new Error(`Build resource is missing: ${required}`);
}
if (!runtimeRequired.some(name => name.startsWith('hospital-map/assets/') && name.endsWith('.js'))) throw new Error('Run the Vite production build first.');
const names = [...runtimeRequired, 'START.cmd', 'scripts/Start-Map.ps1', 'scripts/LocalMapServer.cs', 'scripts/Verify-Static.ps1', 'README.md', ...await tree('docs'), 'data/full-project.json', ...await tree('local-routing')].sort();
const files = {};
for (const name of names) {
  const bytes = await readFile(path.join(root, name));
  files[name] = { bytes: bytes.byteLength, sha256: sha256(bytes) };
}
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = {
  schemaVersion: 2,
  application: 'tula-hospital-map',
  version: packageJson.version,
  build: sha256(JSON.stringify(files)).slice(0, 16),
  runtimeRequired,
  files,
};
await writeFile(path.join(root, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Static manifest: ${runtimeRequired.length} runtime resources; build ${manifest.build}`);
