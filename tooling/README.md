# Asset and building tools

Run the commands from the repository root after installing dependencies.

## Check an editable building

`node tooling/check-building.mjs district-east-p01 /path/to/unpacked-building` validates an editable project directory. The command prints the measured world-space bounds, triangle counts, materials and memory estimates for the visible and collision models. An invalid package exits with status 1. Run the command without arguments for the list of parcel IDs.

The package must contain these files.

| Path | Contents |
| --- | --- |
| `manifest.json` | Building revision and target parcel |
| `source/building.blend` | Editable, uncompressed Blender file |
| `runtime/shell.glb` | Static glTF 2.0 geometry with UVs and embedded PBR color textures |
| `runtime/collision.glb` | Simplified version used for solid surfaces |
| `textures/` | Editable PNG, JPEG or WebP texture files |
| `previews/` | At least one PNG, JPEG or WebP render |
| `provenance.json` | Sources, authorship, and applicable licenses |
| `README.md` | Instructions to open, edit and export the building |

Example manifest for the first plot.

```json
{
  "schemaVersion": "city.building.v1",
  "buildingId": "district-ugc-building-01",
  "slotId": "shell",
  "revision": "1.0.0",
  "name": "Corner bookshop",
  "target": {
    "districtId": "district-east-block-01",
    "parcelId": "district-east-p01",
    "parcelRevision": "1.0.0"
  },
  "authors": [{ "displayName": "Contributor" }],
  "coordinates": { "units": "metres", "gameUp": "+Y", "origin": "parcel-local-origin" },
  "files": {
    "source": "source/building.blend",
    "render": "runtime/shell.glb",
    "collision": "runtime/collision.glb",
    "provenance": "provenance.json"
  },
  "dependencies": [],
  "previews": ["previews/front-day.png"]
}
```

Each plot measures 10 m along X, 12 m along Z and 12 m in height. Build relative to its minimum corner. The visible mesh supports up to 100,000 triangles and the collision mesh supports up to 5,000. The validator reads binary vertex data and node transforms as well as texture and UV bindings. Open the editable source in Blender to verify that its external assets resolve.

## Asset pipeline

- `node tooling/precompress.mjs --help` shows the static asset compressor options.
- `blender -b -P tooling/diagnose-zfighting.py -- --asset input.glb --report result.json` reports near-coplanar overlaps.
- `blender -b -P tooling/export-asset-pack.py -- --catalog catalog.json --output assets` exports reusable Blender models from a catalog.
