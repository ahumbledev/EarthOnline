import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzip, brotliCompress, zstdCompress, constants } from 'node:zlib';

const gzipAsync = promisify(gzip), brotliAsync = promisify(brotliCompress), zstdAsync = promisify(zstdCompress);
const formats = new Set(['.html', '.js', '.css', '.json', '.glb', '.gltf', '.bin', '.wasm']);
/** Keep the source, with optional sidecars only when they make transfer smaller. */
export async function precompress(directory) {
  const bytes = { original: 0, gzip: 0, brotli: 0, zstd: 0 }, files = { gzip: 0, brotli: 0, zstd: 0 };
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile() || !formats.has(extname(entry.name))) continue;
      const original = await readFile(path);
      if (original.length < 1024) continue;
      bytes.original += original.length;
      const results = await Promise.all([
        gzipAsync(original, { level: 9 }),
        brotliAsync(original, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
        zstdAsync(original, { params: { [constants.ZSTD_c_compressionLevel]: 15 } }),
      ]);
      for (const [index, [name, suffix]] of [['gzip', 'gz'], ['brotli', 'br'], ['zstd', 'zst']].entries()) {
        const result = results[index];
        if (result.length < original.length) {
          await writeFile(`${path}.${suffix}`, result); files[name]++; bytes[name] += result.length;
        } else { await rm(`${path}.${suffix}`, { force: true }); bytes[name] += original.length; }
      }
    }
  }
  await visit(directory);
  return { bytes, files };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  console.log(JSON.stringify(await precompress(process.argv[2] ?? 'dist')));
}
