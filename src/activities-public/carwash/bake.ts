/** Unwraps a vehicle onto its own UV0 atlas: for every wash-map texel, which mesh it belongs to and where it sits
 * on the car (vehicle space, metres, +Y up, +Z forward). Pure, so the offline pack tool and the game use the same code.
 * Washing then happens in 3D (gpu.ts), so UV islands and seams never decide what gets cleaned. */
export interface BakeMesh {positions:ArrayLike<number>; normals:ArrayLike<number>; uvs:ArrayLike<number>; indices:ArrayLike<number>}
export interface Baked {
  size:number;
  /** xyz position, w = mesh index + 1 (0 = empty texel). */
  position:Float32Array;
  /** xyz unit normal, w = 1 inside a triangle, 0.5 in the dilated gutter, 0 empty. */
  normal:Float32Array;
  /** Triangle index across all meshes in order (-1 = empty or gutter). */
  face:Int32Array;
}
export function rasterizeUV(meshes:readonly BakeMesh[],size:number):Baked {
  const position=new Float32Array(size*size*4),normal=new Float32Array(size*size*4),face=new Int32Array(size*size).fill(-1);
  let base=0;
  meshes.forEach((mesh,m)=>{
    const P=mesh.positions,N=mesh.normals,U=mesh.uvs,I=mesh.indices;
    for(let t=0;t<I.length;t+=3){
      const a=I[t],b=I[t+1],c=I[t+2];
      // glTF UV origin is top-left; texel row 0 is v=0 so it matches DataTexture with flipY=false.
      const x0=U[a*2]*size,y0=U[a*2+1]*size,x1=U[b*2]*size,y1=U[b*2+1]*size,x2=U[c*2]*size,y2=U[c*2+1]*size;
      const den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2);if(Math.abs(den)<1e-12)continue;
      const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2))),maxX=Math.min(size-1,Math.ceil(Math.max(x0,x1,x2)));
      const minY=Math.max(0,Math.floor(Math.min(y0,y1,y2))),maxY=Math.min(size-1,Math.ceil(Math.max(y0,y1,y2)));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const px=x+.5,py=y+.5;
        let w0=((y1-y2)*(px-x2)+(x2-x1)*(py-y2))/den,w1=((y2-y0)*(px-x2)+(x0-x2)*(py-y2))/den,w2=1-w0-w1;
        // Conservative edge: texels whose centre is just outside still belong to the nearest triangle.
        const e=-.5/Math.max(1,Math.sqrt(Math.abs(den)));
        if(w0<e||w1<e||w2<e)continue;
        const k=(y*size+x)*4;
        if(normal[k+3]===1&&(w0<0||w1<0||w2<0))continue;
        w0=Math.max(0,w0);w1=Math.max(0,w1);w2=Math.max(0,w2);const s=w0+w1+w2;w0/=s;w1/=s;w2/=s;
        position[k]=P[a*3]*w0+P[b*3]*w1+P[c*3]*w2;position[k+1]=P[a*3+1]*w0+P[b*3+1]*w1+P[c*3+1]*w2;position[k+2]=P[a*3+2]*w0+P[b*3+2]*w1+P[c*3+2]*w2;position[k+3]=m+1;
        let nx=N[a*3]*w0+N[b*3]*w1+N[c*3]*w2,ny=N[a*3+1]*w0+N[b*3+1]*w1+N[c*3+1]*w2,nz=N[a*3+2]*w0+N[b*3+2]*w1+N[c*3+2]*w2;
        const l=Math.hypot(nx,ny,nz)||1;normal[k]=nx/l;normal[k+1]=ny/l;normal[k+2]=nz/l;normal[k+3]=(w0>=0&&w1>=0&&w2>=0)?1:.99;
        face[y*size+x]=base+t/3;
      }
    }
    base+=I.length/3;
  });
  for(let k=3;k<normal.length;k+=4)if(normal[k]>0)normal[k]=1;
  return {size,position,normal,face};
}
/** Copies each island's edge texels outward so bilinear sampling at seams reads washed values, not stale gutter. */
export function dilate(baked:Baked,steps=4){
  const {size,position,normal}=baked,source=new Int32Array(size*size);
  const near=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  for(let step=0;step<steps;step++){
    let count=0;source.fill(-1);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x;if(normal[i*4+3]>0)continue;
      for(const [dx,dy] of near){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=size||ny>=size)continue;
        const j=ny*size+nx;if(normal[j*4+3]>0){source[i]=j;count++;break;}}
    }
    if(!count)break;
    for(let i=0;i<source.length;i++){const j=source[i];if(j<0)continue;
      for(let c=0;c<4;c++){position[i*4+c]=position[j*4+c];normal[i*4+c]=normal[j*4+c];}normal[i*4+3]=.5;}
  }
  return baked;
}
