import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {collectCollisionParts,bakeCollisionParts,createCollisionBaker} from '../../src/exploration/collision-bake.ts';
import {createPlayerController} from '../../src/exploration/player.ts';

test('worker inputs preserve normalized interleaved attributes, mirrored winding and instance transforms without detaching source data',async()=>{
 const geometry=new THREE.BufferGeometry();
 const array=new Int16Array([9,0,0,0,9,32767,0,0,9,0,32767,0]);
 geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(array,4),3,1,true));
 geometry.setIndex([0,1,2]);const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),2);
 mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(5,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(-1,1,1));
 const parts=collectCollisionParts(mesh),data=bakeCollisionParts(parts);
 assert.equal(parts.length,1);assert.equal(parts[0].transforms.length,2);
 assert.deepEqual([...data.vertices],[5,0,0,6,0,0,5,1,0,0,0,0,-1,0,0,0,1,0]);
 assert.deepEqual([...data.indices],[0,1,2,3,5,4]);assert.equal(array.byteLength,24);
 const baker=createCollisionBaker();assert.deepEqual(await baker.bake(mesh),data);baker.dispose();await assert.rejects(baker.bake(mesh));
 geometry.dispose();mesh.material.dispose();
});

test('collision baking excludes hidden decoration and rejects invalid geometry before Rapier',()=>{
 const root=new THREE.Group(),solid=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),hidden=solid.clone();hidden.visible=false;root.add(solid,hidden);
 const parts=collectCollisionParts(root);assert.equal(parts[0].transforms.length,1);
 parts[0].positions[0]=NaN;assert.throws(()=>bakeCollisionParts(parts),/invalid geometry/);
 solid.geometry.dispose();solid.material.dispose();
});

test('async collider install and kinematic door updates keep real floor and camera queries current',async()=>{
 const material=new THREE.MeshBasicMaterial(),floor=new THREE.Mesh(new THREE.BoxGeometry(20,.2,20),material);floor.position.y=-.1;
 const player=await createPlayerController(floor,new THREE.Vector3(0,.04,0));
 const door=new THREE.Mesh(new THREE.BoxGeometry(.1,2,3),material);door.position.set(2,1,0);door.updateMatrixWorld();
 try{
  player.setKinematicCollision('door',door,door.position,new THREE.Quaternion());
  const target=new THREE.Vector3(0,1,0),desired=new THREE.Vector3(5,1,0);
  assert.ok(player.constrainCamera(target,desired).x<2);
  for(let i=1;i<=20;i++){player.moveKinematicCollision('door',new THREE.Vector3(2+i*.1,1,0),new THREE.Quaternion());player.update(1/60,new THREE.Vector3(),false,false);}
  assert.ok(player.constrainCamera(target,desired).x>3.5);
  assert.ok(Math.abs(player.floorHeight(0,0,1,2))<.001);
  const curb=new THREE.Mesh(new THREE.BoxGeometry(1,.2,1),material);curb.position.set(6,.1,0);
  await player.setStaticCollisionAsync('curb',curb);assert.ok(Math.abs(player.floorHeight(6,0,1,2)-.2)<.001);
  assert.equal(player.removeStaticCollision('door'),true);assert.ok(player.constrainCamera(target,desired).x>4.9);
  curb.geometry.dispose();
 }finally{player.dispose();floor.geometry.dispose();door.geometry.dispose();material.dispose();}
});
