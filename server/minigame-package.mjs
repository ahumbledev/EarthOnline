import sharp from 'sharp';
import { extname } from 'node:path';
import { validateGameDefinition, MINIGAME_LIMITS } from '../shared/minigame-protocol.mjs';
import { unpackPackageZip, createStoredZip } from './package-zip.mjs';

export { MINIGAME_LIMITS };
export const minigameError = (status, code, message, issues) => Object.assign(new Error(message), { status, code, ...(issues ? { issues } : {}) });
const invalid = (path, code, message) => minigameError(400, code, message, [{ path, code, message }]);
const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const optionalFiles = ['README.md', 'provenance.json', 'LICENSE.txt'];
function rejectAnimatedPng(bytes) {
  // libvips decodes PNG's first frame and does not expose APNG's frame count.
  // Inspect the bounded chunk table as well, so browser decoding cannot animate
  // an asset that passed a single-frame server budget.
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error('Invalid PNG chunk size');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new Error('Animated PNG is unsupported');
    offset += length + 12;
  }
}

export function unpackMinigameZip(bytes) {
  return unpackPackageZip(bytes, { limits: MINIGAME_LIMITS, roots: ['assets'],
    rootFiles: ['game.json', ...optionalFiles], extensions: ['.json', '.png', '.jpg', '.jpeg', '.webp', '.md', '.txt'] });
}

export function archiveGameJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MINIGAME_LIMITS.definitionBytes) throw invalid('/game.json', 'definition_too_large', 'game.json exceeds the definition size limit.');
  return createStoredZip(new Map([['game.json', bytes]]));
}

/** Data validation only. Never imports, evaluates or runs package contents. */
export async function validateMinigamePackage(files) {
  const json = files.get('game.json');
  if (!json) throw invalid('/game.json', 'missing_definition', 'Place game.json directly at the ZIP root.');
  if (json.length > MINIGAME_LIMITS.definitionBytes) throw invalid('/game.json', 'definition_too_large', 'game.json exceeds the definition size limit.');
  let definition;
  try { definition = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); }
  catch { throw invalid('/game.json', 'invalid_json', 'game.json must contain valid UTF-8 JSON.'); }
  const validation = validateGameDefinition(definition);
  if (!validation.valid) throw minigameError(400, 'invalid_game_definition', 'The game definition has validation errors.', validation.issues);
  const declared = new Set(['game.json', ...optionalFiles]), images = {};
  let pixels = 0, unpackedBytes = 0;
  for (const [id, asset] of Object.entries(definition.assets ?? {})) {
    const location = `/assets/${pointer(id)}/path`, bytes = files.get(asset.path);
    if (!bytes) throw invalid(location, 'missing_asset', `Missing declared image: ${asset.path}`);
    declared.add(asset.path);
    if (bytes.length > MINIGAME_LIMITS.fileBytes) throw invalid(location, 'image_too_large', 'Image exceeds the file size limit.');
    try {
      rejectAnimatedPng(bytes);
      const decoder = sharp(bytes, { limitInputPixels: MINIGAME_LIMITS.texturePixels, failOn: 'warning', animated: false }).timeout({ seconds: 3 });
      const metadata = await decoder.metadata();
      const expected = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }[extname(asset.path).toLowerCase()];
      if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > MINIGAME_LIMITS.textureDimension || metadata.height > MINIGAME_LIMITS.textureDimension || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported image format or dimensions');
      // Metadata alone accepts some truncated images. Decode every pixel before publication.
      await decoder.clone().raw().toBuffer();
      pixels += metadata.width * metadata.height;
      if (pixels > MINIGAME_LIMITS.totalTexturePixels) throw invalid(location, 'texture_budget', 'Total decoded image pixels exceed the texture budget.');
      images[id] = { width: metadata.width, height: metadata.height, format: metadata.format, bytes: bytes.length };
    } catch (error) {
      if (error.status) throw error;
      throw invalid(location, 'invalid_image', 'Image must fully decode as a single PNG, JPEG or WebP within the dimension and pixel limits.');
    }
  }
  for (const [name, bytes] of files) {
    if (!declared.has(name)) throw invalid(`/${pointer(name)}`, 'undeclared_file', 'Only game.json, declared image assets and optional README.md/provenance.json/LICENSE.txt are accepted.');
    if (!Buffer.isBuffer(bytes) || bytes.length > MINIGAME_LIMITS.fileBytes) throw invalid(`/${pointer(name)}`, 'file_too_large', 'Package file exceeds its size limit.');
    unpackedBytes += bytes.length;
    if (optionalFiles.includes(name)) {
      if (bytes.length > MINIGAME_LIMITS.definitionBytes) throw invalid(`/${pointer(name)}`, 'metadata_too_large', 'Package metadata exceeds the definition size limit.');
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (name === 'provenance.json') JSON.parse(text);
      } catch { throw invalid(`/${pointer(name)}`, 'invalid_metadata', 'Package metadata must be UTF-8 text; provenance.json must be valid JSON.'); }
    }
  }
  if (files.size > MINIGAME_LIMITS.files || unpackedBytes > MINIGAME_LIMITS.unpackedBytes) throw invalid('/', 'package_too_large', 'Expanded package exceeds the file count or byte limit.');
  return { definition, report: { valid: true, schemaVersion: definition.schemaVersion, files: files.size, unpackedBytes, imagePixels: pixels, images, issues: [] } };
}
