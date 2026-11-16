import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file));
const json = async file => JSON.parse(await read('public/optimization/' + file));
const output = path.join(root, 'src/optimization/generated');
await mkdir(output, { recursive: true });
const [registry, gridMeta, preparedMeta] = await Promise.all([json('facilities.json'), json('grid-meta.json'), json('prepared-meta.json')]);
await writeFile(path.join(output, 'manifest.ts'), `// Built from the project's prepared data.\nexport const registry = ${JSON.stringify(registry)};\nexport const gridMeta = ${JSON.stringify(gridMeta)};\nexport const preparedMeta = ${JSON.stringify(preparedMeta)};\n`);
for (const [name, file, expected] of [['grid', 'grid.json.gz', gridMeta.checksum],
  ['auto', preparedMeta.results.auto.file, preparedMeta.results.auto.checksum],
  ['pedestrian', preparedMeta.results.pedestrian.file, preparedMeta.results.pedestrian.checksum]]) {
  const bytes = await read('public/optimization/' + file), checksum = createHash('sha256').update(gunzipSync(bytes)).digest('hex');
  if (checksum !== expected) throw new Error(`Prepared data checksum mismatch: ${file}`);
  await writeFile(path.join(output, name + '.ts'), `// Prepared snapshot for the static application.\nexport default ${JSON.stringify({ encoding: 'gzip-base64', checksum, data: bytes.toString('base64') })};\n`);
}
console.log('Embedded optimization grid and both prepared results.');
