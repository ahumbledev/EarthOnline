import * as THREE from 'three';
import { createCityHall } from '../city-layers/philadelphia/city-hall.js';
import type { CityMap } from '../maps/index.ts';
import { attachCityFacade, createDistrictSky, facadeStyle, usesEncodedFacade } from '../city-layers/index.ts';

type Point = readonly [number, number];
type Ring = readonly Point[];
const asphalt = import.meta.env.BASE_URL + 'materials/asphalt/worn_asphalt_diff_2k.jpg';

class Triangles {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  vertex(x: number, y: number, z: number, u: number, v: number, color: THREE.Color) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    this.colors.push(color.r, color.g, color.b);
  }
  mesh(material: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}
function openRing(points: Ring): Ring {
  const a = points[0], b = points.at(-1);
  return a && b && a[0] === b[0] && a[1] === b[1] ? points.slice(0, -1) : points;
}
function horizontal(batch: Triangles, outer: Ring, holes: readonly Ring[], y: number, color: THREE.Color) {
  const rings = [outer, ...holes].map(ring => openRing(ring).map(([x,z]) => new THREE.Vector2(x,z)));
  if (rings[0].length < 3) return;
  const points = rings.flat();
  for (const face of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
    for (const i of [face[2], face[1], face[0]]) {
      const {x,y:z} = points[i];
      batch.vertex(x,y,z,x/5,z/5,color);
    }
  }
}
interface FacadeAttributes { dimensions: number[]; flags: number[]; style: number; seed: number }
function perimeter(batch: Triangles, ring: Ring, height: number, color: THREE.Color, attributes?: FacadeAttributes) {
  const p = openRing(ring);
  for (let i=0; i<p.length; i++) {
    const a=p[i], b=p[(i+1)%p.length], d=Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (!d) continue;
    for (const [point,y,u] of [[a,0,0],[b,0,d],[b,height,d],[a,0,0],[b,height,d],[a,height,0]] as const) {
        batch.vertex(point[0],y,point[1],u,y,color);
        if (attributes) {
          attributes.dimensions.push(d * 100, height * 100);
          attributes.flags.push(80 + attributes.style, attributes.seed);
        }
      }
  }
}
function strip(batch: Triangles, a: Point, b: Point, width:number, y:number, tint:THREE.Color) {
  const dx=b[0]-a[0], dz=b[1]-a[1], length=Math.hypot(dx,dz);
  if (!length) return;
  const sideX=-dz/length*width/2, sideZ=dx/length*width/2;
  const quad:Point[]=[[a[0]+sideX,a[1]+sideZ],[b[0]+sideX,b[1]+sideZ],[b[0]-sideX,b[1]-sideZ],[a[0]-sideX,a[1]-sideZ]];
  for(const i of [0,1,2,0,2,3]){
    const [x,z]=quad[i];batch.vertex(x,y,z,x/5,z/5,tint);
  }
}
const pale = new THREE.Color('#ded8c4');
const roof = new THREE.Color('#b9b9a8');
const road = new THREE.Color('#cac6bf');
const park = new THREE.Color('#8eab79');
const pavement = new THREE.Color('#c1b7a3');
const lane = new THREE.Color('#e5cf9b');
const palettes = ['#c89b7c','#d7c4a7','#c8bdac','#d4b39b','#a7b9b4','#d5c6a7'].map(c=>new THREE.Color(c));

export function createDistrict(map: CityMap, renderer: THREE.WebGLRenderer) {
  const root = new THREE.Group(), solids = new THREE.Group();
  root.add(solids);
  const [x0,z0,x1,z1]=map.bounds;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1-x0+120,z1-z0+120),new THREE.MeshStandardMaterial({color:pale,roughness:1}));
  floor.rotation.x=-Math.PI/2;
  floor.position.set((x0+x1)/2,0,(z0+z1)/2);solids.add(floor);

  const walls=new Triangles(), tops=new Triangles(), greens=new Triangles(), streets=new Triangles(), sidewalks=new Triangles(), markings=new Triangles();
  const attributes = usesEncodedFacade(map.id) ? {dimensions: [] as number[], flags: [] as number[], seed: 0, style: 0} : undefined;
  let cityHall: ReturnType<typeof createCityHall> | undefined;
  map.buildings.forEach((building,index)=>{
    if (building.landmark === 'city-hall') {
      cityHall = createCityHall(building, import.meta.env.BASE_URL + 'maps/stone/');
      solids.add(cityHall.walls);
      root.add(cityHall.details);
      return;
    }
    const h=Math.max(2.5,building.height), color=palettes[index%palettes.length];
    if (attributes) {
      const [x, z] = building.ring[0];
      attributes.seed = Math.abs((Math.round(x * 10) * 31) ^ Math.round(z * 10)) % 256;
      attributes.style = facadeStyle(map.id, h, attributes.seed);
    }
    for(const ring of [building.ring,...(building.holes??[])]) perimeter(walls,ring,h,color,attributes);
    horizontal(tops,building.ring,building.holes??[],h,roof);
  });
  for(const surface of map.parks) horizontal(greens,surface.ring,surface.holes??[],.025,park);
  for(const surface of map.roadAreas??[]) horizontal(streets,surface.ring,surface.holes??[],.06,road);
  for(const street of map.roads) {
    for(let i=1;i<street.points.length;i++) {
      const a=street.points[i-1],b=street.points[i],width=Math.max(1.4,street.width);
      strip(sidewalks,a,b,width+2,.04,pavement);
      if (!map.roadAreas?.length) strip(streets,a,b,width,.06,road);
      if(width>=5.8) strip(markings,a,b,.1,.09,lane);
    }
  }
  const facade=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.84});
  const night = {value:0};
  facade.onBeforeCompile=shader=>{
    shader.uniforms.atlasNight=night;
    shader.vertexShader='varying vec2 facadeUV;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nfacadeUV=uv;');
    shader.fragmentShader='uniform float atlasNight; varying vec2 facadeUV;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 tile=facadeUV/vec2(3.1,3.25);
      vec2 p=fract(tile);
      vec2 aa=min(fwidth(tile),vec2(.12));
      vec2 glass=smoothstep(vec2(.14,.23)-aa,vec2(.14,.23)+aa,p)*(1.-smoothstep(vec2(.79,.83)-aa,vec2(.79,.83)+aa,p));
      float window=glass.x*glass.y;
      float light=step(.66,fract(sin(dot(floor(tile),vec2(12.9898,78.233)))*43758.5453));
      diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.17,.26,.28),vec3(.96,.71,.36),atlasNight*light),window*.88);
      diffuseColor.rgb*=.85+.15*smoothstep(.0,.06,p.y);
    `);
  };
  const wallMesh = walls.mesh(facade);
  if (attributes) {
    wallMesh.geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(attributes.dimensions, 2));
    wallMesh.geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(attributes.flags, 2));
  }
  if (map.waterAreas?.length) {
    const water = new Triangles();
    const blue = new THREE.Color('#486f84');
    for (const surface of map.waterAreas) horizontal(water, surface.ring, surface.holes ?? [], .03, blue);
    root.add(water.mesh(new THREE.MeshStandardMaterial({vertexColors: true, side: THREE.DoubleSide, roughness: .3})));
  }
  const cityFacade = attachCityFacade(map.id, renderer, facade, night);
  const sky = createDistrictSky(map.id);
  root.add(sky.mesh);
  solids.add(wallMesh,tops.mesh(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide})));
  const texture=new THREE.TextureLoader().load(asphalt);
  texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=4;
  const flat=()=>new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1});
  root.add(greens.mesh(flat()),sidewalks.mesh(flat()),markings.mesh(flat()),streets.mesh(new THREE.MeshStandardMaterial({map:texture,vertexColors:true,side:THREE.DoubleSide,roughness:1})));
  return {root,solids,night,
    updateLook(sunDirection: readonly [number, number, number], darkness: number, elapsed: number, cameraPosition: THREE.Vector3, hour: number) {
      night.value = darkness;
      const look = sky.update(sunDirection, darkness, elapsed, cameraPosition, hour);
      if (cityFacade) {
        cityFacade.uniforms.uBcSunDir.value.set(...sunDirection);
        cityFacade.uniforms.uBcTime.value = elapsed;
        cityFacade.uniforms.uBcSkyTop.value.copy(look.zenith);
        cityFacade.uniforms.uBcSkyHorizon.value.copy(look.horizon);
      }
      return look;
    },
    dispose(){
    cityFacade?.dispose();
    cityHall?.dispose();
    root.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose(); if(!Array.isArray(node.material))node.material.dispose();}});
    texture.dispose();root.removeFromParent();
  }};
}
