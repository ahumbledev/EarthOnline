/** Immutable X/Z broadphase. Very large cells use a bounded overflow list. */
export function createCellIndex<T extends { bounds: { min: readonly number[]; max: readonly number[] } }>(cells: readonly T[], size = 64) {
  // Bucket coordinates are packed into one number: no string is built per lookup. Anything outside
  // the packable range (over 60,000 km from the origin) is simply tested on every query.
  const LIMIT = 1 << 20, key = (x: number, z: number) => (x + LIMIT) * (LIMIT * 2) + (z + LIMIT);
  const packable = (value: number) => value > -LIMIT && value < LIMIT;
  const buckets = new Map<number, number[]>(), large: number[] = [];
  cells.forEach((cell, index) => {
    const x0=Math.floor(cell.bounds.min[0]/size),x1=Math.floor(cell.bounds.max[0]/size);
    const z0=Math.floor(cell.bounds.min[2]/size),z1=Math.floor(cell.bounds.max[2]/size);
    if((x1-x0+1)*(z1-z0+1)>4096||![x0,x1,z0,z1].every(packable)){large.push(index);return;}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const k=key(x,z),bucket=buckets.get(k);if(bucket)bucket.push(index);else buckets.set(k,[index]);
    }
  });
  // Crowd and floor probes ask many times a frame: mark visited cells in a reused array instead of a Set.
  const visited = new Uint32Array(cells.length); let stamp = 0;
  const within = (cell: T, point: readonly number[], radius: number) => {
    const { min, max } = cell.bounds;
    return Math.hypot(Math.max(min[0]-point[0],0,point[0]-max[0]),Math.max(min[2]-point[2],0,point[2]-max[2]))<=radius;
  };
  return (point: readonly number[], radius: number): T[] => {
    if(!Number.isFinite(point[0])||!Number.isFinite(point[2])||radius<0)return [];
    if(!Number.isFinite(radius))return [...cells];
    const x0=Math.floor((point[0]-radius)/size),x1=Math.floor((point[0]+radius)/size);
    const z0=Math.floor((point[2]-radius)/size),z1=Math.floor((point[2]+radius)/size);
    if((x1-x0+1)*(z1-z0+1)>4096||![x0,x1,z0,z1].every(packable))return cells.filter(cell=>within(cell,point,radius));
    if(++stamp===0xffffffff){visited.fill(0);stamp=1;}
    const found: number[] = []; let lists = 0;
    if(large.length){lists++;for(const i of large){visited[i]=stamp;found.push(i);}}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const bucket=buckets.get(key(x,z));if(!bucket)continue;
      lists++;for(const i of bucket)if(visited[i]!==stamp){visited[i]=stamp;found.push(i);}
    }
    // Each list is already in cell order; only a merge of several needs sorting.
    if(lists>1)found.sort((a,b)=>a-b);
    const result: T[] = [];
    for(const i of found)if(within(cells[i],point,radius))result.push(cells[i]);
    return result;
  };
}
