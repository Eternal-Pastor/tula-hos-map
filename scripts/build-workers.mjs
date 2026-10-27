import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const common = [
  'src/engine/vendor/d3-delaunay.min.js',
  'src/engine/vendor/clipper.js',
  'src/engine/territories.js',
  'src/engine/zones.js',
];
const entries = {
  accessibility: [...common, 'src/engine/accessibility.js', 'src/workers/accessibility.js'],
  zones: [...common, 'src/workers/zones.js'],
};

/** Classic, self-contained workers: no eval, Blob source copies or runtime imports. */
export async function buildWorkers(output = resolve(root, 'public/workers')) {
  await mkdir(output, { recursive: true });
  for (const [name, files] of Object.entries(entries)) {
    const sources = await Promise.all(files.map(file => readFile(resolve(root, file), 'utf8')));
    // These verified UMD engines deliberately use their browser/global branch.
    // Transforming the concatenation avoids a bundler selecting CommonJS branches.
    const source = sources.map((code, i) => `\n/* Source: ${files[i]} */\n${code}`).join('\n;\n');
    const result = await transform(source, {
      loader: 'js', target: 'es2022', platform: 'browser',
      define: { module: 'undefined', exports: 'undefined' },
      legalComments: 'inline', minify: false, charset: 'utf8',
    });
    await writeFile(resolve(output, `${name}.js`), `(function () {\n${result.code}\n}).call(globalThis);\n`);
  }
  return Object.keys(entries);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWorkers();
  console.log('Built workers: accessibility, zones');
}
