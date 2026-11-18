import { bakeCollisionParts } from './collision-bake.ts';
self.onmessage=event=>{
  const {id,parts}=event.data;
  try { const data=bakeCollisionParts(parts);self.postMessage({id,data}, {transfer:[data.vertices.buffer,data.indices.buffer]}); }
  catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
