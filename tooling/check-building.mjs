import { open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { validateUgcPackage, UGC_LIMITS, UGC_PARCELS } from '../server/buildings/validate.mjs';

const [parcel, directory] = process.argv.slice(2);
if (!directory || !UGC_PARCELS.some(plot => plot.id === parcel)) {
  console.error('Usage: node tooling/check-building.mjs <parcel> <unpacked directory>\nParcels: ' + UGC_PARCELS.map(plot => plot.id).join(', '));
  process.exitCode = 2;
} else {
  const files = new Map();
  let total = 0, entries = 0;
  async function collect(prefix = '') {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (++entries > UGC_LIMITS.files || relative.length > 200) throw new Error('Too many entries or path too long');
      if (entry.isDirectory()) { await collect(relative); continue; }
      if (!entry.isFile()) throw new Error('Only regular files and directories may be included');
      const file = await open(join(directory, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > UGC_LIMITS.fileBytes || total + stat.size > UGC_LIMITS.unpackedBytes) throw new Error('File limit exceeded');
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) throw new Error('File changed during validation');
          offset += result.bytesRead;
        }
        if ((await file.stat()).size !== bytes.length) throw new Error('File changed during validation');
        files.set(relative, bytes); total += bytes.length;
      } finally { await file.close(); }
    }
  }
  try {
    await collect();
    const { manifest, report } = await validateUgcPackage(files, parcel);
    console.log(JSON.stringify({ name: manifest.name, ...report }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
