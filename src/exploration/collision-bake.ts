import * as THREE from 'three';

export interface CollisionPart {
  positions: THREE.TypedArray; stride: number; offset: number; count: number; normalized: boolean;
  indices?: THREE.TypedArray; transforms: number[][];
}
export interface CollisionData { vertices: Float32Array; indices: Uint32Array }
/** Copy each shared geometry once. Never transfer buffers owned by a visible mesh. */
export function collectCollisionParts(environment: THREE.Object3D): CollisionPart[] {
  environment.updateWorldMatrix(true,true);
  const geometries=new Map<THREE.BufferGeometry,CollisionPart>();
  const matrix=new THREE.Matrix4();
  environment.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    for(let ancestor:THREE.Object3D|null=object;ancestor;ancestor=ancestor.parent){
      if(!ancestor.visible||ancestor.userData.collision===false)return;
      if(ancestor===environment)break;
    }
    const geometry=object.geometry,positions=geometry.getAttribute('position');
    if(!positions||positions.count<3||(geometry.index?.count??positions.count)<3)return;
    let part=geometries.get(geometry);
    if(!part){
      const interleaved=positions instanceof THREE.InterleavedBufferAttribute;
      part={positions:(interleaved?positions.data.array:positions.array).slice(),stride:interleaved?positions.data.stride:positions.itemSize,
        offset:interleaved?positions.offset:0,count:positions.count,normalized:positions.normalized,indices:geometry.index?.array.slice(),transforms:[]};
      geometries.set(geometry,part);
    }
    if(object instanceof THREE.InstancedMesh){for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);matrix.premultiply(object.matrixWorld);part.transforms.push(matrix.toArray());}}
    else part.transforms.push(object.matrixWorld.toArray());
  });
  return [...geometries.values()];
}

export function bakeCollisionParts(parts: CollisionPart[]): CollisionData {
  const vertexCount=parts.reduce((sum,p)=>sum+p.count*p.transforms.length,0);
  const indexCount=parts.reduce((sum,p)=>sum+Math.floor((p.indices?.length??p.count)/3)*3*p.transforms.length,0);
  if(!indexCount)throw new Error('The exploration environment has no collision geometry.');
  const vertices=new Float32Array(vertexCount*3),indices=new Uint32Array(indexCount),point=new THREE.Vector3(),matrix=new THREE.Matrix4();
  let vertexOffset=0,indexOffset=0;
  for(const part of parts){
    const position=new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(part.positions,part.stride),3,part.offset,part.normalized);
    for(const transform of part.transforms){
      matrix.fromArray(transform);
      for(let i=0;i<part.count;i++){
        point.fromBufferAttribute(position,i).applyMatrix4(matrix);
        const offset=(vertexOffset+i)*3;vertices[offset]=point.x;vertices[offset+1]=point.y;vertices[offset+2]=point.z;
        if(!Number.isFinite(vertices[offset])||!Number.isFinite(vertices[offset+1])||!Number.isFinite(vertices[offset+2]))throw new Error('Static collision contains invalid geometry.');
      }
      const count=Math.floor((part.indices?.length??part.count)/3)*3,mirrored=matrix.determinant()<0;
      for(let i=0;i<count;i+=3){
        const a=part.indices?.[i]??i,b=part.indices?.[i+1]??i+1,c=part.indices?.[i+2]??i+2;
        if(a<0||b<0||c<0||a>=part.count||b>=part.count||c>=part.count)throw new Error('Static collision contains invalid geometry.');
        indices[indexOffset++]=vertexOffset+a;indices[indexOffset++]=vertexOffset+(mirrored?c:b);indices[indexOffset++]=vertexOffset+(mirrored?b:c);
      }
      vertexOffset+=part.count;
    }
  }
  return {vertices,indices};
}

/** One worker per physics world; at most one main-thread collider commit per load. */
export function createCollisionBaker() {
  let worker:Worker|undefined,sequence=0,disposed=false;
  const pending=new Map<number,{resolve:(data:CollisionData)=>void;reject:(error:Error)=>void}>();
  function stop(error:Error){worker?.terminate();worker=undefined;for(const job of pending.values())job.reject(error);pending.clear();}
  return {
    async bake(root:THREE.Object3D):Promise<CollisionData>{
      if(disposed)throw new Error('Collision baker disposed');
      const parts=collectCollisionParts(root);
      if(typeof Worker==='undefined')return bakeCollisionParts(parts);
      if(!worker){
        worker=new Worker(new URL('./collision-bake.worker.ts',import.meta.url),{type:'module'});
        worker.onmessage=event=>{const {id,data,error}=event.data,job=pending.get(id);if(!job)return;pending.delete(id);if(error)job.reject(new Error(error));else job.resolve(data);};
        worker.onerror=event=>stop(new Error(event.message||'Collision worker failed'));
      }
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        pending.set(id,{resolve,reject});
        const transfer:ArrayBuffer[]=[];for(const p of parts){transfer.push(p.positions.buffer as ArrayBuffer);if(p.indices)transfer.push(p.indices.buffer as ArrayBuffer);}
        try{worker!.postMessage({id,parts},transfer);}catch(error){pending.delete(id);reject(error);}
      });
    },
    dispose(){disposed=true;stop(new Error('Collision baker disposed'));},
  };
}
