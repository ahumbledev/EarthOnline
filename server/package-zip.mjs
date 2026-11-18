import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { extname } from 'node:path';

const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_archive' });

/** Produce a standard uncompressed ZIP for direct JSON submissions; no external program runs. */
export function createStoredZip(files) {
  const local = [], central = []; let offset = 0;
  for (const [path, data] of files) {
    const name = Buffer.from(path), bytes = Buffer.from(data), checksum = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(3 << 8 | 20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100600 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42); central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** Read every entry through yauzl's size-checked stream; never extract archive paths directly. */
export async function unpackPackageZip(bytes, { limits, roots, rootFiles, extensions }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > limits.archiveBytes || bytes.readUInt32LE(0) !== 0x04034b50) throw invalid('Expected a nonempty ZIP within the upload size limit.');
  return new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: true }, (error, zip) => {
      if (error) { reject(invalid('Cannot read ZIP archive.')); return; }
      const files = new Map(), names = new Set(), regularFiles = new Set(); let count = 0, total = 0, finished = false;
      const fail = error => { if (finished) return; finished = true; zip.close(); reject(error?.status ? error : invalid('Cannot read ZIP entry.')); };
      zip.on('error', fail);
      zip.on('end', () => { if (!finished) { finished = true; resolvePromise(files); } });
      zip.on('entry', entry => {
        try {
          if (++count > limits.files) throw invalid('ZIP contains too many entries.');
          const name = entry.fileName, directory = name.endsWith('/'), clean = directory ? name.slice(0, -1) : name;
          if (!clean || clean.length > 240 || /[\\\x00-\x1f\x7f:]/.test(clean) || clean.startsWith('/') || clean.split('/').some(p => !p || p === '.' || p === '..')) throw invalid('ZIP contains an unsafe path.');
          const folded = clean.toLowerCase();
          if (names.has(folded)) throw invalid('ZIP contains duplicate paths.');
          const segments = folded.split('/');
          if (segments.some((_segment, index) => index > 0 && regularFiles.has(segments.slice(0, index).join('/')))
            || !directory && [...names].some(name => name.startsWith(folded + '/'))) throw invalid('ZIP contains conflicting file and directory paths.');
          names.add(folded); if (!directory) regularFiles.add(folded);
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== (directory ? 0x4000 : 0x8000)) throw invalid('ZIP may contain only regular files and directories.');
          if (entry.generalPurposeBitFlag & 1) throw invalid('Encrypted ZIP entries are not supported.');
          const allowedRoot = roots;
          if (directory) {
            if (!allowedRoot.includes(clean.split('/')[0]) || entry.uncompressedSize !== 0) throw invalid('Unexpected ZIP directory.');
            zip.readEntry(); return;
          }
          if (!(clean.includes('/') ? allowedRoot.includes(clean.split('/')[0]) : rootFiles.includes(clean))) throw invalid('ZIP must contain the package directly at its root.');
          if (!extensions.includes(extname(clean).toLowerCase())) throw invalid('ZIP contains an unsupported file type.');
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limits.fileBytes || total + entry.uncompressedSize > limits.unpackedBytes) throw invalid('ZIP expanded size exceeds the limit.');
          total += entry.uncompressedSize;
          zip.openReadStream(entry, (error, stream) => {
            if (error) { fail(error); return; }
            const chunks = []; let actual = 0, checksum = 0;
            stream.on('error', fail);
            stream.on('data', chunk => {
              actual += chunk.length;
              if (actual > entry.uncompressedSize || actual > limits.fileBytes) { stream.destroy(); fail(invalid('ZIP entry size differs from its declaration.')); return; }
              checksum = crc32(chunk, checksum); chunks.push(chunk);
            });
            stream.on('end', () => {
              if (finished) return;
              if (actual !== entry.uncompressedSize || checksum !== entry.crc32) { fail(invalid('ZIP entry is incomplete or has an invalid checksum.')); return; }
              files.set(clean, Buffer.concat(chunks)); zip.readEntry();
            });
          });
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
  });
}
