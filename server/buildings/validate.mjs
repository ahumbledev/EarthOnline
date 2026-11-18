import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
import { UGC_PARCELS, UGC_DISTRICT_ID, UGC_PARCEL_REVISION } from './parcels.mjs';
import { UGC_LIMITS } from './limits.mjs';
export { UGC_PARCELS } from './parcels.mjs';
export { UGC_LIMITS } from './limits.mjs';

const fail = (message, code = 'ugc_invalid_package') => { throw Object.assign(new Error(message), { status: 400, code }); };
const requireThat = (value, message, code) => { if (!value) fail(message, code); };
const text = (value, max = 100) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const json = (bytes, name) => {
  requireThat(bytes && bytes.length <= 256 * 1024, `${name} 缺失或超过 256 KiB`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(`${name} 不是有效的 UTF-8 JSON`); }
};

/** Read dimensions without invoking Blender or decoding an unbounded image. */
function imageSize(bytes, mime) {
  requireThat(bytes?.length >= 24, '贴图或预览图损坏');
  let width, height;
  if (mime === 'image/png') {
    requireThat(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR', 'PNG 文件格式错误');
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mime === 'image/jpeg') {
    requireThat(bytes[0] === 255 && bytes[1] === 216, 'JPEG 文件格式错误');
    let at = 2;
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 255) continue;
      let marker = bytes[at++]; while (marker === 255 && at < bytes.length) marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 0 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = bytes.readUInt16BE(at);
      requireThat(length >= 2 && at + length <= bytes.length, 'JPEG 数据段损坏');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        requireThat(length >= 7, 'JPEG 图像尺寸缺失');
        height = bytes.readUInt16BE(at + 3); width = bytes.readUInt16BE(at + 5); break;
      }
      at += length;
    }
  } else if (mime === 'image/webp') {
    requireThat(bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP', 'WebP 文件格式错误');
    const kind = bytes.toString('ascii',12,16);
    if (kind === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24,3); height = 1 + bytes.readUIntLE(27,3);
    } else if (kind === 'VP8 ' && bytes.length >= 30) {
      requireThat(bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42, 'WebP VP8 数据损坏');
      width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383;
    } else if (kind === 'VP8L' && bytes.length >= 25) {
      requireThat(bytes[20] === 47, 'WebP VP8L 数据损坏');
      const bits = bytes.readUInt32LE(21); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
    }
  }
  requireThat(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 2048 && height <= 2048, '贴图与预览图尺寸必须在 1–2048 像素内', 'ugc_texture_size');
  return { width, height };
}
const imageMime = name => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[name.split('.').at(-1).toLowerCase()];

async function decodeImage(bytes, name) {
  try {
    const pipeline = sharp(bytes, { limitInputPixels: 2048 * 2048, failOn: 'warning' }).timeout({ seconds: 3 });
    const meta = await pipeline.metadata();
    requireThat(['png','jpeg','webp'].includes(meta.format) && (!meta.pages || meta.pages === 1), `${name} 必须为静态 PNG/JPEG/WebP`);
    await pipeline.raw().toBuffer();
  } catch { fail(`${name} 图像无法完整解码，请重新导出贴图或预览`, 'ugc_texture_decode'); }
}

function embeddedImages(bytes) {
  const length = bytes.readUInt32LE(12), data = JSON.parse(bytes.toString('utf8',20,20 + length).trim());
  const bin = bytes.subarray(28 + length);
  return (data.images ?? []).map(image => { const view = data.bufferViews[image.bufferView]; return bin.subarray(view.byteOffset ?? 0,(view.byteOffset ?? 0) + view.byteLength); });
}

/** Static geometry profile: static uncompressed GLB, embedded
 * PNG/JPEG, no extensions, animation, skinning, URLs or exporter scripts. */
export function inspectUgcGlb(bytes, parcel, collision = false) {
  const label = collision ? '碰撞 GLB' : '可见 GLB';
  requireThat(bytes?.length >= 28 && bytes.length <= UGC_LIMITS.runtimeBytes && bytes.toString('ascii',0,4) === 'glTF'
    && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, `${label} 不是有效 GLB 2.0`);
  const jsonLength = bytes.readUInt32LE(12);
  requireThat(jsonLength <= 2 * 1024 ** 2 && 20 + jsonLength + 8 <= bytes.length && bytes.readUInt32LE(16) === 0x4e4f534a, `${label} JSON 数据块损坏`);
  let gltf;
  try { gltf = JSON.parse(bytes.toString('utf8',20,20 + jsonLength).trim()); } catch { fail(`${label} JSON 损坏`); }
  const binaryAt = 20 + jsonLength, binaryLength = bytes.readUInt32LE(binaryAt);
  requireThat(binaryAt + 8 + binaryLength === bytes.length && bytes.readUInt32LE(binaryAt + 4) === 0x004e4942, `${label} 必须使用单个内嵌 BIN 数据块`);
  const bin = bytes.subarray(binaryAt + 8);
  requireThat(gltf.asset?.version === '2.0' && gltf.buffers?.length === 1 && !gltf.buffers[0].uri
    && Number.isInteger(gltf.buffers[0].byteLength) && gltf.buffers[0].byteLength <= bin.length
    && gltf.buffers[0].byteLength >= bin.length - 3, `${label} 必须自包含，不能引用外部文件`);
  requireThat(!gltf.extensionsUsed?.length && !gltf.extensionsRequired?.length && !gltf.animations?.length && !gltf.skins?.length,
    `${label} 仅支持无压缩、无扩展的静态模型`, 'ugc_unsupported_gltf');
  const forbidExtras = item => requireThat(!item?.extensions && !item?.extras, `${label} 不接收扩展或自定义 extras 元数据`);
  forbidExtras(gltf);
  const views = gltf.bufferViews ?? [], accessors = gltf.accessors ?? [], meshes = gltf.meshes ?? [], nodes = gltf.nodes ?? [];
  requireThat([views,accessors,meshes,nodes,gltf.materials ?? [],gltf.images ?? [],gltf.textures ?? []].every(Array.isArray)
    && views.length <= 2048 && accessors.length <= 2048 && meshes.length <= 256 && nodes.length <= 512, `${label} 节点或数据段过多或格式错误`);
  for (const view of views) {
    forbidExtras(view);
    requireThat((view.buffer ?? 0) === 0 && Number.isInteger(view.byteLength) && view.byteLength > 0
      && Number.isInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0
      && (view.byteOffset ?? 0) + view.byteLength <= gltf.buffers[0].byteLength, `${label} bufferView 越界`);
  }
  function accessor(index, type, allowed) {
    const a = accessors[index];
    requireThat(a && !a.sparse && a.type === type && allowed.includes(a.componentType) && Number.isInteger(a.count) && a.count > 0 && a.count <= 300000,
      `${label} accessor 格式或数量不受支持`);
    forbidExtras(a);
    const v = views[a.bufferView], channels = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4 }[type];
    const size = { 5121:1, 5123:2, 5125:4, 5126:4 }[a.componentType], offset = a.byteOffset ?? 0;
    const stride = v?.byteStride ?? channels * size;
    requireThat(v && Number.isInteger(offset) && offset >= 0 && Number.isInteger(stride) && stride >= channels * size && stride <= 252
      && offset + (a.count - 1) * stride + channels * size <= v.byteLength && !a.normalized, `${label} accessor 数据越界或格式错误`);
    const base = (v.byteOffset ?? 0) + offset;
    const read = (i, channel = 0) => {
      const at = base + i * stride + channel * size;
      const value = a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : a.componentType === 5123 ? bin.readUInt16LE(at) : bin[at];
      requireThat(Number.isFinite(value), `${label} 顶点含 NaN 或无穷值`); return value;
    };
    return { count:a.count, read };
  }
  const materials = gltf.materials ?? [], images = gltf.images ?? [], textures = gltf.textures ?? [];
  requireThat(materials.length <= 8 && images.length <= 32 && textures.length <= 32, `${label} 材质或贴图数量超限`);
  let textureBytes = 0;
  for (const image of images) {
    forbidExtras(image);
    const view = views[image.bufferView];
    requireThat(!image.uri && view && ['image/png','image/jpeg'].includes(image.mimeType), `${label} 运行贴图须为内嵌 PNG/JPEG`);
    const size = imageSize(bin.subarray(view.byteOffset ?? 0,(view.byteOffset ?? 0) + view.byteLength), image.mimeType);
    textureBytes += size.width * size.height * 4 * 4 / 3;
  }
  requireThat(textureBytes <= 64 * 1024 ** 2, '纹理驻留估算超过 64 MiB', 'ugc_texture_budget');
  for (const tex of textures) { forbidExtras(tex); requireThat(Number.isInteger(tex.source) && images[tex.source], `${label} 纹理引用缺失`); }
  let textured = false;
  for (const material of materials) {
    forbidExtras(material);
    const slots = [material.pbrMetallicRoughness?.baseColorTexture, material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture, material.occlusionTexture, material.emissiveTexture].filter(Boolean);
    for (const slot of slots) requireThat(textures[slot.index] && (slot.texCoord ?? 0) === 0, `${label} 材质贴图绑定无效`);
    if (material.pbrMetallicRoughness?.baseColorTexture) textured = true;
  }
  if (!collision) requireThat(materials.length > 0 && textured, '可见 GLB 必须包含实际颜色贴图与 PBR 材质', 'ugc_material_missing');
  const min = new Vector3(Infinity,Infinity,Infinity), max = new Vector3(-Infinity,-Infinity,-Infinity);
  const visited = new Set(), visiting = new Set(); let triangles = 0, primitiveCount = 0;
  function visit(index, parent) {
    requireThat(Number.isInteger(index) && nodes[index] && !visited.has(index) && !visiting.has(index), `${label} 节点层级无效或重复`);
    const node = nodes[index]; forbidExtras(node); visiting.add(index);
    requireThat(node.skin === undefined && node.camera === undefined && node.weights === undefined, `${label} 只接受静态建筑节点`);
    const matrix = new Matrix4();
    if (node.matrix) {
      requireThat(finiteArray(node.matrix,16) && !node.translation && !node.rotation && !node.scale, `${label} 节点变换无效`);
      // GLTFLoader decomposes node matrices into TRS. Projective terms and
      // shear would otherwise validate different vertices from those displayed
      // and collidable in the client. Affine terms must be exact, even tiny
      // perspective values can conceal arbitrarily large source coordinates.
      requireThat(node.matrix[3] === 0 && node.matrix[7] === 0 && node.matrix[11] === 0 && node.matrix[15] === 1,
        `${label} 节点矩阵必须为仿射变换`);
      matrix.fromArray(node.matrix);
      requireThat(Math.abs(matrix.determinant()) > 1e-10, `${label} 节点变换不可用`);
      const translation = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
      matrix.decompose(translation, rotation, scale);
      const composed = new Matrix4().compose(translation, rotation, scale);
      requireThat(composed.elements.every((value, index) => Number.isFinite(value)
        && Math.abs(value - matrix.elements[index]) <= 1e-6 * Math.max(1, Math.abs(matrix.elements[index]))),
      `${label} 节点矩阵不能包含剪切变换`);
      // Match the loader's actual recomposition, including floating-point
      // rounding, instead of bounding the unmodified input matrix.
      matrix.copy(composed);
    }
    else {
      requireThat(finiteArray(node.translation ?? [0,0,0],3) && finiteArray(node.rotation ?? [0,0,0,1],4) && finiteArray(node.scale ?? [1,1,1],3), `${label} 节点变换无效`);
      matrix.compose(new Vector3().fromArray(node.translation ?? [0,0,0]), new Quaternion().fromArray(node.rotation ?? [0,0,0,1]), new Vector3().fromArray(node.scale ?? [1,1,1]));
    }
    matrix.premultiply(parent);
    requireThat(matrix.elements.every(Number.isFinite) && Math.abs(matrix.determinant()) > 1e-10, `${label} 节点变换不可用`);
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh]; requireThat(mesh?.primitives?.length > 0 && !mesh.weights, `${label} mesh 无效`); forbidExtras(mesh);
      for (const primitive of mesh.primitives) {
        forbidExtras(primitive); primitiveCount++;
        requireThat(primitiveCount <= 256 && (primitive.mode ?? 4) === 4 && !primitive.targets, `${label} 只支持静态三角形`);
        const position = accessor(primitive.attributes?.POSITION,'VEC3',[5126]);
        requireThat(object(primitive.attributes), `${label} attributes 格式错误`);
        for (const [semantic,index] of Object.entries(primitive.attributes)) {
          const kind = semantic === 'POSITION' || semantic === 'NORMAL' ? 'VEC3' : semantic === 'TANGENT' ? 'VEC4'
            : semantic === 'TEXCOORD_0' ? 'VEC2' : semantic === 'COLOR_0' && ['VEC3','VEC4'].includes(accessors[index]?.type) ? accessors[index].type : null;
          requireThat(kind, `${label} 不支持属性 ${semantic}`, 'ugc_unsupported_gltf');
          const attribute = accessor(index,kind,[5126]);
          requireThat(attribute.count === position.count, `${label} ${semantic === 'TEXCOORD_0' ? 'UV' : semantic} 数量与顶点不一致`);
          const channels = {VEC2:2,VEC3:3,VEC4:4}[kind];
          for (let i=0;i<attribute.count;i++) for (let axis=0;axis<channels;axis++) attribute.read(i,axis);
        }
        if (!collision) {
          const material = materials[primitive.material]; requireThat(material, '每个可见网格都需要 PBR 材质');
          if (primitive.attributes.NORMAL !== undefined) {
            const normal = accessor(primitive.attributes.NORMAL,'VEC3',[5126]);
            requireThat(normal.count === position.count, '法线数量与顶点不一致');
            for (let i=0;i<normal.count;i++) for (let axis=0;axis<3;axis++) normal.read(i,axis);
          }
          const hasMaps = material.pbrMetallicRoughness?.baseColorTexture || material.pbrMetallicRoughness?.metallicRoughnessTexture || material.normalTexture || material.emissiveTexture || material.occlusionTexture;
          if (hasMaps) { const uv = accessor(primitive.attributes.TEXCOORD_0,'VEC2',[5126]); requireThat(uv.count === position.count, '贴图 UV 数量与顶点不一致'); for(let i=0;i<uv.count;i++){uv.read(i,0);uv.read(i,1);} }
        }
        const indices = primitive.indices === undefined ? undefined : accessor(primitive.indices,'SCALAR',[5121,5123,5125]);
        const count = indices?.count ?? position.count;
        requireThat(count % 3 === 0, `${label} 三角形索引不完整`); triangles += count / 3;
        requireThat(triangles <= (collision ? 5000 : 100000), `${label} 三角形预算超限`, 'ugc_geometry_budget');
        for (let i=0;i<count;i++) { const vertex = indices ? indices.read(i) : i; requireThat(vertex < position.count, `${label} 顶点索引越界`); }
        for (let i=0;i<position.count;i++) {
          const p = new Vector3(position.read(i,0),position.read(i,1),position.read(i,2)).applyMatrix4(matrix);
          requireThat(p.toArray().every(Number.isFinite), `${label} 顶点变换溢出`); min.min(p); max.max(p);
        }
      }
    }
    requireThat(!node.children || (Array.isArray(node.children) && node.children.length <= 512), `${label} 子节点格式错误`);
    for (const child of node.children ?? []) visit(child,matrix);
    visiting.delete(index); visited.add(index);
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]; requireThat(gltf.scenes?.length === 1 && scene && Array.isArray(scene.nodes) && scene.nodes.length > 0, `${label} 必须只含一个默认场景`);
  for (const index of scene.nodes) visit(index,new Matrix4());
  requireThat(visited.size === nodes.length, `${label} 含不属于默认场景的节点`);
  requireThat(triangles > 0 && min.x >= -.02 && min.y >= -.02 && min.z >= -.02
    && max.x <= parcel.width + .02 && max.y <= parcel.maxHeight + .02 && max.z <= parcel.depth + .02,
    `${label} 越出地块：局部范围应为 X 0–${parcel.width}、Y 0–${parcel.maxHeight}、Z 0–${parcel.depth} 米`, 'ugc_outside_parcel');
  return { triangles, materials:materials.length, primitives:primitiveCount, textureResidentEstimateBytes:Math.ceil(textureBytes), bounds:{min:min.toArray(),max:max.toArray()} };
}

export async function validateUgcPackage(files, parcelId) {
  try {
  const parcel = UGC_PARCELS.find(p => p.id === parcelId); requireThat(parcel, '未知共建地块');
  const manifest = json(files.get('manifest.json'),'manifest.json');
  const allowed = ['schemaVersion','buildingId','slotId','revision','baseRevision','name','summary','target','authors','files','coordinates','interfaces','dependencies','previews'];
  requireThat(object(manifest) && Object.keys(manifest).every(key => allowed.includes(key)), 'manifest 含未知字段');
  requireThat(manifest.schemaVersion === 'city.building.v1' && manifest.buildingId === parcel.buildingId && manifest.slotId === 'shell', 'manifest 建筑编号或协议与所选地块不一致', 'ugc_target_mismatch');
  requireThat(text(manifest.revision,40) && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.revision) && text(manifest.name,80), '请填写建筑名称与语义版本号');
  requireThat(manifest.target?.parcelId === parcel.id && manifest.target.districtId === UGC_DISTRICT_ID && manifest.target.parcelRevision === UGC_PARCEL_REVISION, '投稿目标或地块合同版本不匹配', 'ugc_target_mismatch');
  requireThat(manifest.coordinates?.units === 'metres' && manifest.coordinates.gameUp === '+Y' && manifest.coordinates.origin === 'parcel-local-origin', '模型必须使用地块局部米制、Y-up 坐标');
  requireThat(Array.isArray(manifest.authors) && manifest.authors.length > 0 && manifest.authors.length <= 20 && manifest.authors.every(a => object(a) && text(a.displayName,80)), '请填写作者署名');
  requireThat(manifest.dependencies === undefined || (Array.isArray(manifest.dependencies) && manifest.dependencies.length === 0), '运行资源必须自包含，不接收外部依赖');
  const paths = { source:'source/building.blend',render:'runtime/shell.glb',collision:'runtime/collision.glb',provenance:'provenance.json' };
  requireThat(object(manifest.files) && Object.keys(manifest.files).length === 4 && Object.entries(paths).every(([key,path])=>manifest.files[key]===path && files.has(path)), 'manifest.files 必须引用完整的标准源文件、可见 GLB、碰撞 GLB 和来源记录');
  const source = files.get(paths.source);
  requireThat(source.length >= 12 && source.toString('ascii',0,7) === 'BLENDER', 'source/building.blend 必须是真实、未压缩的 Blender 文件，不能使用 LFS 指针');
  const provenance = json(files.get(paths.provenance),'provenance.json'); requireThat(object(provenance) && Object.keys(provenance).length > 0, '请填写来源与许可记录');
  requireThat(files.has('README.md') && files.get('README.md').length > 0 && files.get('README.md').length <= 256 * 1024, '请提供 README.md 制作与验证说明');
  const textureFiles = [...files.keys()].filter(name=>name.startsWith('textures/') && imageMime(name));
  requireThat(textureFiles.length > 0, 'textures/ 必须包含实际可编辑贴图', 'ugc_material_missing');
  for (const name of textureFiles) imageSize(files.get(name),imageMime(name));
  requireThat(Array.isArray(manifest.previews) && manifest.previews.length > 0 && manifest.previews.length <= 12, '至少提供一张实际模型预览');
  for (const name of manifest.previews) { requireThat(typeof name === 'string' && name.startsWith('previews/') && imageMime(name) && files.has(name), 'manifest.previews 引用的预览不存在'); imageSize(files.get(name),imageMime(name)); }
  const runtimeBytes = files.get(paths.render).length + files.get(paths.collision).length;
  requireThat(runtimeBytes <= UGC_LIMITS.runtimeBytes, '运行资源超过 20 MiB', 'ugc_runtime_budget');
  const render = inspectUgcGlb(files.get(paths.render),parcel), collision = inspectUgcGlb(files.get(paths.collision),parcel,true);
  // Decode sequentially under the input-pixel/time caps. Merely recognizing
  // IHDR/SOF dimensions does not establish that a texture can actually load.
  for (const name of new Set([...textureFiles,...manifest.previews])) await decodeImage(files.get(name),name);
  for (const kind of ['render','collision']) {
    let index = 0;
    for (const bytes of embeddedImages(files.get(paths[kind]))) await decodeImage(bytes,`${paths[kind]} image[${index++}]`);
  }
  return { manifest, report:{ checks:['目录与必交文件','地块与版本','可编辑源文件头','来源与制作说明','PBR 贴图与 UV 绑定','GLB 实际几何范围','简化碰撞与资源预算'],metrics:{runtimeBytes,render,collision},note:'自动格式检查不代替美术质量、来源权利或通行的人工确认。' } };
  } catch (error) {
    if (error?.status === 400) throw error;
    fail('建筑包或 GLB 数据结构无效，请检查 JSON、节点及数据引用后重新导出', 'ugc_invalid_package');
  }
}
