import * as THREE from 'three';
import {Batches} from './geometry.js';
import {buildCityHall} from './landmarks.js';
import {configureHallStoneMaterial, HALL_STONE_MATERIALS} from './hall-materials.js';

export function createCityHall(building, assetBase) {
  const palette = {stone: '#d1cbbc', trim: '#dad5c7', roof: '#475663', bronze: '#718779', paint: '#b1bbb0', glass: '#35433e', dark: '#343631'};
  const materials = Object.fromEntries(Object.entries(palette).map(([name,color]) => [
    name, new THREE.MeshStandardMaterial({color, vertexColors: true, side: THREE.DoubleSide, roughness: .8}),
  ]));
  const walls = new Batches(materials), details = new Batches(materials);
  buildCityHall(walls, details, undefined, {id: 'city-hall', polygon: building.ring, holes: building.holes, height: building.height});
  const loader = new THREE.TextureLoader();
  const textures = Object.fromEntries(['color','normal','roughness'].map(role => [role, loader.load(assetBase + role + '.jpg')]));
  for (const name of HALL_STONE_MATERIALS) configureHallStoneMaterial(materials[name], textures);
  return {
    walls: walls.build('City Hall'), details: details.build('City Hall ornament'),
    dispose() {
      Object.values(textures).forEach(texture => texture.dispose());
      Object.values(materials).forEach(material => material.dispose());
    },
  };
}
