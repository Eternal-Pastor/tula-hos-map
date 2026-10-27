import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 2) throw new Error('Run npm run build before packaging.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--name' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$/.test(args[1]))) {
  throw new Error('Usage: node scripts/package.mjs [--name filename.zip]');
}
const output = path.join(root, 'dist', args[1] || `tula-hospital-map-v${manifest.version}.zip`);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'hospital-map-package-'));
try {
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const source = path.resolve(root, relative);
    const target = path.resolve(temporary, relative);
    if (!source.startsWith(root + path.sep) || !target.startsWith(temporary + path.sep)) throw new Error(`Invalid package path: ${relative}`);
    const bytes = await readFile(source);
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Resource changed after build: ${relative}. Run npm run build again.`);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
  }
  await cp(path.join(root, 'package-manifest.json'), path.join(temporary, 'package-manifest.json'));
  await mkdir(path.dirname(output), { recursive: true });
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  // Temporary paths are generated locally and are passed as PowerShell literals.
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-Command', `Compress-Archive -Path (Join-Path ${quote(temporary)} '*') -DestinationPath ${quote(output)} -Force`], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Archive creation failed (${result.status}).`);
  console.log(`Static package: ${output}`);
} finally {
  // Delete only the exact directory returned by mkdtemp inside the OS temp folder.
  if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('hospital-map-package-')) throw new Error('Unexpected temporary package path.');
  await rm(temporary, { recursive: true, force: true });
}
