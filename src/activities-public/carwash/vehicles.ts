/** Wash-map UVs, part ownership and sky exposure for the three local vehicle models. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rasterizeUV, dilate, type Baked } from './bake.ts';
import type { PartKind, PartSpec } from './rules.ts';
const hatchModel = import.meta.env.BASE_URL + 'vehicles/hatch.glb';
import hatchParts from './vehicles/hatch/parts.png?url';
import hatchAccess from './vehicles/hatch/access.png?url';
import hatchMeta from './vehicles/hatch/vehicle.json?url';
const sedanModel = import.meta.env.BASE_URL + 'vehicles/sedan.glb';
import sedanParts from './vehicles/sedan/parts.png?url';
import sedanAccess from './vehicles/sedan/access.png?url';
import sedanMeta from './vehicles/sedan/vehicle.json?url';
const vanModel = import.meta.env.BASE_URL + 'vehicles/van.glb';
import vanParts from './vehicles/van/parts.png?url';
import vanAccess from './vehicles/van/access.png?url';
import vanMeta from './vehicles/van/vehicle.json?url';

export interface VehicleMeta {
  id:string; slug:string; name:string; washMap:number; accessMap:number;
  dimensions:[number,number,number]; wheels:{x:number;y:number;z:number;radius:number;width:number}[];
  parts:(PartSpec & {kind:PartKind})[]; texelsPerMetre:number;
}
const PACKS:Record<string,{model:string;parts:string;access:string;meta:string}> = {
  hatch:{model:hatchModel,parts:hatchParts,access:hatchAccess,meta:hatchMeta},
  sedan:{model:sedanModel,parts:sedanParts,access:sedanAccess,meta:sedanMeta},
  van:{model:vanModel,parts:vanParts,access:vanAccess,meta:vanMeta},
};
/** The bare models, for cars that only stand in the street outside the bay. */
export const VEHICLE_MODEL_URLS={hatch:hatchModel,sedan:sedanModel,van:vanModel};
export interface LoadedVehicle {
  meta:VehicleMeta; root:THREE.Group;
  /** Meshes carrying the wash-map UV set (washed, dirtied, counted per parts map). */
  washMeshes:THREE.Mesh[];
  baked:Baked;
  /** 255 = no owner; low 7 bits = owning part; bit 7 = washed with that part but not counted. */
  partOf:Uint8Array; access:Uint8Array;
}
async function gray(url:string,size:number){
  const bitmap=await createImageBitmap(await (await fetch(url)).blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  if(bitmap.width!==size||bitmap.height!==size)throw Error(`清洗贴图尺寸不符：${url}`);
  const canvas=new OffscreenCanvas(size,size),context=canvas.getContext('2d',{willReadFrequently:true})!;
  context.drawImage(bitmap,0,0);bitmap.close();
  const rgba=context.getImageData(0,0,size,size).data,out=new Uint8Array(size*size);
  for(let i=0;i<out.length;i++)out[i]=rgba[i*4];
  return out;
}
export async function loadVehicle(key:string):Promise<LoadedVehicle>{
    const pack=PACKS[key],meta=await (await fetch(pack.meta)).json() as VehicleMeta;
    const [gltf,partOf,access]=await Promise.all([new GLTFLoader().loadAsync(pack.model),gray(pack.parts,meta.washMap),gray(pack.access,meta.accessMap)]);
    const root=new THREE.Group();root.name=meta.slug;root.add(...gltf.scene.children);root.updateMatrixWorld(true);
    const washMeshes:THREE.Mesh[]=[];
    root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;if(o.geometry.getAttribute('uv'))washMeshes.push(o);}});
    const meshes=washMeshes.map(m=>{const g=m.geometry.clone().applyMatrix4(m.matrixWorld);const out={positions:g.getAttribute('position').array,normals:g.getAttribute('normal').array,uvs:g.getAttribute('uv').array,indices:g.index!.array};return out;});
    const baked=dilate(rasterizeUV(meshes,meta.washMap),3);
    return {meta,root,washMeshes,baked,partOf,access};

}

export function disposeVehicle(vehicle:LoadedVehicle){
  const resources=new Set<{dispose():void}>();
  vehicle.root.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    resources.add(node.geometry);
    for(const material of [node.material].flat()){
      resources.add(material);
      for(const value of Object.values(material))if(value instanceof THREE.Texture)resources.add(value);
    }
  });
  for(const resource of resources)resource.dispose();
}
