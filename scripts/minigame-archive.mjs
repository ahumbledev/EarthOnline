import { crc32 } from 'node:zlib';

/** Portable stored ZIP writer for trusted creator-kit files, not an archive reader. */
export function createMinigameZip(entries) {
  const local = [], central = [], names = new Set(); let offset = 0;
  if (!entries.length || entries.length > 256) throw new Error('ZIP needs 1–256 files.');
  for (const [filename, content] of entries) {
    if (!/^[a-zA-Z0-9_.\-/]+$/.test(filename) || filename.startsWith('/') || filename.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe ZIP path: ${filename}`);
    if (names.has(filename.toLowerCase())) throw new Error(`Duplicate ZIP path: ${filename}`);
    names.add(filename.toLowerCase());
    const name = Buffer.from(filename), data = Buffer.from(content), checksum = crc32(data);
    if (data.length > 64 * 1024 * 1024) throw new Error(`File too large: ${filename}`);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE((3 << 8) | 20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(33, 14); record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100600 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
