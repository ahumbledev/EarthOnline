import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textileUrl, createFabricMaterial, loadFabricMaterials, disposeFabricMaterials } from './materials.ts';

type Stage = 'design' | 'cut' | 'sew' | 'finish' | 'wardrobe';
type Activity = { pedal: number; progress: number; offset: number };
const Y = new THREE.Vector3(0, 1, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a87845'; ctx.fillRect(0, 0, 1024, 512);
  let random = 8719;
  const rand = () => { random = (random * 1664525 + 1013904223) >>> 0; return random / 4294967296; };
  for (let i = 0; i < 1300; i++) {
    const y = rand() * 512; const amplitude = 1 + rand() * 7;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const grain = y + Math.sin(x * .009 + y * .04) * amplitude + Math.sin(x * .021 + y) * 1.6;
      if (x === 0) ctx.moveTo(x, grain); else ctx.lineTo(x, grain);
    }
    ctx.strokeStyle = rand() > .65 ? `rgba(246,209,148,${.05 + rand() * .12})` : `rgba(75,42,18,${.025 + rand() * .13})`;
    ctx.lineWidth = .3 + rand() * 1.1; ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function labelTexture(text: string, subtitle = '', background = '#f3e5cc', foreground = '#32271d'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = foreground; ctx.lineWidth = 3; ctx.strokeRect(14, 14, 996, 228);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = foreground;
  ctx.font = '54px Georgia, serif'; ctx.fillText(text, 512, subtitle ? 103 : 128);
  if (subtitle) { ctx.font = '22px Georgia, serif'; ctx.fillText(subtitle, 512, 177); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function clothGeometry(width: number, depth: number, drape: number, waves = .012, edgeStart = .69): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, depth, 58, 48);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edge = Math.max(0, (z / depth + .5 - edgeStart) / (1 - edgeStart));
    pos.setY(i, (Math.sin(x * 21 + z * 8) + Math.sin(x * 13 - z * 11) * .35) * waves * (.65 + edge) - edge * edge * drape);
    if (edge > 0) pos.setZ(i, z - edge * edge * drape * .24);
  }
  geometry.computeVertexNormals(); return geometry;
}

/** Self-contained metre-scale craft room; runtime source is the editable asset. */
export function createAtelierScene(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d8cbb7');
  scene.fog = new THREE.Fog('#d8cbb7', 5, 12);
  const camera = new THREE.PerspectiveCamera(42, 1, .025, 30);
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const workshop = new THREE.Group(); workshop.name = 'atelier-workshop-v1'; scene.add(workshop);
  const presentation = new THREE.Group(); presentation.name = 'atelier-fitting-platform-v1'; scene.add(presentation); presentation.visible = false;
  const props = new THREE.Group(); workshop.add(props);
  const material = <T extends THREE.Material>(value: T): T => { ownedMaterials.add(value); return value; };
  const standard = (parameters: THREE.MeshStandardMaterialParameters) => material(new THREE.MeshStandardMaterial(parameters));
  const physical = (parameters: THREE.MeshPhysicalMaterialParameters) => material(new THREE.MeshPhysicalMaterial(parameters));
  const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = workshop) => {
    ownedGeometries.add(geometry);
    const object = new THREE.Mesh(geometry, mat); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, position: THREE.Vector3, parent: THREE.Object3D = workshop, radius = .01) => {
    const object = mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 3, h / 3, d / 3)), mat, parent); object.position.copy(position); return object;
  };
  const cylinder = (r1: number, r2: number, height: number, mat: THREE.Material, position: THREE.Vector3, parent: THREE.Object3D = workshop, segments = 32) => {
    const object = mesh(new THREE.CylinderGeometry(r1, r2, height, segments), mat, parent); object.position.copy(position); return object;
  };
  const tube = (points: THREE.Vector3[], radius: number, mat: THREE.Material, parent: THREE.Object3D = workshop, closed = false, segments = 32) =>
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), segments, radius, 5, closed), mat, parent);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, parent: THREE.Object3D = workshop) => {
    const object = cylinder(radius, radius, a.distanceTo(b), mat, a.clone().add(b).multiplyScalar(.5), parent, 10);
    object.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize()); return object;
  };
  const enamel = physical({ color: '#101917', metalness: .44, roughness: .19, clearcoat: 1, clearcoatRoughness: .12 });
  const brass = standard({ color: '#c6a361', metalness: .83, roughness: .28 });
  const agedBrass = standard({ color: '#886332', metalness: .78, roughness: .38 });
  const silver = standard({ color: '#c8cccb', metalness: .94, roughness: .23 });
  const rubber = standard({ color: '#282420', roughness: .88 });
  const paper = standard({ color: '#eee1c8', roughness: 1, side: THREE.DoubleSide });
  const darkWood = standard({ color: '#4e3324', roughness: .55 });
  const cream = standard({ color: '#e3d7c1', roughness: .88 });
  const woodMap = woodTexture(); ownedTextures.add(woodMap);
  const oak = physical({ map: woodMap, color: '#fff2df', roughness: .86, clearcoat: .12, clearcoatRoughness: .56, normalScale: new THREE.Vector2(.18,.18) });
  const burgundy = standard({ color: '#743e3a', roughness: .91 });
  const white = standard({ color: '#faf1df', roughness: .62 });
  const threadMaterial = standard({ color: '#d7b477', roughness: 1 });

  // Reflection environment is separate from actual room lights and shadow geometry.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentRoom = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(environmentRoom, .05);
  scene.environment = environmentTarget.texture; scene.environmentIntensity = .55;
  environmentRoom.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#f5eddd', '#75644f', 1.7));
  const sunlight = new THREE.DirectionalLight('#fff4db', 3.2); sunlight.position.set(-2.8, 4.5, 2.2);
  sunlight.castShadow = true; sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -3; sunlight.shadow.camera.right = 3; sunlight.shadow.camera.top = 3.5; sunlight.shadow.camera.bottom = -2;
  sunlight.shadow.camera.near = .2; sunlight.shadow.camera.far = 12; sunlight.shadow.bias = -.00015; sunlight.shadow.normalBias = .018;
  sunlight.shadow.radius = 3; sunlight.target.position.set(0, .8, -.2); scene.add(sunlight, sunlight.target);
  const softFill = new THREE.DirectionalLight('#dfebf4', .65); softFill.position.set(2, 2, 1); scene.add(softFill);
  const lampLight = new THREE.PointLight('#ffdb98', .85, 2.1, 2); lampLight.position.set(-.72, 1.48, -.36); workshop.add(lampLight);

  // A small room with architectural depth, oak joinery and afternoon window light.
  const floor = box(9, .07, 9, oak, v(0, -.08, 0), scene, .001);
  floor.name = 'oak-floor';
  const wall = standard({ color: '#d4c5ac', roughness: .98 });
  box(9, 3.6, .12, wall, v(0, 1.7, -2.5), scene);
  box(.12, 3.6, 7, wall, v(-3.5, 1.7, .8), scene);
  box(9, .24, .05, darkWood, v(0, .12, -2.40), scene);
  for (let x = -4; x < 4; x += .28) {
    const seam = box(.003, .001, 9, darkWood, v(x, -.042, 0), scene, .0003); seam.castShadow = false;
  }
  const window = new THREE.Group(); window.position.set(-1.55, 1.87, -2.38); scene.add(window);
  const skyMat = standard({ color: '#e3ecdf', emissive: '#c9d8c9', emissiveIntensity: .3, roughness: 1 });
  box(1.35, 1.9, .025, skyMat, v(0, 0, -.02), window);
  for (const x of [-.7, 0, .7]) box(.045, 1.98, .06, cream, v(x, 0, .02), window);
  for (const y of [-.98, 0, .98]) box(1.44, .045, .06, cream, v(0, y, .02), window);
  box(1.6, .06, .23, cream, v(0, -1.02, .08), window);

  // Work surface, rounded end grain, apron, drawer fronts and turned supports.
  box(2.45, .075, 1.17, oak, v(0, .79, -.02));
  box(2.32, .11, .035, darkWood, v(0, .697, .47));
  for (const x of [-.91, .91]) for (const z of [-.40, .39]) {
    const leg = cylinder(.035, .051, .68, darkWood, v(x, .355, z)); leg.rotation.z = x > 0 ? -.035 : .035;
    cylinder(.056, .056, .035, brass, v(x, .065, z));
  }
  box(1.92, .045, .035, darkWood, v(0, .2, -.38));
  for (const x of [-.74, .74]) {
    box(.4, .13, .43, oak, v(x, .66, .23));
    cylinder(.013, .013, .035, brass, v(x, .66, .465)).rotation.x = Math.PI / 2;
  }

  const machine = new THREE.Group(); machine.position.set(.20, .832, -.13); workshop.add(machine);
  machine.name = 'vintage-black-enamel-lockstitch-machine';
  box(1.03, .044, .48, enamel, v(0, .03, 0), machine, .025);
  box(1.08, .016, .53, darkWood, v(0, .003, 0), machine, .01);
  for (const x of [-.43, .43]) for (const z of [-.17, .17]) cylinder(.02, .02, .014, rubber, v(x, -.01, z), machine);
  // Continuous, bevelled cast-metal arm rather than stacked block approximations.
  const silhouette = new THREE.Shape();
  silhouette.moveTo(.26, .064); silhouette.lineTo(.42, .064);
  silhouette.bezierCurveTo(.45, .18, .45, .39, .40, .47);
  silhouette.bezierCurveTo(.37, .55, .24, .56, .13, .55);
  silhouette.lineTo(-.33, .53);
  silhouette.bezierCurveTo(-.43, .53, -.46, .49, -.445, .40);
  silhouette.lineTo(-.415, .267); silhouette.quadraticCurveTo(-.36, .243, -.298, .27);
  silhouette.lineTo(-.30, .402);
  silhouette.bezierCurveTo(-.22, .444, -.07, .43, .08, .433);
  silhouette.bezierCurveTo(.22, .437, .28, .384, .27, .27);
  silhouette.closePath();
  const armGeo = new THREE.ExtrudeGeometry(silhouette, { depth: .18, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: .014, bevelThickness: .014, curveSegments: 22 });
  const arm = mesh(armGeo, enamel, machine); arm.position.z = -.095;
  // Gold inlay is real thin metal geometry; front and reverse remain complete.
  const inlayGeometry: THREE.BufferGeometry[] = [];
  const inlay = (points: THREE.Vector3[], radius = .0016, closed = false) => {
    inlayGeometry.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'catmullrom', .15), points.length * 5, radius, 5, closed));
  };
  for (const z of [-.112, .112]) {
    inlay([v(-.405,.296,z),v(-.42,.39,z),v(-.40,.492,z),v(-.32,.510,z),v(.1,.529,z),v(.32,.512,z),v(.392,.45,z),v(.411,.30,z),v(.4,.09,z)]);
    inlay([v(-.31,.29,z),v(-.319,.408,z),v(-.22,.455,z),v(.08,.455,z),v(.25,.403,z),v(.292,.28,z),v(.288,.09,z)]);
    for (const x of [-.32, -.18, .33]) {
      const y = x < .18 ? .493 : .21;
      const vertical = x > .18;
      const place = (u:number,w:number) => vertical ? v(x+w,y+u,z) : v(x+u,y+w,z);
      const stem:THREE.Vector3[]=[];
      for(let i=0;i<=20;i++){const t=i/20;stem.push(place((t-.5)*.076,Math.sin(t*Math.PI*2)*.003));}
      inlay(stem,.001);
      for(const side of [-1,1])for(let leaf=0;leaf<3;leaf++){
        const cx=-.023+leaf*.022,cy=side*.009,tilt=side*.7;
        const leafPoints:THREE.Vector3[]=[];
        for(let i=0;i<=16;i++){const a=i/16*Math.PI*2;const u=Math.cos(a)*.010,w=Math.sin(a)*.0034;leafPoints.push(place(cx+u*Math.cos(tilt)-w*Math.sin(tilt),cy+u*Math.sin(tilt)+w*Math.cos(tilt)));}
        inlay(leafPoints,.0008,true);
      }
    }
    const cartouche: THREE.Vector3[] = [];
    for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;cartouche.push(v(.045+Math.cos(a)*.094,.49+Math.sin(a)*.027,z));}
    inlay(cartouche,.0012,true);
  }
  for (const z of [.22]) inlay([v(-.45,.055,z),v(-.48,.055,z*.85),v(-.48,.055,-z*.85),v(-.45,.055,-z),v(.45,.055,-z),v(.48,.055,-z*.85),v(.48,.055,z*.85),v(.45,.055,z),v(-.45,.055,z)],.0012);
  // Original symmetric arabesque work on the machine bed.
  for (const cx of [-.03,.32]) for (const sign of [-1,1]) {
    inlay([v(cx-.08,.055,.11),v(cx-.034,.055,.11+sign*.04),v(cx,.055,.11+sign*.06),v(cx+.034,.055,.11+sign*.04),v(cx+.08,.055,.11)],.0014);
    inlay([v(cx-.06,.055,.11),v(cx,.055,.11+sign*.027),v(cx+.06,.055,.11)],.0013);
  }
  const mergedInlay = mergeGeometries(inlayGeometry); inlayGeometry.forEach(geometry => geometry.dispose());
  if (mergedInlay) mesh(mergedInlay, brass, machine).name = 'merged-gold-inlaid-ornament';
  // Inspection plate, slot, screws, stitch-length dial and tension mechanism.
  box(.185, .006, .207, silver, v(-.34, .057, .042), machine, .012);
  box(.006, .003, .064, rubber, v(-.345,.061,.035), machine,.001);
  for (const x of [-.405,-.277]) for (const z of [-.032,.12]) {
    cylinder(.005,.005,.003,silver,v(x,.062,z),machine,12);
    box(.007,.001,.001,rubber,v(x,.064,z),machine,.0002);
  }
  for (let i=0;i<6;i++) box(.003,.002,.040,agedBrass,v(-.37+i*.01,.062,.047),machine,.0002);
  const faceplate = box(.106,.202,.012,silver,v(-.365,.377,.116),machine,.018);
  faceplate.rotation.z=.09;
  for(let i=0;i<5;i++) tube([v(-.398+i*.016,.285,.124),v(-.405+i*.016,.356,.127),v(-.39+i*.016,.465,.124)],.001,agedBrass,machine,false,12);
  for(const y of [.297,.464]) cylinder(.006,.006,.008,silver,v(-.363,y,.132),machine,16).rotation.x=Math.PI/2;
  cylinder(.029,.029,.018,agedBrass,v(-.245,.337,.133),machine).rotation.x=Math.PI/2;
  cylinder(.022,.022,.025,silver,v(-.245,.337,.145),machine).rotation.x=Math.PI/2;
  for(let i=0;i<18;i++) {
    const a=i/18*Math.PI*2;
    rod(v(-.245+Math.cos(a)*.021,.337+Math.sin(a)*.021,.159),v(-.245+Math.cos(a)*.024,.337+Math.sin(a)*.024,.159),.0012,agedBrass,machine);
  }
  cylinder(.012,.012,.015,brass,v(.33,.30,.12),machine).rotation.x=Math.PI/2;
  box(.018,.085,.013,agedBrass,v(.33,.24,.12),machine,.003);
  const brandMap=labelTexture('ATELIER', 'Nº 07  ·  LOCKSTITCH', '#15201b', '#d5ba7a'); ownedTextures.add(brandMap);
  const brand = mesh(new THREE.PlaneGeometry(.157,.039), standard({map:brandMap,roughness:.4,metalness:.25}),machine);brand.position.set(.045,.49,.112);

  // Working flywheel, crank, rubber belt and wooden hand knob share a real pivot.
  const flywheel = new THREE.Group(); flywheel.position.set(.47,.395,-.012); machine.add(flywheel);
  const ring = mesh(new THREE.TorusGeometry(.151,.012,12,64),enamel,flywheel);ring.rotation.y=Math.PI/2;
  const rim = mesh(new THREE.TorusGeometry(.158,.0035,8,64),silver,flywheel);rim.rotation.y=Math.PI/2;rim.position.x=.003;
  cylinder(.035,.035,.045,enamel,v(0,0,0),flywheel).rotation.z=Math.PI/2;
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2;
    rod(v(0,Math.sin(a)*.023,Math.cos(a)*.023),v(0,Math.sin(a)*.142,Math.cos(a)*.142),.008,enamel,flywheel);
  }
  rod(v(.01,.105,.04),v(.052,.105,.04),.008,agedBrass,flywheel);
  cylinder(.015,.022,.045,darkWood,v(.065,.105,.04),flywheel).rotation.z=Math.PI/2;
  tube([v(.459,.54,-.02),v(.49,.42,.12),v(.48,.11,.13),v(.45,.055,-.01),v(.455,.23,-.16),v(.459,.54,-.02)],.0045,rubber,machine,true,48);

  // Needle bar / needle and feed dogs animate with treadle activity.
  const needle = new THREE.Group(); needle.name = 'atelier-needle'; needle.position.set(-.347,.235,.045); machine.add(needle);
  cylinder(.0045,.0045,.23,silver,v(0,0,0),needle,16);
  box(.018,.026,.013,agedBrass,v(0,-.085,0),needle,.004);
  rod(v(0,-.1,0),v(0,-.16,0),.0012,silver,needle);
  const presser = new THREE.Group(); presser.position.set(-.323,.066,.044);machine.add(presser);
  rod(v(.022,.17,-.025),v(.022,.025,-.025),.003,silver,presser);
  rod(v(.022,.025,-.025),v(.004,.005,.004),.003,silver,presser);
  for(const x of [-.009,.008]) box(.011,.005,.053,silver,v(x,.003,.005),presser,.003);
  // Cotton spool with visible wound ridges and a continuous thread path.
  const spool = new THREE.Group();spool.position.set(.18,.575,-.025);machine.add(spool);
  cylinder(.005,.005,.12,silver,v(0,.02,0),spool,12);
  for(const y of [-.019,.059]) cylinder(.034,.034,.008,darkWood,v(0,y,0),spool);
  cylinder(.027,.027,.072,threadMaterial,v(0,.02,0),spool,32);
  const threadRings:THREE.BufferGeometry[]=[];
  for(let i=0;i<30;i++) {const geo=new THREE.TorusGeometry(.027,.0007,3,24);geo.rotateX(Math.PI/2);geo.translate(0,-.014+i*.0023,0);threadRings.push(geo);}
  const mergedThread=mergeGeometries(threadRings);threadRings.forEach(g=>g.dispose());if(mergedThread)mesh(mergedThread,threadMaterial,spool);
  const thread = tube([v(.18,.63,-.025),v(.06,.60,.05),v(-.24,.54,.122),v(-.245,.337,.168),v(-.31,.43,.14),v(-.347,.28,.055),v(-.347,.074,.045)],.00085,threadMaterial,machine,false,40);
  thread.name='continuous-upper-thread';

  let fabricMaterial = material(createFabricMaterial('denim','#455e71',{repeat:5}));
  const workpiece = mesh(clothGeometry(.57,.75,.052,.004),fabricMaterial,machine);workpiece.position.set(-.35,.070,.19);workpiece.name='fabric-feed-workpiece';
  const swatch = mesh(clothGeometry(.7,.98,.27,.018,.87),fabricMaterial,workshop);swatch.position.set(-.54,.848,.19);swatch.rotation.y=-.13;
  const feedStitches = new THREE.Group(); machine.add(feedStitches);
  const stitchGeo = new THREE.CapsuleGeometry(.0008,.005,2,4);
  const stitchCount=90;
  const stitches = new THREE.InstancedMesh(stitchGeo,threadMaterial,stitchCount);stitches.count=0;stitches.name='visible-completed-lockstitches';feedStitches.add(stitches);ownedGeometries.add(stitchGeo);
  const transform=new THREE.Object3D();
  for(let i=0;i<stitchCount;i++) {transform.position.set(-.347,.080,.06+i*.0048);transform.rotation.set(Math.PI/2,0,0);transform.updateMatrix();stitches.setMatrixAt(i,transform.matrix);}
  stitches.instanceMatrix.needsUpdate=true;

  // Tailor's shears, measuring tape, chalk, paper pattern, pin cushion and thread library.
  const shears=new THREE.Group();shears.position.set(.78,.843,.32);shears.rotation.y=-.5;props.add(shears);
  for(const side of [-1,1]) {
    const blade=new THREE.Shape();blade.moveTo(-.015,0);blade.lineTo(-.009,.26);blade.quadraticCurveTo(.02,.16,.025,0);blade.closePath();
    const bladeGeo=new THREE.ExtrudeGeometry(blade,{depth:.003,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:1,steps:1});bladeGeo.rotateX(-Math.PI/2);bladeGeo.rotateY(side*.13);
    mesh(bladeGeo,silver,shears);
    const handle=mesh(new THREE.TorusGeometry(.033,.007,8,36),agedBrass,shears);handle.rotation.x=-Math.PI/2;handle.position.set(side*.031,.004,-.05);handle.scale.set(1,1.3,1);
    rod(v(0,.003,0),v(side*.026,.003,-.025),.007,agedBrass,shears);
  }
  cylinder(.009,.009,.011,brass,v(0,.006,0),shears,20);
  const tapeGeo = new THREE.PlaneGeometry(.031,.64,1,72);tapeGeo.rotateX(-Math.PI/2);
  const tapePos=tapeGeo.attributes.position;
  for(let i=0;i<tapePos.count;i++) {const z=tapePos.getZ(i);tapePos.setX(i,tapePos.getX(i)+Math.sin(z*10)*.07);tapePos.setY(i,.002+Math.cos(z*13)*.0015);}
  tapeGeo.computeVertexNormals();
  const tapeMap=(()=>{const c=document.createElement('canvas');c.width=128;c.height=1024;const ctx=c.getContext('2d')!;ctx.fillStyle='#e7c97e';ctx.fillRect(0,0,128,1024);ctx.strokeStyle='#342d20';ctx.fillStyle='#342d20';ctx.font='18px Georgia';for(let i=0;i<80;i++){const y=i*12.8;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(i%5===0?52:25,y);ctx.stroke();if(i%5===0)ctx.fillText(String(i),62,y+8);}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();ownedTextures.add(tapeMap);
  const tape=mesh(tapeGeo,standard({map:tapeMap,roughness:.9,side:THREE.DoubleSide}),props);tape.position.set(.45,.844,.31);tape.rotation.y=.35;
  const chalk=mesh(new THREE.CylinderGeometry(.027,.027,.008,3),white,props);chalk.position.set(.62,.846,.40);chalk.rotation.y=.3;
  const cushion=mesh(new THREE.SphereGeometry(.058,24,12),burgundy,props);cushion.scale.set(1,.45,1);cushion.position.set(.90,.858,-.28);
  cylinder(.062,.064,.012,darkWood,v(.90,.839,-.28),props);
  for(let i=0;i<11;i++) {
    const angle=i*2.399;const radius=.013+Math.sqrt(i/11)*.033;
    const point=v(.90+Math.cos(angle)*radius,.87,-.28+Math.sin(angle)*radius);const end=point.clone().add(v(Math.cos(angle)*.012,.035,Math.sin(angle)*.012));rod(point,end,.0007,silver,props);
    const pin=mesh(new THREE.SphereGeometry(.003,7,5),i%2?cream:brass,props);pin.position.copy(end);
  }
  const pattern=mesh(new THREE.PlaneGeometry(.34,.45),paper,props);pattern.rotation.x=-Math.PI/2;pattern.rotation.z=.15;pattern.position.set(-.88,.836,-.25);
  const patternLines = new THREE.Group();patternLines.position.copy(pattern.position);patternLines.position.y+=.001;patternLines.rotation.y=-.15;props.add(patternLines);
  const lineMat=standard({color:'#a59579',roughness:1});
  tube([v(-.12,0,.17),v(-.13,0,-.12),v(-.08,0,-.19),v(-.03,0,-.17),v(0,0,-.15),v(.04,0,-.17),v(.12,0,-.10),v(.11,0,.17),v(-.12,0,.17)],.0007,lineMat,patternLines,false,35);
  rod(v(0,.001,-.12),v(0,.001,.13),.0005,lineMat,patternLines);
  // Stack of neatly pressed fabrics on an independent wall shelf.
  box(1.9,.045,.30,darkWood,v(.42,1.25,-1.2),props);
  for(const x of [-.31,1.15]){rod(v(x,1.23,-1.2),v(x,1.05,-1.34),.009,agedBrass,props);rod(v(x,1.05,-1.34),v(x,1.35,-1.34),.009,agedBrass,props);}
  const textileColors=['#556571','#a58a75','#d5c5a4','#8d9490','#8b6061','#9d9980'];
  for(let i=0;i<6;i++) {
    const cloth=material(createFabricMaterial(i%2?'linen':'jersey',textileColors[i],{repeat:3}));
    box(.25,.035,.22,cloth,v(-.32+i*.29,1.29,-1.18),props,.012);
    box(.25,.035,.21,cloth,v(-.32+i*.29,1.328,-1.18),props,.012);
  }
  box(1.88,.055,.04,darkWood,v(.42,1.59,-1.33),props);
  const rollGroup=new THREE.Group();rollGroup.position.set(.4,1.84,-1.29);props.add(rollGroup);
  for(let i=0;i<7;i++) {
    const mat=material(createFabricMaterial(i%3===0?'denim':i%3===1?'linen':'satin',textileColors[i%6],{repeat:2}));
    const roll=cylinder(.083,.083,.30,mat,v(-.85+i*.28,0,.04),rollGroup);roll.rotation.x=Math.PI/2;
    const core=cylinder(.017,.017,.306,paper,v(-.85+i*.28,0,.04),rollGroup);core.rotation.x=Math.PI/2;
    const swatchEdge=mesh(clothGeometry(.16,.21,.045,.002),mat,rollGroup);swatchEdge.rotation.x=.65;swatchEdge.position.set(-.85+i*.28,-.07,.15);
  }
  // Four small spool groups on a tray, grouped and using shared metal/wood materials.
  const tray=box(.29,.018,.18,darkWood,v(.80,.843,-.43),props,.01);
  for(let i=0;i<4;i++){
    const x=.70+i*.064;for(const yy of [.864,.93])cylinder(.027,.027,.006,oak,v(x,yy,-.43),props,20);
    cylinder(.021,.021,.06,standard({color:textileColors[i],roughness:.9}),v(x,.896,-.43),props,24);
  }
  tray.name='thread-spool-tray';
  // Articulated brass task lamp; real light is a single inexpensive point light.
  cylinder(.091,.11,.022,agedBrass,v(-.87,.844,-.36),props);
  rod(v(-.87,.855,-.36),v(-.90,1.20,-.36),.012,agedBrass,props);
  rod(v(-.90,1.20,-.36),v(-.71,1.47,-.36),.009,agedBrass,props);
  for(const p of [v(-.90,1.20,-.36),v(-.71,1.47,-.36)])cylinder(.021,.021,.029,brass,p,props,24).rotation.x=Math.PI/2;
  const shade=cylinder(.044,.11,.10,enamel,v(-.70,1.46,-.36),props,48);shade.rotation.z=.24;
  const bulb=mesh(new THREE.SphereGeometry(.025,16,12),standard({color:'#ffe9bb',emissive:'#ffc66e',emissiveIntensity:2}),props);bulb.position.set(-.69,1.42,-.36);
  // Original typography on a hanging atelier sign.
  const signMap=labelTexture('SEWING ATELIER','CUT WITH CARE  ·  MAKE IT YOURS','#d8c6a7','#4c4030');ownedTextures.add(signMap);
  const sign=mesh(new THREE.PlaneGeometry(1.2,.30),standard({map:signMap,roughness:1}),props);sign.position.set(.36,2.20,-1.34);
  box(1.24,.34,.025,darkWood,v(.36,2.20,-1.36),props);

  // Fitting stage shares room lighting but clears the table for the real player rig.
  const dais=cylinder(.68,.70,.07,darkWood,v(0,-.035,0),presentation,80);
  cylinder(.69,.69,.009,brass,v(0,.004,0),presentation,80);
  cylinder(.676,.676,.013,cream,v(0,.014,0),presentation,80);
  dais.name='player-fitting-dais';
  const screen=box(2.1,2.6,.035,standard({color:'#d0c0a7',roughness:1}),v(0,1.29,-.65),presentation,.04);
  const curtains=material(createFabricMaterial('linen','#d9c9b1',{repeat:4}));
  for(const side of [-1,1]){
    const curtainGeo=new THREE.PlaneGeometry(.72,2.55,40,5);const pos=curtainGeo.attributes.position;
    for(let i=0;i<pos.count;i++)pos.setZ(i,Math.sin(pos.getX(i)*43)*.045);curtainGeo.computeVertexNormals();
    const curtain=mesh(curtainGeo,curtains,presentation);curtain.position.set(side*.95,1.29,-.6);
    rod(v(side*.55,2.59,-.57),v(side*1.31,2.59,-.57),.018,agedBrass,presentation);
  }
  screen.name='linen-fitting-backdrop';

  // Collapse fixed set dressing by material, while preserving each working pivot.
  // Geometry remains editable above; moving needle/cloth/wheel never enter a static batch.
  function batchStatic(container: THREE.Object3D, exclude: Set<THREE.Object3D> = new Set()) {
    scene.updateMatrixWorld(true);
    const inverse = container.matrixWorld.clone().invert();
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    const visit = (object: THREE.Object3D) => {
      if (exclude.has(object)) return;
      if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh) && !Array.isArray(object.material)) {
        const list = groups.get(object.material) ?? []; list.push(object); groups.set(object.material, list);
      }
      [...object.children].forEach(visit);
    };
    [...container.children].forEach(visit);
    for (const [mat, objects] of groups) {
      if (objects.length < 2) continue;
      const geometries = objects.map(object => {
        const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
        return geometry;
      });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      for (const object of objects) {
        object.removeFromParent();
        object.geometry.dispose(); ownedGeometries.delete(object.geometry);
      }
      mesh(merged, mat, container).name = `static-batch-${mat.name || mat.type}-${mat.uuid}`;
    }
  }
  batchStatic(flywheel); batchStatic(spool); batchStatic(needle);
  batchStatic(workshop, new Set([flywheel, spool, needle, workpiece, swatch, feedStitches, thread]));
  batchStatic(presentation);
  batchStatic(scene, new Set([workshop, presentation]));

  let stage:Stage='design', disposed=false, lastNow=0, wheelAngle=0;
  const cameraPosition=v(1.35,1.66,1.96), cameraTarget=v(.04,1.02,-.12);
  const desiredPosition=cameraPosition.clone(), desiredTarget=cameraTarget.clone();
  camera.position.copy(cameraPosition);camera.lookAt(cameraTarget);
  const oakReady=Promise.all(['color','normal','roughness'].map(async channel=>{
    const texture=await new THREE.TextureLoader().loadAsync(textileUrl('oak',channel));
    if(disposed){texture.dispose();return;}
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.colorSpace=channel==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.center.set(.5,.5);texture.rotation=Math.PI/2;texture.repeat.set(.7,1.4);ownedTextures.add(texture);
    if(channel==='color')oak.map=texture;else if(channel==='normal')oak.normalMap=texture;else oak.roughnessMap=texture;
    oak.needsUpdate=true;
  }));
  const ready=Promise.all([loadFabricMaterials(renderer),oakReady]).then(()=>{
    if(disposed)return;
    // Compile after image arrival so the first pedal stroke doesn't create shaders.
    renderer.compile(scene,camera);
  });
  let width=1,height=1;
  function setStage(next:Stage){
    stage=next;const fitting=next==='finish'||next==='wardrobe';workshop.visible=!fitting;presentation.visible=fitting;
    swatch.visible=next==='design'||next==='cut';workpiece.visible=next==='sew'||next==='design';
    feedStitches.visible=next==='sew';
    if(fitting){desiredPosition.set(.1,1.23,4.15);desiredTarget.set(0,.94,0);camera.fov=32;}
    else if(next==='sew'){desiredPosition.set(-.63,1.56,1.28);desiredTarget.set(-.48,1.075,-.12);camera.fov=40;}
    else if(next==='cut'){desiredPosition.set(1.42,2.0,1.8);desiredTarget.set(.10,.99,-.20);camera.fov=43;}
    else{desiredPosition.set(1.35,1.66,1.96);desiredTarget.set(.04,1.02,-.12);camera.fov=42;}
    camera.updateProjectionMatrix();
  }
  function setFabric(fabric:string|{id:string},color:string,threadColor:string){
    const id=typeof fabric==='string'?fabric:fabric.id;
    const next=material(createFabricMaterial(id,color,{repeat:id==='denim'?5:3}));
    swatch.material=next;workpiece.material=next;
    ownedMaterials.delete(fabricMaterial);fabricMaterial.dispose();fabricMaterial=next;
    threadMaterial.color.set(threadColor);
  }
  function update(now:number,activity:Activity={pedal:0,progress:0,offset:0}){
    if(disposed)return;
    // now may be RAF milliseconds or elapsed seconds; use bounded delta either way.
    const raw=lastNow?now-lastNow:0;const dt=Math.min(.05,raw>1?raw/1000:raw);lastNow=now;
    const ease=1-Math.exp(-dt*7);
    cameraPosition.lerp(desiredPosition,ease);cameraTarget.lerp(desiredTarget,ease);
    camera.position.copy(cameraPosition);camera.lookAt(cameraTarget);
    const pedal=THREE.MathUtils.clamp(activity.pedal,0,1);
    wheelAngle+=dt*pedal*21;
    flywheel.rotation.x=wheelAngle;spool.rotation.y=wheelAngle*.24;
    needle.position.y=.235-Math.sin(wheelAngle*2)*.014*pedal;
    if(stage==='sew'){
      const progress=THREE.MathUtils.clamp(activity.progress,0,1);
      workpiece.position.z=.19-progress*.24;
      workpiece.position.x=-.35+THREE.MathUtils.clamp(activity.offset,-1,1)*.045;
      stitches.count=Math.floor(progress*stitchCount);
      feedStitches.position.z=-progress*.24;
    }
    thread.scale.y=1+Math.sin(wheelAngle*2)*.009*pedal;
  }
  function resize(w:number,h:number){width=w;height=h;camera.aspect=Math.max(1,w)/Math.max(1,h);camera.updateProjectionMatrix();}
  function stats(){
    let triangles=0,drawables=0;const materialIds=new Set<number>(), textureIds=new Set<number>();
    scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const count=object.geometry.index?.count??object.geometry.attributes.position?.count??0;
      triangles+=count/3*(object instanceof THREE.InstancedMesh?object.count:1);drawables++;
      const materialList=Array.isArray(object.material)?object.material:[object.material];
      for(const mat of materialList){materialIds.add(mat.id);for(const value of Object.values(mat))if(value instanceof THREE.Texture)textureIds.add(value.id);}
    });
    return {stage,triangles:Math.round(triangles),meshObjects:drawables,uniqueMaterials:materialIds.size,textureBindings:textureIds.size,webpMaps:15,texturePixels:15*1024*1024,estimatedFabricGpuMiB:64,estimatedAllPbrGpuMiB:80,lights:4,shadowMaps:1,shadowResolution:2048,viewport:[width,height],renderer:renderer.info.render};
  }
  function dispose(){
    disposed=true;for(const geometry of ownedGeometries)geometry.dispose();for(const mat of ownedMaterials)mat.dispose();for(const texture of ownedTextures)texture.dispose();
    disposeFabricMaterials();environmentTarget.dispose();sunlight.shadow.map?.dispose();scene.clear();
  }
  return {scene,camera,ready,setStage,setFabric,update,resize,dispose,stats};
}
