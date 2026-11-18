#!/usr/bin/env python3
"""Copy selected, verified catalog assets into a relocatable Blender/glTF pack.

No generation, conversion, network access, or recursive source-directory copy is
performed. Run with ordinary Python; the project's asset Python supplies bpy for
read-only dependency inspection. --zip adds a sibling ZIP beside the new folder.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile


ROOT = Path(__file__).resolve().parents[1]
FILE_ROLES = {'glb': '.glb', 'blend': '.blend', 'preview': '.png', 'provenance': '.json'}
DEPENDENCY_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.json', '.md', '.txt'}
ID_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]*\Z')
HASH_PATTERN = re.compile(r'[a-f0-9]{64}\Z')
URL_PATTERN = re.compile(r'https?://[^\s<>"\x27]+', re.IGNORECASE)
UNSAFE_KEYS = {
    'api_key', 'apikey', 'access_token', 'refresh_token', 'authorization',
    'api_token', 'x_api_key', 'bearer_token', 'password', 'secret', 'client_secret',
    'private_key', 'credentials', 'cookie', 'set_cookie', 'signed_url', 'signed_urls',
    'download_url', 'download_urls', 'model_urls', 'texture_urls',
    'raw_response', 'api_response', 'task_response', 'placement', 'placements',
    'city_coordinates', 'city_placement', 'world_position', 'world_transform',
    'world_matrix', 'slot_id', 'rejected_tasks', 'rejected_attempts',
}
class PackError(ValueError):
    pass


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value, context):
    """Require canonical POSIX paths, never reinterpret platform-dependent paths."""
    if not isinstance(value, str) or not value or '\\' in value or '\0' in value:
        raise PackError(f'{context}: expected a relative POSIX file path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {'', '.', '..'} for part in value.split('/')) or ':' in value:
        raise PackError(f'{context}: path must stay inside its asset directory')
    return path


def checked_source(base, relative, context):
    """Reject even internal symlinks: a pack must represent registered real bytes."""
    path = base
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise PackError(f'{context}: symbolic links are not exportable')
    if not path.is_file() or not path.resolve().is_relative_to(base.resolve()):
        raise PackError(f'{context}: registered file is missing or outside the catalog')
    return path


def inspect_text(value, context):
    """Public license links are useful; credentials, signed links and local paths are not."""
    if not isinstance(value, str):
        return
    for match in URL_PATTERN.finditer(value):
        url = match.group().rstrip(').,;]')
        parsed = urlsplit(url)
        if parsed.query or parsed.username or parsed.password or not parsed.hostname:
            raise PackError(f'{context}: access-bearing or parameterized URL is not portable')
    # Blender // paths and public URL paths are allowed; machine-specific paths are not.
    scrubbed = URL_PATTERN.sub('', value)
    if re.search(r'(?<![\w/:])/(?![/\s])[^\s]+', scrubbed) or 'file://' in scrubbed.lower():
        raise PackError(f'{context}: machine-local absolute path is not portable')
    if re.search(r'(?<!\w)[A-Za-z]:[\\/]', scrubbed) or re.search(r'(?i)\bbearer\s+[A-Za-z0-9._-]+', value):
        raise PackError(f'{context}: private access data is not portable')
    if re.search(r'(?i)(?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*[^\s,;]+', value):
        raise PackError(f'{context}: private access data is not portable')


def inspect_metadata(value, context):
    if isinstance(value, dict):
        if 'result' in value and {'ok', 'command', 'request'} & value.keys():
            raise PackError(f'{context}: full API responses are not asset provenance')
        for key, child in value.items():
            separated = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', str(key))
            normalized = re.sub(r'[^a-z0-9]+', '_', separated.lower()).strip('_')
            if normalized in UNSAFE_KEYS:
                raise PackError(f'{context}: disallowed private or city-specific metadata key {key!r}')
            inspect_metadata(child, f'{context}.{key}')
    elif isinstance(value, list):
        for index, child in enumerate(value):
            inspect_metadata(child, f'{context}[{index}]')
    elif isinstance(value, str) and value.lstrip().startswith(('{', '[')):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            inspect_text(value, context)
        else:
            inspect_metadata(decoded, context)
    else:
        inspect_text(value, context)


def inspect_registered_content(path, context):
    if path.suffix.lower() == '.json':
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise PackError(f'{context}: invalid UTF-8 JSON') from error
        inspect_metadata(value, context)
    elif path.suffix.lower() in {'.md', '.txt'}:
        try:
            inspect_text(path.read_text(encoding='utf-8'), context)
        except UnicodeError as error:
            raise PackError(f'{context}: invalid UTF-8 text') from error


def inspect_glb(path, context):
    """Verify that the GLB's image/buffer data is embedded, with no external URI."""
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b'glTF':
        raise PackError(f'{context}: invalid GLB header')
    version, length = struct.unpack_from('<II', data, 4)
    if version != 2 or length != len(data):
        raise PackError(f'{context}: invalid GLB version or length')
    offset, document, binary_length, chunk_index = 12, None, 0, 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise PackError(f'{context}: truncated GLB chunk')
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise PackError(f'{context}: invalid GLB chunk bounds')
        if chunk_index == 0 and kind != 0x4E4F534A:
            raise PackError(f'{context}: GLB must begin with JSON')
        if kind == 0x4E4F534A:
            if document is not None:
                raise PackError(f'{context}: repeated GLB JSON chunk')
            try:
                document = json.loads(data[offset:offset + size].rstrip(b' \0'))
            except (UnicodeError, json.JSONDecodeError) as error:
                raise PackError(f'{context}: invalid GLB JSON') from error
        elif kind == 0x004E4942:
            if binary_length:
                raise PackError(f'{context}: repeated GLB binary chunk')
            binary_length = size
        else:
            raise PackError(f'{context}: unsupported GLB chunk')
        offset += size
        chunk_index += 1
    if not isinstance(document, dict) or document.get('asset', {}).get('version') != '2.0':
        raise PackError(f'{context}: missing glTF 2.0 document')
    buffers = document.get('buffers', [])
    if len(buffers) != 1 or buffers[0].get('byteLength', 0) > binary_length:
        raise PackError(f'{context}: expected one embedded, complete GLB buffer')
    # URI in extras is also rejected: it can otherwise retain an old source URL.
    def no_uri(value):
        if isinstance(value, dict):
            if 'uri' in value:
                raise PackError(f'{context}: GLB URI references are not self-contained')
            for child in value.values():
                no_uri(child)
        elif isinstance(value, list):
            for child in value:
                no_uri(child)
    no_uri(document)
    for image in document.get('images', []):
        index = image.get('bufferView')
        if not isinstance(index, int) or not 0 <= index < len(document.get('bufferViews', [])):
            raise PackError(f'{context}: GLB image must use an embedded bufferView')
    for view in document.get('bufferViews', []):
        if view.get('buffer', 0) != 0 or view.get('byteOffset', 0) < 0 or view.get('byteLength', 0) < 0:
            raise PackError(f'{context}: invalid embedded bufferView')
        if view.get('byteOffset', 0) + view.get('byteLength', 0) > buffers[0].get('byteLength', 0):
            raise PackError(f'{context}: bufferView exceeds GLB data')
    inspect_metadata(document, context)


# Executed by a separate asset-Python process; it never saves or executes a blend script.
BLEND_INSPECTOR = r'''
import bpy, json, sys
from pathlib import Path, PurePosixPath
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
requests = json.loads(sys.stdin.read())
results = []
for request in requests:
    path = Path(request['blend']).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    root = path.parent
    registered = set(request['registered'])
    references = []
    def reference(value, label):
        if not isinstance(value, str) or not value.startswith('//') or '\\' in value:
            raise ValueError(label + ': expected Blender // relative path')
        relative = value[2:]
        if not relative or any(p in ('', '.', '..') for p in relative.split('/')) or ':' in relative:
            raise ValueError(label + ': path escapes asset directory')
        target = root.joinpath(*PurePosixPath(relative).parts)
        if relative not in registered or not target.is_file() or not target.resolve().is_relative_to(root):
            raise ValueError(label + ': missing or unregistered local dependency')
        references.append(relative)
    for library in bpy.data.libraries:
        raise ValueError('linked Blender libraries must be made local before export')
    for image in bpy.data.images:
        if image.source in ('FILE', 'TILED', 'SEQUENCE', 'MOVIE'):
            if image.source != 'FILE':
                raise ValueError('only static file-backed textures are supported')
            reference(image.filepath, 'image ' + image.name)
            if request.get('require_relative_packed'):
                if not image.packed_files:
                    raise ValueError('new library images must include packed bytes')
                for packed in image.packed_files:
                    reference(packed.filepath, 'packed image ' + image.name)
                    if packed.filepath != image.filepath:
                        raise ValueError('packed image path differs from its relative image path')
    custom = []
    for group in ('objects', 'collections', 'materials', 'images', 'meshes', 'scenes', 'worlds', 'node_groups'):
        for block in getattr(bpy.data, group):
            properties = {}
            for key in block.keys():
                value = block[key]
                if key.endswith('_pbr'):
                    schema = json.loads(value) if isinstance(value, str) else value.to_dict()
                    for role in ('base_color', 'metallic_roughness', 'normal', 'occlusion', 'emissive'):
                        if schema.get(role):
                            reference(schema[role], block.name + '.' + role)
                if hasattr(value, 'to_dict'):
                    value = value.to_dict()
                elif hasattr(value, 'to_list'):
                    value = value.to_list()
                if isinstance(value, (str, int, float, bool, list, dict)) or value is None:
                    properties[key] = value
            if properties:
                custom.append(properties)
    if any(text.use_module for text in bpy.data.texts):
        raise ValueError('auto-run Blender text modules are not allowed in an asset pack')
    for group in ('movieclips', 'sounds', 'fonts', 'volumes', 'cache_files'):
        for block in getattr(bpy.data, group, []):
            if getattr(block, 'filepath', '') not in ('', '<builtin>') and not getattr(block, 'packed_file', None):
                raise ValueError('unsupported external dependency in ' + group)
    # A library blend must be visible in the native Asset Browser.
    if not any(collection.asset_data is not None for collection in bpy.data.collections):
        raise ValueError('blend is missing an Asset Browser collection asset mark')
    results.append({'id': request['id'], 'references': sorted(set(references)), 'custom_properties': custom})
print('ASSET_PACK_BLEND_INSPECTION=' + json.dumps(results, ensure_ascii=False))
'''


def find_asset_python():
    override = os.environ.get('ASSET_PYTHON')
    candidates = [Path(override)] if override else [ROOT / '.venv-assets/bin/python', Path(sys.executable)]
    for candidate in candidates:
        if candidate.is_file():
            probe = subprocess.run([str(candidate), '-c', 'import bpy'], capture_output=True, text=True)
            if probe.returncode == 0:
                return str(candidate)
    raise PackError('read-only blend verification requires bpy; set ASSET_PYTHON to the asset Python')


def inspect_blends(items, asset_python, base=None):
    requests = []
    for item in items:
        blend = item['source_root'] / 'model.blend' if base is None else base / 'items' / item['id'] / 'model.blend'
        requests.append({'id': item['id'], 'blend': str(blend),
                         'require_relative_packed': bool(item['catalog_item'].get('pack_id')),
                         'registered': [str(entry['inside']) for entry in item['entries']]})
    process = subprocess.run([asset_python, '-c', BLEND_INSPECTOR], input=json.dumps(requests),
                             text=True, capture_output=True)
    marker = 'ASSET_PACK_BLEND_INSPECTION='
    records = [line[len(marker):] for line in process.stdout.splitlines() if line.startswith(marker)]
    if process.returncode or len(records) != 1:
        # Do not echo Blender's arbitrary datablock paths, API strings, or Python traceback values.
        details = process.stderr.strip().splitlines()
        reason = next((line.split(': ', 1)[1] for line in reversed(details) if line.startswith('ValueError: ')), None)
        if reason:
            # The inspector's fixed reasons may mention a material label; run the same safety filter first.
            try:
                inspect_text(reason, 'blend verification error')
            except PackError:
                reason = None
        raise PackError('blend dependency inspection failed' + (f': {reason}' if reason else ' (details withheld)'))
    results = json.loads(records[0])
    for result in results:
        inspect_metadata(result['custom_properties'], f"{result['id']} blend custom properties")
    return [{'id': value['id'], 'references': value['references']} for value in results]


def entry_record(value, context, base):
    if not isinstance(value, dict):
        raise PackError(f'{context}: expected file record')
    relative = safe_relative(value.get('path'), context)
    expected_hash, expected_size = value.get('sha256'), value.get('bytes')
    if not isinstance(expected_hash, str) or not HASH_PATTERN.fullmatch(expected_hash):
        raise PackError(f'{context}: missing lowercase SHA-256')
    if type(expected_size) is not int or expected_size < 0:
        raise PackError(f'{context}: missing byte count')
    path = checked_source(base, relative, context)
    if path.stat().st_size != expected_size or sha256(path) != expected_hash:
        raise PackError(f'{context}: registered hash or byte count does not match source')
    return {'relative': relative, 'source': path, 'sha256': expected_hash, 'bytes': expected_size}


def preflight(catalog_path, asset_ids, all_assets, output, make_zip):
    if catalog_path.is_symlink() or not catalog_path.is_file():
        raise PackError('catalog must be an existing regular file')
    try:
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PackError('catalog must contain valid UTF-8 JSON') from error
    if not isinstance(catalog, dict) or type(catalog.get('schema_version')) is not int or catalog['schema_version'] != 1:
        raise PackError('unsupported catalog schema_version; expected 1')
    if not isinstance(catalog.get('assets'), list) or not catalog['assets']:
        raise PackError('catalog has no assets')
    if not isinstance(catalog.get('title'), str) or not catalog.get('revision'):
        raise PackError('catalog requires title and revision')
    indexed = {}
    for item in catalog['assets']:
        identifier = item.get('id') if isinstance(item, dict) else None
        if not isinstance(identifier, str) or not ID_PATTERN.fullmatch(identifier):
            raise PackError('catalog asset IDs must be safe directory names')
        if identifier in indexed:
            raise PackError(f'duplicate catalog asset ID: {identifier}')
        indexed[identifier] = item
    if not all_assets and not asset_ids:
        raise PackError('select at least one --asset ID or use --all')
    if len(asset_ids) != len(set(asset_ids)):
        raise PackError('duplicate --asset selection')
    unknown = set(asset_ids) - set(indexed)
    if unknown:
        raise PackError('unknown asset ID: ' + ', '.join(sorted(unknown)))
    selected = list(indexed) if all_assets else asset_ids
    # Resolve parent symlinks before checking destinations; never overwrite even empty dirs.
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise PackError('output must be a new directory; existing paths are never replaced')
    for parent in output.parents:
        if parent.exists() and not parent.is_dir():
            raise PackError('output parent is not a directory')
    zip_path = output.with_name(output.name + '.zip') if make_zip else None
    if zip_path and (zip_path.exists() or zip_path.is_symlink()):
        raise PackError('ZIP output already exists')
    base = catalog_path.parent.resolve()
    prepared, used_destinations = [], set()
    for identifier in selected:
        source_item = indexed[identifier]
        inspect_metadata(source_item, f'{identifier} catalog metadata')
        files, dependencies = source_item.get('files'), source_item.get('dependencies')
        if not isinstance(files, dict) or set(files) != set(FILE_ROLES) or not isinstance(dependencies, list):
            raise PackError(f'{identifier}: requires glb/blend/preview/provenance and explicit dependencies')
        if not isinstance(files['blend'], dict):
            raise PackError(f'{identifier}.blend: expected file record')
        source_root_relative = safe_relative(files['blend'].get('path'), f'{identifier}.blend').parent
        if str(source_root_relative) == '.':
            raise PackError(f'{identifier}: files must live in their own asset directory')
        source_root = base.joinpath(*source_root_relative.parts)
        if output.resolve().is_relative_to(source_root.resolve()):
            raise PackError('output must be outside every selected source asset directory')
        entries, source_paths = [], set()
        for role, file_entry in list(files.items()) + [('dependency', entry) for entry in dependencies]:
            context = f'{identifier}.{role}'
            entry = entry_record(file_entry, context, base)
            try:
                inside = entry['relative'].relative_to(source_root_relative)
            except ValueError as error:
                raise PackError(f'{context}: dependency must stay inside its own asset directory') from error
            if inside in source_paths:
                raise PackError(f'{identifier}: a file is registered more than once')
            source_paths.add(inside)
            if role in FILE_ROLES:
                expected_name = {'glb': 'model.glb', 'blend': 'model.blend', 'preview': 'preview.png',
                                 'provenance': 'provenance.json'}[role]
                if str(inside) != expected_name:
                    raise PackError(f'{context}: expected {expected_name} at asset root')
            else:
                roles = file_entry.get('role')
                if not ((isinstance(roles, str) and roles) or
                        (isinstance(roles, list) and roles and all(isinstance(value, str) and value for value in roles))):
                    raise PackError(f'{identifier}: every dependency requires a role')
                if inside.suffix.lower() not in DEPENDENCY_SUFFIXES:
                    raise PackError(f'{context}: unsupported dependency type (font binaries are installed separately)')
            if re.search(r'(?i)(?:\.local\.|(?:^|/)(?:attempt[-_]|raw\.|placement\.|.*status\.))', str(inside)):
                raise PackError(f'{context}: raw responses, rejected attempts and placement files are not exportable')
            destination = PurePosixPath('items', identifier) / inside
            if str(destination).casefold() in used_destinations:
                raise PackError('case-insensitive destination collision')
            used_destinations.add(str(destination).casefold())
            entry.update({'inside': inside, 'destination': destination, 'role': role})
            inspect_registered_content(entry['source'], context)
            entries.append(entry)
        if not {PurePosixPath('asset.json'), PurePosixPath('README.md')} <= source_paths:
            raise PackError(f'{identifier}: asset.json and README.md must be registered dependencies')
        inspect_glb(base.joinpath(*safe_relative(files['glb']['path'], f'{identifier}.glb').parts), identifier)
        exported_item = copy.deepcopy(source_item)
        for file_entry in list(exported_item['files'].values()) + exported_item['dependencies']:
            relative = safe_relative(file_entry['path'], identifier).relative_to(source_root_relative)
            file_entry['path'] = str(PurePosixPath('items', identifier) / relative)
        prepared.append({'id': identifier, 'source_root': source_root, 'entries': entries, 'catalog_item': exported_item})
    categories_path = checked_source(base, PurePosixPath('blender_assets.cats.txt'), 'Blender asset categories')
    if 'blender_catalog' in catalog:
        categories_entry = entry_record(catalog['blender_catalog'], 'Blender asset categories', base)
        if categories_entry['relative'] != PurePosixPath('blender_assets.cats.txt'):
            raise PackError('Blender asset categories must be at the catalog root')
    inspect_registered_content(categories_path, 'Blender asset categories')
    # Do not copy top-level raw bookkeeping: the new catalog describes only selected assets.
    exported_catalog = {'schema_version': 1, 'title': catalog['title'], 'revision': catalog['revision'],
                        'assets': [item['catalog_item'] for item in prepared]}
    for key in ('description', 'categories'):
        if key in catalog:
            exported_catalog[key] = copy.deepcopy(catalog[key])
    exported_catalog['blender_catalog'] = {'path': 'blender_assets.cats.txt', 'sha256': sha256(categories_path),
                                          'bytes': categories_path.stat().st_size}
    inspect_metadata(exported_catalog, 'export catalog')
    asset_python = find_asset_python()
    blend_verification = inspect_blends(prepared, asset_python)
    return {'catalog': exported_catalog, 'items': prepared, 'output': output, 'zip_path': zip_path,
            'categories': categories_path, 'categories_hash': sha256(categories_path),
            'asset_python': asset_python, 'blend_verification': blend_verification}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def export_pack(plan):
    output, zip_path = plan['output'], plan['zip_path']
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f'.{output.name}-staging-', dir=output.parent))
    temporary_zip = None
    try:
        for item in plan['items']:
            for entry in item['entries']:
                target = stage.joinpath(*entry['destination'].parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(entry['source'], target)
                if target.stat().st_size != entry['bytes'] or sha256(target) != entry['sha256']:
                    raise PackError(f"{item['id']}: source changed while copying; export cancelled")
            inspect_glb(stage / 'items' / item['id'] / 'model.glb', item['id'])
        shutil.copyfile(plan['categories'], stage / 'blender_assets.cats.txt')
        if sha256(stage / 'blender_assets.cats.txt') != plan['categories_hash']:
            raise PackError('Blender categories changed while copying; export cancelled')
        relocated = inspect_blends(plan['items'], plan['asset_python'], stage)
        if relocated != plan['blend_verification']:
            raise PackError('relocated blend dependency references differ from preflight')
        write_json(stage / 'catalog.json', plan['catalog'])
        (stage / 'README.md').write_text(
            f"# {plan['catalog']['title']}\n\n"
            f"Revision: {plan['catalog']['revision']}. Assets: {len(plan['items'])}.\n\n"
            'Each items/<asset-id>/ folder contains an embedded standalone model.glb, an editable '
            'model.blend, its relative textures, preview, asset metadata, and provenance. Paths in '
            'catalog.json are relative to this folder. Keep each item folder intact when moving it.\n\n'
            'Add this folder to Blender Preferences > File Paths > Asset Libraries to browse the '
            'marked collections; blender_assets.cats.txt carries their categories. Runtime engines '
            'can import each embedded GLB independently. Units and canonical axes are recorded per asset.\n\n'
            'Exact Chinese lettering is included as raster artwork. Noto CJK fonts use SIL OFL 1.1; '
            'font binaries are not bundled. Install the named fonts separately to redesign lettering. '
            'Read each item README and provenance for sources and applicable asset terms.\n\n'
            'checksums.json records SHA-256 and byte counts for every package file except itself. '
            'No generation API responses, access-bearing URLs, rejected models, or city placements are included.\n',
            encoding='utf-8')
        checksums = {'schema_version': 1, 'algorithm': 'sha256', 'files': {}}
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                checksums['files'][path.relative_to(stage).as_posix()] = {'sha256': sha256(path), 'bytes': path.stat().st_size}
        write_json(stage / 'checksums.json', checksums)
        if zip_path:
            descriptor, temporary_zip_name = tempfile.mkstemp(prefix=f'.{zip_path.name}-', dir=output.parent)
            os.close(descriptor)
            temporary_zip = Path(temporary_zip_name)
            with zipfile.ZipFile(temporary_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in sorted(stage.rglob('*')):
                    if path.is_file():
                        info = zipfile.ZipInfo(path.relative_to(stage).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = 0o100644 << 16
                        archive.writestr(info, path.read_bytes())
        # Recheck immediately before committing. rename must never replace an existing output.
        if output.exists() or output.is_symlink() or (zip_path and (zip_path.exists() or zip_path.is_symlink())):
            raise PackError('output appeared during export; existing paths were left untouched')
        # An exclusive reservation closes the empty-directory race between the
        # existence check and rename; we replace only the directory we created.
        output.mkdir()
        try:
            os.rename(stage, output)
        except OSError:
            output.rmdir()
            raise
        if temporary_zip:
            try:
                # Hard-link publishes a complete file atomically and refuses an existing destination.
                os.link(temporary_zip, zip_path)
            except OSError:
                shutil.rmtree(output)
                raise
            temporary_zip.unlink()
            temporary_zip = None
        return {'ok': True, 'output': str(output), 'zip': str(zip_path) if zip_path else None,
                'assets': [item['id'] for item in plan['items']], 'files': len(checksums['files']) + 1,
                'bytes': sum(entry['bytes'] for entry in checksums['files'].values()) + (output / 'checksums.json').stat().st_size,
                'relocated_blends_verified': len(relocated), 'catalog_sha256': sha256(output / 'catalog.json'),
                'checksums_sha256': sha256(output / 'checksums.json')}
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if temporary_zip and temporary_zip.exists():
            temporary_zip.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument('--asset', action='append', default=[], metavar='ID', help='stable asset ID; repeat to select several')
    selector.add_argument('--all', action='store_true', dest='all_assets', help='select all accepted catalog assets')
    parser.add_argument('--output', required=True, type=Path, metavar='NEWDIR')
    parser.add_argument('--zip', action='store_true', dest='make_zip', help='also create a sibling NEWDIR.zip')
    parser.add_argument('--dry-run', action='store_true', help='verify all dependencies without creating output')
    args = parser.parse_args()
    try:
        plan = preflight(args.catalog.absolute(), args.asset, args.all_assets, args.output, args.make_zip)
        if args.dry_run:
            result = {'ok': True, 'dry_run': True, 'output': str(plan['output']),
                      'zip': str(plan['zip_path']) if plan['zip_path'] else None,
                      'assets': [item['id'] for item in plan['items']],
                      'registered_files': sum(len(item['entries']) for item in plan['items']),
                      'registered_bytes': sum(entry['bytes'] for item in plan['items'] for entry in item['entries']),
                      'blends_verified': len(plan['blend_verification'])}
        else:
            result = export_pack(plan)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (PackError, OSError) as error:
        # Only our sanitized errors are displayed; arbitrary OS exceptions can carry private paths.
        message = str(error) if isinstance(error, PackError) else f'filesystem operation failed ({type(error).__name__})'
        print('asset pack export failed: ' + message, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
