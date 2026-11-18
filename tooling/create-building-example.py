"""Create an editable building package. Run through Blender with -- OUTPUT."""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
if len(args) != 1:
    raise ValueError('Provide an output path after --')
out = Path(args[0]).resolve()
out.mkdir(parents=True, exist_ok=False)
for folder in ['source', 'runtime', 'textures', 'previews']:
    (out / folder).mkdir()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.world = bpy.data.worlds.new('Daylight')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.38, .46, .51, 1)
palette = {
    'Ochre': (.57, .27, .10), 'Slate': (.12, .19, .23),
    'Mint': (.27, .52, .41), 'Cream': (.85, .76, .56),
}
materials = {}
for name, color in palette.items():
    image = bpy.data.images.new(name, width=64, height=64, alpha=False)
    pixels = []
    for y in range(64):
        for x in range(64):
            light = .89 if y % 16 == 0 or (x + 16 * (y // 16 % 2)) % 32 == 0 else 1.
            pixels.extend([channel * light for channel in color] + [1.])
    image.pixels = pixels
    path = out / 'textures' / (name.lower() + '.png')
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    image.pack()
    image.filepath = '//../textures/' + path.name
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    materials[name] = mat

def block(name, x, z, y, width, depth, height, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(materials[color])
    return obj

walls = [
    block('Back', 5, 3, 1.5, 6, .25, 3, 'Ochre'),
    block('Left', 2.1, 5.8, 1.5, .24, 5.6, 3, 'Ochre'),
    block('Right', 7.9, 5.8, 1.5, .24, 5.6, 3, 'Ochre'),
    block('Front left', 3.15, 8.5, 1.5, 2.3, .3, 3, 'Ochre'),
    block('Front right', 6.85, 8.5, 1.5, 2.3, .3, 3, 'Ochre'),
    block('Lintel', 5, 8.5, 2.8, 1.4, .3, .4, 'Cream'),
    block('Roof', 5, 5.75, 3.15, 6.6, 6.2, .3, 'Slate'),
]
visuals = walls + [
    block('Left display', 3.15, 8.68, 1.55, 1.65, .08, 1.45, 'Mint'),
    block('Right display', 6.85, 8.68, 1.55, 1.65, .08, 1.45, 'Mint'),
    block('Canopy', 5, 8.95, 2.7, 5.8, .8, .09, 'Cream'),
]

def export(objects, filename, render):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / 'runtime' / filename), export_format='GLB',
        use_selection=True, export_animations=False, export_cameras=False, export_lights=False,
        export_extras=False, export_materials='EXPORT' if render else 'NONE', export_yup=True,
        export_texcoords=render, export_normals=True, export_tangents=False,
        export_image_format='AUTO', export_texture_dir='')
export(visuals, 'shell.glb', True)
export(walls, 'collision.glb', False)
target = Vector((5, -6, 1.4))
bpy.ops.object.camera_add(location=(14, -20, 9))
camera = bpy.context.object
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 12
scene.camera = camera
bpy.ops.object.light_add(type='SUN', location=(2, -5, 12))
sun = bpy.context.object
sun.rotation_euler = (.55, -.45, -.6)
sun.data.energy = 3.5
scene.render.engine = 'CYCLES'
scene.cycles.samples = 6
scene.render.resolution_x, scene.render.resolution_y = 480, 360
scene.render.resolution_percentage = 100
scene.render.filepath = '//../previews/front-day.png'
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source/building.blend'), compress=False)
bpy.ops.render.render(write_still=True)
paths = dict(source='source/building.blend', render='runtime/shell.glb', collision='runtime/collision.glb', provenance='provenance.json')
manifest = dict(schemaVersion='city.building.v1', buildingId='district-ugc-building-01', slotId='shell',
    revision='1.0.0', name='Corner pavilion', authors=[dict(displayName='EarthOnline contributors')],
    target=dict(districtId='district-east-block-01', parcelId='district-east-p01', parcelRevision='1.0.0'),
    coordinates=dict(units='metres', gameUp='+Y', origin='parcel-local-origin'),
    files=paths, dependencies=[], previews=['previews/front-day.png'])
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(out / 'provenance.json').write_text(json.dumps(dict(origin='Geometry and textures constructed by create-building-example.py', license='MIT'), indent=2) + '\n')
(out / 'README.md').write_text('# Corner pavilion\n\nOpen source/building.blend to edit the shell. The source embeds its four generated texture swatches. The side walls and roof form the collision mesh. Run the example generator to reproduce this complete package.\n')
