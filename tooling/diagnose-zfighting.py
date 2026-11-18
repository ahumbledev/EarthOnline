"""Read-only GLB overlap audit; positive-area coplanar geometry is a red result.

Does not alter models. Scans axis-aligned triangles by their geometric plane,
clips projected polygons, and distinguishes opposed box interfaces from
same-facing surfaces that can compete for the depth buffer.
"""
from __future__ import annotations

import argparse
import collections
import json
import struct
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    binary = memoryview(data)[28 + size:]
    def accessor(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        dtype = {5126:'<f4', 5125:'<u4', 5123:'<u2'}[a['componentType']]
        components = {'SCALAR':1, 'VEC2':2, 'VEC3':3}[a['type']]
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(binary, dtype=dtype, offset=start, count=a['count'] * components).reshape(a['count'], components)
    tris, mats = [], []
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            pos = accessor(p['attributes']['POSITION'])
            ids = accessor(p['indices']).ravel().reshape(-1,3)
            tris.append(pos[ids].astype(np.float64))
            mats.append(np.full(len(ids), p.get('material', -1), dtype=np.int32))
    return np.concatenate(tris), np.concatenate(mats), doc['materials']


def cross2(a,b):
    return a[0]*b[1]-a[1]*b[0]


def area2(poly):
    return sum(cross2(poly[i], poly[(i+1)%len(poly)]) for i in range(len(poly)))


def overlap(a,b):
    """Sutherland-Hodgman clipping, returning area of triangle intersection."""
    poly = [p for p in a]
    if area2(b)<0: b = b[::-1]
    for i in range(3):
        edge = b[(i+1)%3]-b[i]
        if not poly: return 0.
        output=[]
        for j,e in enumerate(poly):
            s=poly[j-1]
            ds=cross2(edge,s-b[i]); de=cross2(edge,e-b[i])
            if de >= -1e-9:
                if ds < -1e-9: output.append(s+(e-s)*(ds/(ds-de)))
                output.append(e)
            elif ds >= -1e-9:
                output.append(s+(e-s)*(ds/(ds-de)))
        poly=output
    return abs(area2(poly))/2 if len(poly)>2 else 0.


def audit(path, min_area=.0025):
    start=time.monotonic()
    tris,mats,materials=load(path)
    normals=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
    area=np.linalg.norm(normals,axis=1)/2
    spans=np.ptp(tris,axis=1)
    axis=np.argmin(spans,axis=1)
    axis_aligned=(spans.min(axis=1)<0.00001)&(area>min_area)
    ids=np.flatnonzero(axis_aligned)
    # float32 positions of the original meshes can differ by a few microns.
    planes=np.rint(tris[ids,0,axis[ids]]*10000).astype(np.int64)
    keys=axis[ids].astype(np.int64)*100000000+planes+20000000
    order=np.argsort(keys,kind='stable')
    groups=np.split(ids[order],np.flatnonzero(np.diff(keys[order]))+1)
    top=[]; pairs=0; candidates=0; material_areas=collections.Counter(); opposed=0
    print(f'AUDIT {len(tris)} triangles; {len(ids)} axis triangles; {len(groups)} planes',flush=True)
    for gi,g in enumerate(groups):
        if len(g)<2:continue
        ax=int(axis[g[0]]); pair=[x for x in range(3) if x!=ax]
        uv=tris[g][:,:,pair]
        low=uv.min(axis=1);high=uv.max(axis=1)
        uorder=np.argsort(low[:,0],kind='stable')
        for p,k in enumerate(uorder):
            left=uorder[:p]
            if not len(left):continue
            hit=left[(high[left,0]>low[k,0]+1e-6)&(high[left,1]>low[k,1]+1e-6)&(low[left,1]<high[k,1]-1e-6)]
            for j in hit:
                candidates+=1
                inter=overlap(uv[k],uv[j])
                if inter<min_area:continue
                a,b=int(g[k]),int(g[j]);pairs+=1
                same=normals[a,ax]*normals[b,ax]>0
                if not same:opposed+=1
                ma,mb=int(mats[a]),int(mats[b])
                ka,kb=sorted((ma,mb))
                if same: material_areas[(ka,kb)]+=inter
                row={'area_m2':round(inter,6),'same_facing':bool(same),'axis':'XYZ'[ax],
                     'plane':round(float(tris[a,0,ax]),6),'triangles':[a,b],
                     'materials':[materials[ma]['name'],materials[mb]['name']],
                     'bounds_a':np.round([tris[a].min(axis=0),tris[a].max(axis=0)],5).tolist(),
                     'bounds_b':np.round([tris[b].min(axis=0),tris[b].max(axis=0)],5).tolist()}
                top.append(row)
        if gi%2000==0:print(f'plane {gi}/{len(groups)}; overlaps {pairs}; candidates {candidates}',flush=True)
    top.sort(key=lambda x:(x['same_facing'],x['area_m2']),reverse=True)
    return {'asset':path.name,'elapsed_seconds':round(time.monotonic()-start,3),
            'triangles':len(tris),'axis_triangles_scanned':len(ids),'min_overlap_area_m2':min_area,
            'positive_area_overlap_pairs':pairs,'same_facing_pairs':pairs-opposed,'opposed_facing_pairs':opposed,
            'material_overlap_area':[{ 'materials':[materials[a]['name'],materials[b]['name']], 'same_facing_pair_area_m2':round(v,6)} for (a,b),v in material_areas.most_common()],
            'largest_overlaps':top[:1000],
            'scope':'Axis-aligned co/near-coplanar triangles within 0.1 mm plane buckets. Opposed touching solid interfaces are counted separately; same-facing overlaps can z-fight. Area totals double-count intersections and are not union area.',
            'status':'RED' if pairs-opposed else 'GREEN'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--asset',required=True);parser.add_argument('--report',required=True);parser.add_argument('--min-area',type=float,default=.0025)
    args=parser.parse_args();report=audit(ROOT/args.asset,args.min_area)
    (ROOT/args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in {'largest_overlaps','material_overlap_area'}},ensure_ascii=False))
    print(json.dumps(report['material_overlap_area'][:20],ensure_ascii=False,indent=2))
