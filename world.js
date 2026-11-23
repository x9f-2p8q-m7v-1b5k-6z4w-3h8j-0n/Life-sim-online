'use strict';
// world.js - Scene, lighting, sky, materials, city grid and chunk builder

const loading = document.getElementById('loading');
const toastEl = document.getElementById('toast');
const speedEl = document.getElementById('speed');
const gearInfoEl = document.getElementById('gearInfo');
const modeEl = document.getElementById('mode');
const chunkInfoEl = document.getElementById('chunkInfo');
const districtTagEl = document.getElementById('districtTag');
const radarCanvas = document.getElementById('radar');
const radarCtx = radarCanvas.getContext('2d');
const crosshair = document.getElementById('crosshair');
const startScreen = document.getElementById('start');

let toastTimer;
function toast(message) {
  toastEl.textContent = message; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 2100);
}

// ============================================================================
// SCENE, LIGHTING & SKY SETUP
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bbcd9);
scene.fog = new THREE.FogExp2(0x8bbcd9, 0.0021);

const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 750);
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.24;
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xf2f7ff, 0x475440, 1.85); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff5e4, 3.2);
sun.position.set(-130, 195, 105);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 480;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0003;
scene.add(sun);
scene.add(sun.target);

const skyMat = new THREE.ShaderMaterial({
  side:THREE.BackSide, depthWrite:false,
  uniforms:{ top:{value:new THREE.Color(0x2d6ba4)}, horizon:{value:new THREE.Color(0xb6dbed)} },
  vertexShader:'varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=normalize(w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader:'varying vec3 vWorld; uniform vec3 top; uniform vec3 horizon; void main(){ float h=clamp(vWorld.y*.5+.5,0.0,1.0); gl_FragColor=vec4(mix(horizon,top,pow(h,0.68)),1.0); }'
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(680, 32, 18), skyMat);
scene.add(sky);

const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({color:0xfffae4}));
scene.add(sunDisc);

const starGeo = new THREE.BufferGeometry();
const starCount = 1300;
const starPositions = new Float32Array(starCount * 3);
for(let i=0; i<starCount*3; i+=3) {
  const u = Math.random(), v = Math.random();
  const theta = u * 2.0 * Math.PI, phi = Math.acos(2.0 * v - 1.0);
  const r = 620;
  starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i+1] = Math.abs(r * Math.cos(phi)) + 55;
  starPositions[i+2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({color:0xffffff, size:2.3, transparent:true, opacity:0});
const starField = new THREE.Points(starGeo, starMat);
scene.add(starField);

// ============================================================================
// SHARED PROCEDURAL TEXTURES & MATERIALS LIBRARY (Zero memory leak on chunk swap)
// ============================================================================
function noiseTexture(base, fleck, size=256, density=11000) {
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d'); ctx.fillStyle=base; ctx.fillRect(0,0,size,size);
  for(let i=0;i<density;i++) {
    const x=Math.random()*size,y=Math.random()*size,r=Math.random()*1.6+.2;
    ctx.globalAlpha=Math.random()*.22+.03; ctx.fillStyle=fleck;
    ctx.fillRect(x,y,r,r);
  }
  ctx.globalAlpha=1;
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t;
}

function makeSignTexture(text, bgHex, fgHex) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = fgHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.fillStyle = fgHex;
  ctx.font = 'bold 42px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHelipadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#383e45';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 124px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 128, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const grassMap = noiseTexture('#557343', '#c2da86'); grassMap.repeat.set(16, 16);
const concreteMap = noiseTexture('#a6a49c', '#ebe7dd'); concreteMap.repeat.set(12, 12);

function canvasTex(c, aniso=8) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; }
// Worn asphalt: speckle, patched repairs, hairline cracks and oil stains (tiles every 14 m)
function makeAsphaltTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), R = Math.random;
  g.fillStyle = '#2b2f35'; g.fillRect(0, 0, S, S);
  for(let i = 0; i < 10000; i++) { g.globalAlpha = R()*.22 + .04; g.fillStyle = R() < .5 ? '#8d969d' : '#14171b'; const r = R()*1.8 + .3; g.fillRect(R()*S, R()*S, r, r); }
  for(let i = 0; i < 8; i++) { g.globalAlpha = .08 + R()*.1; g.fillStyle = R() < .5 ? '#3d434a' : '#1b1e22'; g.fillRect(30 + R()*(S - 160), 30 + R()*(S - 160), 40 + R()*110, 30 + R()*90); }
  for(let i = 0; i < 5; i++) { const gr = g.createRadialGradient(0, 0, 2, 0, 0, 30 + R()*30); gr.addColorStop(0, 'rgba(8,9,11,.5)'); gr.addColorStop(1, 'rgba(8,9,11,0)'); g.save(); g.translate(40 + R()*(S - 80), 40 + R()*(S - 80)); g.scale(1 + R(), .6 + R()*.5); g.fillStyle = gr; g.globalAlpha = 1; g.fillRect(-70, -70, 140, 140); g.restore(); }
  g.globalAlpha = .55; g.strokeStyle = '#0e1013'; g.lineWidth = 1.2;
  for(let i = 0; i < 9; i++) { let x = 40 + R()*(S - 80), y = 40 + R()*(S - 80), a = R()*6.28; g.beginPath(); g.moveTo(x, y); for(let k = 0; k < 7; k++) { a += (R() - .5)*1.2; x += Math.cos(a)*(8 + R()*14); y += Math.sin(a)*(8 + R()*14); g.lineTo(Math.min(S - 10, Math.max(10, x)), Math.min(S - 10, Math.max(10, y))); } g.stroke(); }
  g.globalAlpha = 1; return canvasTex(c);
}
// Sidewalk: 2x2 concrete slabs per 3.2 m tile, with joints and weathering
function makeSidewalkTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), R = Math.random;
  for(let i = 0; i < 2; i++) for(let j = 0; j < 2; j++) { const v = 150 + R()*24; g.fillStyle = `rgb(${v},${v - 2},${v - 8})`; g.fillRect(i*128, j*128, 128, 128); }
  for(let i = 0; i < 4500; i++) { g.globalAlpha = R()*.2 + .03; g.fillStyle = R() < .5 ? '#f1ede2' : '#5e5c56'; const r = R()*1.6 + .3; g.fillRect(R()*S, R()*S, r, r); }
  g.globalAlpha = .7; g.fillStyle = '#6e6c66'; g.fillRect(0, 0, S, 3); g.fillRect(0, 126, S, 4); g.fillRect(0, 0, 3, S); g.fillRect(126, 0, 4, S);
  g.globalAlpha = 1; return canvasTex(c);
}
// Building facades, drawn procedurally: window bays, spandrels, balconies, AC units, awnings, plus a matching emissive map for lit windows.
// One tile = 8.8 m wide (4 bays) x 8.4 m tall (3 floors). The top-left corner is plain wall (roof faces sample it).
function makeFacade(kind) {
  const W = 512, H = 510, BW = 128, FH = 170, c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = W; c.height = e.height = H; const g = c.getContext('2d'), m = e.getContext('2d'), R = Math.random;
  g.fillStyle = '#e4e1da'; g.fillRect(0, 0, W, H); m.fillStyle = '#000'; m.fillRect(0, 0, W, H);
  for(let i = 0; i < 6000; i++) { g.globalAlpha = R()*.1; g.fillStyle = R() < .5 ? '#fff' : '#555'; g.fillRect(R()*W, R()*H, 2, 2); }
  g.globalAlpha = 1;
  const glass = ['#37566b', '#2c4558', '#4a6a7c', '#223647', '#58798a'], lit = ['#ffd48a', '#ffe7b0', '#ffc66b', '#bfe0ff'];
  for(let f = 0; f < 3; f++) {
    const y0 = f*FH; g.fillStyle = '#cdc9bf'; g.fillRect(0, y0 + FH - 42, W, 42); g.fillStyle = '#aaa69c'; g.fillRect(0, y0 + FH - 4, W, 4);
    for(let b = 0; b < 4; b++) {
      const x0 = b*BW; let wx, wy, ww, wh;
      if(kind === 0) { wx = x0 + 6; ww = BW - 12; wy = y0 + 26; wh = FH - 72; } else { ww = 56 + (R() < .3 ? 14 : 0); wx = x0 + (BW - ww)/2; wy = y0 + 28; wh = 92; }
      g.fillStyle = '#17191d'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      g.fillStyle = glass[Math.floor(R()*glass.length)]; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(wx, wy, ww*.35, wh);
      g.fillStyle = '#17191d'; if(kind === 0) { for(let k = 1; k < 3; k++) g.fillRect(wx + k*ww/3 - 1.5, wy, 3, wh); } else g.fillRect(wx + ww/2 - 1.5, wy, 3, wh);
      if(kind !== 0 && R() < .3) { g.fillStyle = 'rgba(240,235,220,.75)'; g.fillRect(wx, wy, ww, wh*(.3 + R()*.4)); }
      if(!(f === 0 && b === 0) && R() < .36) { m.fillStyle = lit[Math.floor(R()*lit.length)]; m.globalAlpha = .75 + R()*.25; m.fillRect(wx, wy, ww, wh); m.globalAlpha = 1; }
      if(kind === 1 && R() < .38) { g.fillStyle = '#bdb9af'; g.fillRect(wx - 12, wy + wh + 4, ww + 24, 9); g.fillStyle = '#3a3d42'; for(let k = 0; k < 7; k++) g.fillRect(wx - 10 + k*(ww + 20)/6, wy + wh - 22, 2.5, 26); g.fillRect(wx - 12, wy + wh - 22, ww + 24, 2.5); }
      if(kind !== 0 && R() < .14) { g.fillStyle = '#8c8f93'; g.fillRect(x0 + 8, wy + wh + 12, 24, 16); g.fillStyle = '#5b5e62'; g.fillRect(x0 + 10, wy + wh + 16, 20, 3); }
      if(kind === 2 && f === 0 && R() < .5) { g.fillStyle = ['#a33', '#357', '#385', '#a82'][Math.floor(R()*4)]; g.fillRect(wx - 6, wy - 12, ww + 12, 10); }
    }
  }
  g.fillStyle = '#9d998f'; for(let b = 1; b < 4; b++) g.fillRect(b*BW - 2, 0, 4, H);
  g.fillStyle = '#e4e1da'; g.fillRect(0, 0, 18, 18);
  return {map:canvasTex(c), emi:canvasTex(e)};
}
const asphaltMap = makeAsphaltTexture(), sidewalkMap = makeSidewalkTexture(), FACADES = [makeFacade(0), makeFacade(1), makeFacade(2)];

const sharedMat = {
  grass: new THREE.MeshStandardMaterial({color:0xffffff, map:grassMap, roughness:0.95}),
  parkGrass: new THREE.MeshStandardMaterial({color:0x688c55, map:grassMap, roughness:0.92}),
  road: new THREE.MeshStandardMaterial({color:0xffffff, map:asphaltMap, roughness:0.86}),
  sidewalkTiled: new THREE.MeshStandardMaterial({color:0xffffff, map:sidewalkMap, roughness:0.84}),
  sidewalk: new THREE.MeshStandardMaterial({color:0xffffff, map:concreteMap, roughness:0.84}),
  curb: new THREE.MeshStandardMaterial({color:0x8e918c, roughness:0.88}),
  whiteLine: new THREE.MeshStandardMaterial({color:0xf3efe0, roughness:0.45}),
  yellowLine: new THREE.MeshStandardMaterial({color:0xf4b942, roughness:0.45}),
  jerseyBarrier: new THREE.MeshStandardMaterial({color:0xb8b8b2, roughness:0.82}),
  glassDay: new THREE.MeshStandardMaterial({color:0x6da6bd, roughness:0.14, metalness:0.38}),
  winLit: new THREE.MeshStandardMaterial({color:0x203544, roughness:0.2, metalness:0.25, emissive:0x000000, emissiveIntensity:0}),
  winDim: new THREE.MeshStandardMaterial({color:0x1a2c38, roughness:0.22, metalness:0.3, emissive:0x000000, emissiveIntensity:0}),
  roof: new THREE.MeshStandardMaterial({color:0x3b4148, roughness:0.78}),
  helipad: new THREE.MeshStandardMaterial({map:makeHelipadTexture(), roughness:0.75}),
  steelDark: new THREE.MeshStandardMaterial({color:0x31383e, roughness:0.55, metalness:0.45}),
  steelLight: new THREE.MeshStandardMaterial({color:0x8a959c, roughness:0.35, metalness:0.65}),
  trunk: new THREE.MeshStandardMaterial({color:0x523c2d, roughness:0.92}),
  leaf1: new THREE.MeshStandardMaterial({color:0x305934, roughness:0.85}),
  leaf2: new THREE.MeshStandardMaterial({color:0x3e6c40, roughness:0.85}),
  leaf3: new THREE.MeshStandardMaterial({color:0x4e7b48, roughness:0.85}),
  lampPole: new THREE.MeshStandardMaterial({color:0x2c3238, roughness:0.5, metalness:0.5}),
  lampBulb: new THREE.MeshBasicMaterial({color:0xffefbd}),
  gantryGreen: new THREE.MeshStandardMaterial({color:0x1b633c, roughness:0.5}),
  buildingPalette: [
    new THREE.MeshStandardMaterial({color:0xb9b7b0, roughness:0.74}),
    new THREE.MeshStandardMaterial({color:0x9ea5aa, roughness:0.72}),
    new THREE.MeshStandardMaterial({color:0x849399, roughness:0.70}),
    new THREE.MeshStandardMaterial({color:0xc5b8a4, roughness:0.76}),
    new THREE.MeshStandardMaterial({color:0x76858a, roughness:0.68}),
    new THREE.MeshStandardMaterial({color:0xd0cfc6, roughness:0.75})
  ],
  housePalette: [
    new THREE.MeshStandardMaterial({color:0xd4c5ad, roughness:0.84}),
    new THREE.MeshStandardMaterial({color:0xb8c5c5, roughness:0.84}),
    new THREE.MeshStandardMaterial({color:0xcbb7a8, roughness:0.84}),
    new THREE.MeshStandardMaterial({color:0xdad4c1, roughness:0.84}),
    new THREE.MeshStandardMaterial({color:0xc2ccb8, roughness:0.84})
  ],
  roofPalette: [
    new THREE.MeshStandardMaterial({color:0x4f4e54, roughness:0.86}),
    new THREE.MeshStandardMaterial({color:0x69473d, roughness:0.86}),
    new THREE.MeshStandardMaterial({color:0x3b4852, roughness:0.86})
  ],
  shopSigns: [
    { name: 'SUPERMARKET', mat: new THREE.MeshBasicMaterial({map:makeSignTexture('SUPERMARKET', '#113a2b', '#7ef29d')}), awning: 0x1d6b4e },
    { name: 'CYBER CAFE',  mat: new THREE.MeshBasicMaterial({map:makeSignTexture('CYBER CAFE', '#151c38', '#79d6ff')}),  awning: 0x24346b },
    { name: 'AUTO PARTS',  mat: new THREE.MeshBasicMaterial({map:makeSignTexture('AUTO PARTS', '#3b1815', '#ffd166')}),  awning: 0x7d2b22 },
    { name: 'BAKERY',      mat: new THREE.MeshBasicMaterial({map:makeSignTexture('ARTISAN BAKERY', '#3d2817', '#ffdfb3')}), awning: 0x87542a },
    { name: 'CITY DINER',  mat: new THREE.MeshBasicMaterial({map:makeSignTexture('METRO DINER', '#381228', '#ff75b5')}), awning: 0x7a2255 },
    { name: 'TECH HUB',    mat: new THREE.MeshBasicMaterial({map:makeSignTexture('TECH HUB', '#122b38', '#80ffea')}),    awning: 0x1f5570 }
  ]
};

// ============================================================================
// MASTER-PLANNED CITY GRID & DETERMINISTIC CHUNK ZONING CONSTANTS
// ============================================================================
// Every chunk is 120m x 120m, centered at (cx * 120, cz * 120).
// Chunk boundaries are at X = (cx ± 0.5) * 120 and Z = (cz ± 0.5) * 120.
// - Every 4th boundary (boundaryIndex % 4 === 0) is a 28m-wide 4-Lane Divided HIGHWAY.
// - Every other boundary is a 16m-wide 4-Lane URBAN AVENUE.
// - The center axes of every chunk (X = cx * 120, Z = cz * 120) are 9m-wide 2-Lane LOCAL STREETS.
// This divides every 120m chunk into 4 exact interior quadrants, bordered by sidewalks!
// Zero trees, buildings, houses, or lamps are EVER placed outside the interior buildable lots.

const CHUNK_SIZE = 120;
const HALF_CHUNK = CHUNK_SIZE / 2; // 60m
let RENDER_RADIUS = 2; // 5x5 = 25 active chunks around the player (600m x 600m live view)

const HIGHWAY_HALF_W = 14.0; // Total 28m roadbed
const AVENUE_HALF_W  = 8.0;  // Total 16m roadbed
const LOCAL_HALF_W   = 4.5;  // Total 9m roadbed
const SIDEWALK_W     = 3.2;  // 3.2m sidewalk outside every road curb
const LOT_SAFETY_PAD = 2.6;  // Extra setback inside sidewalk so nothing ever overhangs

// Deterministic PRNG per chunk so revisiting any chunk generates the exact same city block!
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashChunk(cx, cz, salt=0) {
  let h = (cx * 374761393 + cz * 668265263 + salt * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Returns boundary road type for grid boundary index `bIdx` (located at world coord bIdx * 120 - 60)
function getBoundaryRoadType(bIdx) {
  return (Math.abs(bIdx) % 4 === 0) ? 'HIGHWAY' : 'AVENUE';
}

function getBoundaryHalfWidth(bIdx) {
  return getBoundaryRoadType(bIdx) === 'HIGHWAY' ? HIGHWAY_HALF_W : AVENUE_HALF_W;
}

// Determines district zoning for chunk (cx, cz)
function getChunkDistrict(cx, cz) {
  if(cx === 0 && cz === 0) return 'COMMERCIAL'; // Spawn chunk: vibrant shops, plaza, and park
  const distFromCenter = Math.hypot(cx, cz);
  const r = mulberry32(hashChunk(cx, cz, 99))();
  if(distFromCenter <= 2.2) {
    return r < 0.65 ? 'DOWNTOWN' : 'COMMERCIAL';
  }
  if((Math.abs(cx * 3 + cz * 5) % 7 === 0) && r < 0.75) {
    return 'PARK';
  }
  if(r < 0.24) return 'DOWNTOWN';
  if(r < 0.48) return 'COMMERCIAL';
  return 'SUBURBAN';
}

// ---- Tiled materials: UVs are scaled in metres so textures never stretch on long road strips or tall facades ----
sharedMat.road.userData = {tx:14, ty:14};
sharedMat.sidewalkTiled.userData = {tx:3.2, ty:3.2};
sharedMat.facade = sharedMat.buildingPalette.map((m, i) => { const f = FACADES[i % 3], fm = new THREE.MeshStandardMaterial({color:m.color.getHex(), map:f.map, emissiveMap:f.emi, emissive:0xffffff, emissiveIntensity:0, roughness:.62, metalness:.1}); fm.userData = {tx:8.8, ty:8.4, plain:[.015, .985], facade:true}; return fm; });
const plasterMap = noiseTexture('#e8e4da', '#ffffff', 256, 8000);
sharedMat.housePalette.forEach(m => { m.userData = {tx:4, ty:4}; m.map = plasterMap; m.needsUpdate = true; });
function uvTile(g, w, h, d, ud, ox, oz) {
  const uv = g.attributes.uv;
  for(let f = 0; f < 6; f++) {
    const fw = f < 2 ? d : w, fh = f < 2 ? h : f < 4 ? d : h;
    for(let i = 0; i < 4; i++) {
      const k = f*4 + i;
      if(ud.plain && (f === 2 || f === 3)) uv.setXY(k, ud.plain[0], ud.plain[1]);
      else uv.setXY(k, uv.getX(k)*fw/ud.tx + ox, uv.getY(k)*fh/ud.ty + oz);
    }
  }
}
// ---- Road grid helpers: every road lies on a multiple of 60 m (even multiples are local streets, odd ones avenues/highways) ----
function roadHalfW(L) { const i = Math.round(L / 60); return (i % 2 === 0) ? LOCAL_HALF_W : getBoundaryHalfWidth((i + 1) / 2); }
// Traffic signal phase for the crossing of the road along Z at x=60a and the road along X at z=60b.
// Returns the state ('G','Y','R') for traffic moving along Z and along X, plus green seconds left for each.
function sigState(a, b, T, o) {
  o = o || {};
  const wX = roadHalfW(60*b)*2, wZ = roadHalfW(60*a)*2, gz = 9 + wX*.5, gx = 9 + wZ*.5, cyc = gz + gx + 9;
  let t = (T + (((a*7 + b*13) % 16 + 16) % 16)*2.3) % cyc; if(t < 0) t += cyc;
  o.z = o.x = 'R'; o.zRem = o.xRem = 0;
  if(t < gz) { o.z = 'G'; o.zRem = gz - t; } else if(t < gz + 3) o.z = 'Y';
  else if(t >= gz + 4.5 && t < gz + 4.5 + gx) { o.x = 'G'; o.xRem = gz + 4.5 + gx - t; } else if(t >= gz + 4.5 + gx && t < gz + 7.5 + gx) o.x = 'Y';
  return o;
}

// Active chunks registry: key `${cx},${cz}` -> chunk data
const activeChunks = new Map();
let isDayMode = true;

// ---- Per-chunk instancing: repeated shapes (tree crowns/trunks, lamp bulbs, props) are drawn in bulk ----
const INST_GEO = {
  trunk:new THREE.CylinderGeometry(0.15, 0.27, 2.6, 8), branch:new THREE.CylinderGeometry(0.05, 0.09, 1.15, 6),
  crown:new THREE.IcosahedronGeometry(1, 1), bulb:new THREE.SphereGeometry(0.22, 8, 6)
};
const INST_MAT = {
  trunk:sharedMat.trunk, branch:sharedMat.trunk, bulb:sharedMat.lampBulb,
  crown:new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.85})
};
for(const k in INST_GEO) INST_GEO[k].userData.shared = true;
const INST_SHADOW = {trunk:true, branch:false, crown:true, bulb:false};
// sx = uniform scale, sy = vertical scale multiplier, hex = optional per-instance tint
function chunkInst(chunk, kind, lx, y, lz, sx, ry, sy, hex, _a, ysc, rx, rz) {
  const list = chunk.inst[kind] || (chunk.inst[kind] = []);
  DUMMY.position.set(lx, y, lz); DUMMY.rotation.set(rx || 0, ry || 0, rz || 0); DUMMY.scale.set(sx, sx * (sy || 1) * (ysc || 1), sx); DUMMY.updateMatrix();
  list.push({m:DUMMY.matrix.clone(), c:hex});
}
function chunkAddInstGeo(chunk, kind, geo, mat, shadow, detail) {
  chunk.instDefs[kind] = {geo, mat, shadow, detail};
}
function finalizeInstances(chunk) {
  for(const kind in chunk.inst) {
    const list = chunk.inst[kind], def = chunk.instDefs[kind] || {geo:INST_GEO[kind], mat:INST_MAT[kind], shadow:INST_SHADOW[kind], detail:kind === 'bulb' || kind === 'branch'};
    if(!def.geo || !list.length) continue;
    const im = new THREE.InstancedMesh(def.geo, def.mat, list.length);
    const col = new THREE.Color();
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); if(it.c !== null && it.c !== undefined) { col.setHex(it.c); im.setColorAt(i, col); } });
    im.instanceMatrix.needsUpdate = true; if(im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = !!def.shadow; im.receiveShadow = true;
    (def.detail && chunk.detail ? chunk.detail : chunk.group).add(im);
  }
}

// ============================================================================
// CHUNK BUILDER HELPERS (All meshes & colliders scoped strictly to chunk)
// ============================================================================
const DUMMY = new THREE.Object3D();
// detail=true puts the mesh in the chunk's detail group, which is hidden for distant chunks (cheaper far view)
function chunkAddBox(chunk, lx, y, lz, w, h, d, material, castShadow=true, collide=true, detail=false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const ud = material.userData;
  if(ud && ud.tx) uvTile(geo, w, h, d, ud, (Math.abs(Math.floor(lx*.37 + lz*.91)) % 4) / 4, (Math.abs(Math.floor(lx*.53 - lz*.29)) % 3) / 3);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(lx, y, lz);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  (detail && chunk.detail ? chunk.detail : chunk.group).add(mesh);
  if(collide) {
    const wx = chunk.worldX + lx;
    const wz = chunk.worldZ + lz;
    chunk.colliders.push({
      minX: wx - w/2, maxX: wx + w/2,
      minZ: wz - d/2, maxZ: wz + d/2,
      minY: y - h/2,  maxY: y + h/2
    });
  }
  return mesh;
}

function chunkAddLamp(chunk, lx, lz, dirX=0, dirZ=0) {
  chunkAddBox(chunk, lx, 3.3, lz, 0.14, 6.6, 0.14, sharedMat.lampPole, true, false);
  chunk.cylinders.push({ x: chunk.worldX + lx, z: chunk.worldZ + lz, r: 0.16 });

  const armLen = 0.95;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(dirX !== 0 ? armLen : 0.1, 0.09, dirZ !== 0 ? armLen : 0.1),
    sharedMat.lampPole
  );
  arm.position.set(lx + dirX * (armLen * 0.45), 6.45, lz + dirZ * (armLen * 0.45));
  chunk.group.add(arm);

  // bulbs are drawn in bulk (one instanced mesh per chunk) and get a night glow halo
  const bx = lx + dirX * (armLen * 0.85), bz = lz + dirZ * (armLen * 0.85);
  chunkInst(chunk, 'bulb', bx, 6.32, bz, 1, 0, 1, null);
  if(typeof glowAdd === 'function') chunk.glow.push(glowAdd(chunk.worldX + bx, 6.32, chunk.worldZ + bz, 3.2, 0xffe2a0, 1));
}

function chunkAddTree(chunk, lx, lz, scale=1.0, rng=Math.random) {
  const trunkH = 2.6 * scale;
  chunkInst(chunk, 'trunk', lx, trunkH * 0.5, lz, scale, 0, 1, null);
  chunk.cylinders.push({ x: chunk.worldX + lx, z: chunk.worldZ + lz, r: 0.30 * scale });
  for(let b = 0; b < 3; b++) {
    const angle = (b * Math.PI * 2) / 3 + rng() * 0.4;
    chunkInst(chunk, 'branch', lx + Math.cos(angle)*0.22*scale, 2.05*scale, lz + Math.sin(angle)*0.22*scale, scale, 0, 1, null, 1, 1, Math.sin(angle) * 0.48, -Math.cos(angle) * 0.48);
  }
  const leaves = [0x305934, 0x3e6c40, 0x4e7b48];
  for(let i = 0; i < 6; i++) {
    const a = i * Math.PI * 2 / 6, r = (i % 2 ? 0.58 : 0.80) * scale, rad = (0.82 + rng()*0.20) * scale;
    chunkInst(chunk, 'crown', lx + Math.cos(a)*r, 2.75*scale + (i%3)*0.22*scale, lz + Math.sin(a)*r, rad, 0, 1.08, leaves[i % 3]);
  }
}

// Detailed Multi-Tiered Skyscraper. The shaft wears a procedural facade (windows, spandrels, balconies, AC units, emissive lit windows).
function chunkAddSkyscraper(chunk, lx, lz, w, d, h, rng) {
  const matIdx = Math.floor(rng() * sharedMat.buildingPalette.length);
  const bodyMat = sharedMat.buildingPalette[matIdx], facade = sharedMat.facade[matIdx];

  // Ground Lobby Podium
  const podiumH = Math.min(5.2, h * 0.22);
  chunkAddBox(chunk, lx, podiumH/2, lz, w, podiumH, d, bodyMat, true, true);
  chunkAddBox(chunk, lx, 2.1, lz + d/2 + 0.04, Math.min(w*0.55, 6.2), 3.6, 0.1, sharedMat.glassDay, false, false, true);
  chunkAddBox(chunk, lx, 4.1, lz + d/2 + 0.75, Math.min(w*0.62, 7.0), 0.22, 1.5, sharedMat.steelDark, true, false, true);

  // Main Tower Shaft (slightly inset for architectural depth) with the facade texture
  const mainW = w * 0.92, mainD = d * 0.92;
  const mainH = h - podiumH;
  chunkAddBox(chunk, lx, podiumH + mainH/2, lz, mainW, mainH, mainD, facade, true, true);

  // Upper Setback Tier for taller towers
  let topY = h;
  if(h > 34) {
    const tierH = 7.5;
    chunkAddBox(chunk, lx, h + tierH/2, lz, mainW * 0.72, tierH, mainD * 0.72, facade, true, false);
    topY = h + tierH;
  }

  // Roof Parapet & Details (Helipad or HVAC + Spire + rooftop sign)
  chunkAddBox(chunk, lx, topY + 0.22, lz, mainW * 0.74, 0.44, mainD * 0.74, sharedMat.roof, false, false, true);
  if(h > 42 && rng() > 0.45) {
    const padSize = Math.min(mainW, mainD) * 0.56;
    const helipad = new THREE.Mesh(new THREE.BoxGeometry(padSize, 0.16, padSize), sharedMat.helipad);
    helipad.position.set(lx, topY + 0.48, lz);
    chunk.detail.add(helipad);
  } else {
    chunkAddBox(chunk, lx - mainW*0.16, topY + 0.85, lz - mainD*0.14, 2.2, 1.1, 1.8, sharedMat.steelDark, true, false, true);
    chunkAddBox(chunk, lx + mainW*0.18, topY + 0.75, lz + mainD*0.15, 1.6, 0.9, 1.6, sharedMat.steelLight, true, false, true);
    if(h > 36) chunkAddBox(chunk, lx, topY + 3.8, lz, 0.16, 6.8, 0.16, sharedMat.steelLight, false, false, true);
  }
  if(rng() < 0.4) { const sg = sharedMat.shopSigns[Math.floor(rng() * sharedMat.shopSigns.length)]; chunkAddBox(chunk, lx, topY + 1.6, lz + mainD*0.34, Math.min(mainW * 0.7, 9), 1.5, 0.25, sg.mat, false, false, true); }

  // Floor belts + balconies on residential-style facades (variant 1)
  const floorStep = 2.8, startY = podiumH + 1.8;
  for(let wy = startY; wy < h - 1.2; wy += floorStep) chunkAddBox(chunk, lx, wy - 1.15, lz, mainW + 0.24, 0.16, mainD + 0.24, sharedMat.steelDark, false, false, true);
  if(matIdx % 3 === 1) {
    let n = 0;
    for(let wy = startY + floorStep; wy < Math.min(h - 3, podiumH + 30) && n < 36; wy += floorStep * 2) {
      for(const face of [1, -1]) {
        const cols = Math.max(1, Math.floor((mainW - 2) / 4.4));
        for(let c = 0; c < cols; c++) if(rng() < 0.45) {
          const bx = lx - mainW/2 + 1.6 + (c + 0.5) * ((mainW - 3.2) / cols), bz = lz + face * (mainD/2 + 0.45);
          chunkAddBox(chunk, bx, wy - 0.75, bz, 2.0, 0.12, 0.9, sharedMat.steelLight, false, false, true);
          chunkAddBox(chunk, bx, wy - 0.2, lz + face * (mainD/2 + 0.88), 2.0, 0.9, 0.04, sharedMat.glassDay, false, false, true);
          n++;
        }
      }
    }
  }
}

// Detailed Suburban House with Porch, Pitched Roof, Chimney, Framed Windows & Yard Fence
function chunkAddHouse(chunk, lx, lz, facingZ, rng) {
  const w = 11.5, d = 10.5, h = 4.6;
  const wallMat = sharedMat.housePalette[Math.floor(rng() * sharedMat.housePalette.length)];
  const roofMat = sharedMat.roofPalette[Math.floor(rng() * sharedMat.roofPalette.length)];

  // Main House Body
  chunkAddBox(chunk, lx, h/2, lz, w, h, d, wallMat, true, true);

  // Pitched Hip Roof with Overhang
  const roof = new THREE.Mesh(new THREE.ConeGeometry(8.8, 3.2, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(lx, h + 1.55, lz);
  roof.castShadow = true;
  roof.receiveShadow = true;
  chunk.group.add(roof);

  // Brick Chimney
  chunkAddBox(chunk, lx + 3.6, h + 2.3, lz - 2.2 * facingZ, 1.1, 2.5, 1.1, sharedMat.roofPalette[1], true, false, true);

  // Front Porch, Steps, Pillars & Door
  const frontZ = lz + facingZ * (d / 2);
  chunkAddBox(chunk, lx, 0.22, frontZ + facingZ * 1.1, 4.4, 0.44, 2.2, sharedMat.sidewalk, true, false, true);
  chunkAddBox(chunk, lx, 2.75, frontZ + facingZ * 1.1, 4.6, 0.22, 2.3, roofMat, true, false, true);
  for(const sx of [-1.9, 1.9]) {
    chunkAddBox(chunk, lx + sx, 1.5, frontZ + facingZ * 1.95, 0.22, 2.4, 0.22, sharedMat.whiteLine, true, false, true);
  }
  chunkAddBox(chunk, lx, 1.45, frontZ + facingZ * 0.05, 1.5, 2.3, 0.14, sharedMat.trunk, false, false);

  // Framed Windows with Sills
  for(const sx of [-3.4, 3.4]) {
    chunkAddBox(chunk, lx + sx, 2.5, frontZ + facingZ * 0.06, 2.0, 1.45, 0.1, sharedMat.winLit, false, false);
    chunkAddBox(chunk, lx + sx, 1.72, frontZ + facingZ * 0.12, 2.2, 0.14, 0.24, sharedMat.whiteLine, false, false, true);
    for(const sh of [-1.15, 1.15]) chunkAddBox(chunk, lx + sx + sh, 2.5, frontZ + facingZ * 0.1, 0.3, 1.5, 0.08, sharedMat.roofPalette[2], false, false, true);
  }
}

// Detailed Retail Shop with Neon Sign, Striped Awning & Glass Display Front
function chunkAddShop(chunk, lx, lz, facingZ, rng) {
  const w = 15.0, d = 11.5, h = 6.2;
  const wallMat = sharedMat.facade[Math.floor(rng() * sharedMat.facade.length)];
  const shopSpec = sharedMat.shopSigns[Math.floor(rng() * sharedMat.shopSigns.length)];

  chunkAddBox(chunk, lx, h/2, lz, w, h, d, wallMat, true, true);
  chunkAddBox(chunk, lx, h + 0.2, lz, w + 0.4, 0.4, d + 0.4, sharedMat.roof, true, false, true);

  const frontZ = lz + facingZ * (d / 2);
  // Large Storefront Window & Entry Door
  chunkAddBox(chunk, lx - 2.2, 2.0, frontZ + facingZ * 0.06, 6.8, 3.2, 0.12, sharedMat.glassDay, false, false);
  chunkAddBox(chunk, lx + 3.6, 1.75, frontZ + facingZ * 0.06, 2.2, 3.1, 0.14, sharedMat.steelDark, false, false);

  // Awning & Illuminated Signboard
  const awningMat = new THREE.MeshStandardMaterial({color: shopSpec.awning, roughness:0.75});
  chunkAddBox(chunk, lx, 3.9, frontZ + facingZ * 0.95, w * 0.88, 0.38, 1.85, awningMat, true, false, true);
  chunkAddBox(chunk, lx + w*0.46*facingZ*0 + (rng() < .5 ? -1 : 1) * (w/2 + 0.12), 4.6, frontZ - facingZ * 1.2, 0.18, 1.8, 1.0, shopSpec.mat, false, false, true);
  chunkAddBox(chunk, lx, 5.15, frontZ + facingZ * 0.14, 7.6, 1.25, 0.22, shopSpec.mat, false, false);
}

// Highway Overhead Directional Gantry spanning across the 28m highway (supports strictly outside roadbed)
function chunkAddHighwayGantry(chunk, lx, lz, alongX) {
  const span = HIGHWAY_HALF_W * 2 + 2.6; // 30.6m span so pillars sit in the sidewalk buffer
  const pillarOffset = span / 2;
  if(alongX) {
    // Highway runs East-West (along X), gantry spans North-South (along Z)
    chunkAddBox(chunk, lx, 3.6, lz - pillarOffset, 0.45, 7.2, 0.45, sharedMat.steelLight, true, false);
    chunkAddBox(chunk, lx, 3.6, lz + pillarOffset, 0.45, 7.2, 0.45, sharedMat.steelLight, true, false);
    chunk.cylinders.push({ x: chunk.worldX + lx, z: chunk.worldZ + lz - pillarOffset, r: 0.35 });
    chunk.cylinders.push({ x: chunk.worldX + lx, z: chunk.worldZ + lz + pillarOffset, r: 0.35 });
    chunkAddBox(chunk, lx, 6.9, lz, 0.45, 0.45, span, sharedMat.steelLight, true, false);
    chunkAddBox(chunk, lx, 6.7, lz - 6.5, 0.25, 1.8, 8.5, sharedMat.gantryGreen, true, false);
    chunkAddBox(chunk, lx, 6.7, lz + 6.5, 0.25, 1.8, 8.5, sharedMat.gantryGreen, true, false);
  } else {
    // Highway runs North-South (along Z), gantry spans East-West (along X)
    chunkAddBox(chunk, lx - pillarOffset, 3.6, lz, 0.45, 7.2, 0.45, sharedMat.steelLight, true, false);
    chunkAddBox(chunk, lx + pillarOffset, 3.6, lz, 0.45, 7.2, 0.45, sharedMat.steelLight, true, false);
    chunk.cylinders.push({ x: chunk.worldX + lx - pillarOffset, z: chunk.worldZ + lz, r: 0.35 });
    chunk.cylinders.push({ x: chunk.worldX + lx + pillarOffset, z: chunk.worldZ + lz, r: 0.35 });
    chunkAddBox(chunk, lx, 6.9, lz, span, 0.45, 0.45, sharedMat.steelLight, true, false);
    chunkAddBox(chunk, lx - 6.5, 6.7, lz, 8.5, 1.8, 0.25, sharedMat.gantryGreen, true, false);
    chunkAddBox(chunk, lx + 6.5, 6.7, lz, 8.5, 1.8, 0.25, sharedMat.gantryGreen, true, false);
  }
}

// ============================================================================
// BUILD A SINGLE 120m x 120m CHUNK WITH 100% STRICT ROAD-SAFE ZONING
// ============================================================================
function buildChunk(cx, cz) {
  const worldX = cx * CHUNK_SIZE;
  const worldZ = cz * CHUNK_SIZE;
  const group = new THREE.Group();
  group.position.set(worldX, 0, worldZ);
  scene.add(group);
  const detail = new THREE.Group(); group.add(detail);

  const chunk = {
    inst:{}, instDefs:{}, glow:[], sigSlots:[],
    cx, cz,
    key: `${cx},${cz}`,
    worldX, worldZ,
    group, detail,
    colliders: [],
    cylinders: [],
    district: getChunkDistrict(cx, cz)
  };

  const rng = mulberry32(hashChunk(cx, cz, 1));

  // 1. Base Grass Terrain Tile (120m x 120m)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), sharedMat.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  group.add(ground);

  // Boundary road widths for West (cx), East (cx+1), North (cz), South (cz+1)
  const westHalfW  = getBoundaryHalfWidth(cx);
  const eastHalfW  = getBoundaryHalfWidth(cx + 1);
  const northHalfW = getBoundaryHalfWidth(cz);
  const southHalfW = getBoundaryHalfWidth(cz + 1);

  const westType  = getBoundaryRoadType(cx);
  const eastType  = getBoundaryRoadType(cx + 1);
  const northType = getBoundaryRoadType(cz);
  const southType = getBoundaryRoadType(cz + 1);

  // 2. Render Half-Width Boundary Roads (West & East edges at lx = -60, +60; North & South at lz = -60, +60)
  // West Boundary Strip (x from -60 to -60 + westHalfW)
  chunkAddBox(chunk, -HALF_CHUNK + westHalfW/2, 0.0, 0, westHalfW, 0.08, CHUNK_SIZE, sharedMat.road, false, false);
  // East Boundary Strip (x from +60 - eastHalfW to +60)
  chunkAddBox(chunk,  HALF_CHUNK - eastHalfW/2, 0.0, 0, eastHalfW, 0.08, CHUNK_SIZE, sharedMat.road, false, false);
  // North Boundary Strip (z from -60 to -60 + northHalfW)
  chunkAddBox(chunk, 0, 0.0, -HALF_CHUNK + northHalfW/2, CHUNK_SIZE, 0.08, northHalfW, sharedMat.road, false, false);
  // South Boundary Strip (z from +60 - southHalfW to +60)
  chunkAddBox(chunk, 0, 0.0,  HALF_CHUNK - southHalfW/2, CHUNK_SIZE, 0.08, southHalfW, sharedMat.road, false, false);

  // 3. Render Central Local Neighborhood Streets (Cross at lx = 0 and lz = 0, width 9m)
  const localSpanXStart = -HALF_CHUNK + westHalfW;
  const localSpanXEnd   =  HALF_CHUNK - eastHalfW;
  const localSpanZStart = -HALF_CHUNK + northHalfW;
  const localSpanZEnd   =  HALF_CHUNK - southHalfW;

  chunkAddBox(chunk, (localSpanXStart + localSpanXEnd)/2, 0.002, 0, localSpanXEnd - localSpanXStart, 0.08, LOCAL_HALF_W * 2, sharedMat.road, false, false);
  chunkAddBox(chunk, 0, 0.002, (localSpanZStart + localSpanZEnd)/2, LOCAL_HALF_W * 2, 0.08, localSpanZEnd - localSpanZStart, sharedMat.road, false, false);

  // 4. Lane Markings, Highway Jersey Barriers & Overhead Gantries
  // West & North boundary centerlines (drawn only on West & North edges so adjacent chunks don't Z-fight)
  if(westType === 'HIGHWAY') {
    // Center concrete Jersey barrier along lx = -60 (outside intersection core)
    for(let p = -HALF_CHUNK + northHalfW + 4; p <= HALF_CHUNK - southHalfW - 4; p += 12) {
      if(Math.abs(p) < LOCAL_HALF_W + 3) continue;
      chunkAddBox(chunk, -HALF_CHUNK, 0.45, p, 0.65, 0.9, 10.5, sharedMat.jerseyBarrier, true, true);
    }
    // White lane dashes at ±6.5m from highway center
    for(let p = -HALF_CHUNK + northHalfW + 3; p < HALF_CHUNK - southHalfW - 3; p += 10) {
      if(Math.abs(p) < LOCAL_HALF_W + 2) continue;
      chunkAddBox(chunk, -HALF_CHUNK + 6.5, 0.05, p, 0.22, 0.02, 4.5, sharedMat.whiteLine, false, false);
    }
    if(Math.abs(cz) % 2 === 1) chunkAddHighwayGantry(chunk, -HALF_CHUNK, 24, false);
  } else {
    // Avenue double yellow centerline at lx = -60 + 0.22
    for(let p = -HALF_CHUNK + northHalfW + 2; p < HALF_CHUNK - southHalfW - 2; p += 8) {
      if(Math.abs(p) < LOCAL_HALF_W + 1.5) continue;
      chunkAddBox(chunk, -HALF_CHUNK + 0.22, 0.05, p, 0.16, 0.02, 6.5, sharedMat.yellowLine, false, false);
    }
  }
  if(eastType === 'HIGHWAY') {
    for(let p = -HALF_CHUNK + northHalfW + 3; p < HALF_CHUNK - southHalfW - 3; p += 10) {
      if(Math.abs(p) < LOCAL_HALF_W + 2) continue;
      chunkAddBox(chunk, HALF_CHUNK - 6.5, 0.05, p, 0.22, 0.02, 4.5, sharedMat.whiteLine, false, false);
    }
  }

  if(northType === 'HIGHWAY') {
    for(let p = -HALF_CHUNK + westHalfW + 4; p <= HALF_CHUNK - eastHalfW - 4; p += 12) {
      if(Math.abs(p) < LOCAL_HALF_W + 3) continue;
      chunkAddBox(chunk, p, 0.45, -HALF_CHUNK, 10.5, 0.9, 0.65, sharedMat.jerseyBarrier, true, true);
    }
    for(let p = -HALF_CHUNK + westHalfW + 3; p < HALF_CHUNK - eastHalfW - 3; p += 10) {
      if(Math.abs(p) < LOCAL_HALF_W + 2) continue;
      chunkAddBox(chunk, p, 0.05, -HALF_CHUNK + 6.5, 4.5, 0.02, 0.22, sharedMat.whiteLine, false, false);
    }
    if(Math.abs(cx) % 2 === 1) chunkAddHighwayGantry(chunk, -24, -HALF_CHUNK, true);
  } else {
    for(let p = -HALF_CHUNK + westHalfW + 2; p < HALF_CHUNK - eastHalfW - 2; p += 8) {
      if(Math.abs(p) < LOCAL_HALF_W + 1.5) continue;
      chunkAddBox(chunk, p, 0.05, -HALF_CHUNK + 0.22, 6.5, 0.02, 0.16, sharedMat.yellowLine, false, false);
    }
  }
  if(southType === 'HIGHWAY') {
    for(let p = -HALF_CHUNK + westHalfW + 3; p < HALF_CHUNK - eastHalfW - 3; p += 10) {
      if(Math.abs(p) < LOCAL_HALF_W + 2) continue;
      chunkAddBox(chunk, p, 0.05, HALF_CHUNK - 6.5, 4.5, 0.02, 0.22, sharedMat.whiteLine, false, false);
    }
  }

  // Local street dashed white centerlines
  for(let p = localSpanXStart + 3; p < localSpanXEnd - 3; p += 9) {
    if(Math.abs(p) < LOCAL_HALF_W + 1.5) continue;
    chunkAddBox(chunk, p, 0.05, 0, 4.0, 0.02, 0.16, sharedMat.whiteLine, false, false);
  }
  for(let p = localSpanZStart + 3; p < localSpanZEnd - 3; p += 9) {
    if(Math.abs(p) < LOCAL_HALF_W + 1.5) continue;
    chunkAddBox(chunk, 0, 0.05, p, 0.16, 0.02, 4.0, sharedMat.whiteLine, false, false);
  }

  // 5. Compute the 4 Exact Interior Quadrant Bounds (Strictly Bounded Inside Road Curbs!)
  const quadrants = [
    { // North-West Quadrant
      minX: -HALF_CHUNK + westHalfW,
      maxX: -LOCAL_HALF_W,
      minZ: -HALF_CHUNK + northHalfW,
      maxZ: -LOCAL_HALF_W,
      roadFaceZ: 1 // Faces South (+Z) onto local street
    },
    { // North-East Quadrant
      minX: LOCAL_HALF_W,
      maxX: HALF_CHUNK - eastHalfW,
      minZ: -HALF_CHUNK + northHalfW,
      maxZ: -LOCAL_HALF_W,
      roadFaceZ: 1
    },
    { // South-West Quadrant
      minX: -HALF_CHUNK + westHalfW,
      maxX: -LOCAL_HALF_W,
      minZ: LOCAL_HALF_W,
      maxZ: HALF_CHUNK - southHalfW,
      roadFaceZ: -1 // Faces North (-Z) onto local street
    },
    { // South-East Quadrant
      minX: LOCAL_HALF_W,
      maxX: HALF_CHUNK - eastHalfW,
      minZ: LOCAL_HALF_W,
      maxZ: HALF_CHUNK - southHalfW,
      roadFaceZ: -1
    }
  ];

  // 6. Build Sidewalk Perimeters, Streetlamps & Strict Interior Buildable Lots for Each Quadrant
  quadrants.forEach((q, qIdx) => {
    const qw = q.maxX - q.minX;
    const qd = q.maxZ - q.minZ;
    const qcx = (q.minX + q.maxX) / 2;
    const qcz = (q.minZ + q.maxZ) / 2;

    // Raised Concrete Sidewalk Platform covering the quadrant perimeter
    chunkAddBox(chunk, qcx, 0.08, qcz, qw, 0.16, qd, sharedMat.sidewalkTiled, false, false);

    // Streetlamps strictly on sidewalk corners (inset 0.75m from curb so never on road)
    chunkAddLamp(chunk, q.minX + 0.75, q.minZ + 0.75,  1,  0);
    chunkAddLamp(chunk, q.maxX - 0.75, q.maxZ - 0.75, -1,  0);

    // Strict Interior Lot Bounds (guaranteed >= 5.8m away from every road edge!)
    const lotMinX = q.minX + SIDEWALK_W + LOT_SAFETY_PAD;
    const lotMaxX = q.maxX - SIDEWALK_W - LOT_SAFETY_PAD;
    const lotMinZ = q.minZ + SIDEWALK_W + LOT_SAFETY_PAD;
    const lotMaxZ = q.maxZ - SIDEWALK_W - LOT_SAFETY_PAD;
    const lotW = lotMaxX - lotMinX;
    const lotD = lotMaxZ - lotMinZ;
    const lotCX = (lotMinX + lotMaxX) / 2;
    const lotCZ = (lotMinZ + lotMaxZ) / 2;

    if(lotW < 10 || lotD < 10) return;

    // Populate Interior Lot based on Chunk District Zoning
    if(chunk.district === 'PARK' || (cx === 0 && cz === 0 && qIdx === 3)) {
      // Lush Urban Park with manicured lawn, pathways, and multi-layered trees
      chunkAddBox(chunk, lotCX, 0.17, lotCZ, lotW, 0.06, lotD, sharedMat.parkGrass, false, false);
      chunkAddBox(chunk, lotCX, 0.18, lotCZ, lotW, 0.07, 2.4, sharedMat.sidewalk, false, false);
      chunkAddBox(chunk, lotCX, 0.18, lotCZ, 2.4, 0.07, lotD, sharedMat.sidewalk, false, false);

      // Place 6 trees strictly inside the park lawn (padded from edges and paths)
      const treeOffsets = [
        [-0.32, -0.32], [0.32, -0.32],
        [-0.32,  0.32], [0.32,  0.32],
        [-0.18, -0.18], [0.18,  0.18]
      ];
      for(const [ox, oz] of treeOffsets) {
        const tx = lotCX + ox * (lotW - 3.5);
        const tz = lotCZ + oz * (lotD - 3.5);
        chunkAddTree(chunk, tx, tz, 0.85 + rng() * 0.35, rng);
      }
    } else if(chunk.district === 'DOWNTOWN') {
      // High-Rise Skyscraper or Twin Modern Office Towers
      if(lotW > 26 && rng() > 0.45) {
        const subW = (lotW - 3.5) / 2;
        const subD = Math.min(lotD - 2.0, 22);
        chunkAddSkyscraper(chunk, lotMinX + subW/2, lotCZ, subW, subD, 28 + rng() * 34, rng);
        chunkAddSkyscraper(chunk, lotMaxX - subW/2, lotCZ, subW, subD, 24 + rng() * 30, rng);
      } else {
        const bW = Math.min(lotW - 2.0, 24);
        const bD = Math.min(lotD - 2.0, 24);
        chunkAddSkyscraper(chunk, lotCX, lotCZ, bW, bD, 32 + rng() * 42, rng);
      }
      // Corner decorative plaza trees strictly inside the lot
      chunkAddTree(chunk, lotMinX + 1.4, lotMinZ + 1.4, 0.78, rng);
      chunkAddTree(chunk, lotMaxX - 1.4, lotMaxZ - 1.4, 0.78, rng);
    } else if(chunk.district === 'COMMERCIAL') {
      // Vibrant Retail Strip Shops facing the local neighborhood street
      if(lotW > 32) {
        chunkAddShop(chunk, lotMinX + 8.0, lotCZ, q.roadFaceZ, rng);
        chunkAddShop(chunk, lotMaxX - 8.0, lotCZ, q.roadFaceZ, rng);
      } else {
        chunkAddShop(chunk, lotCX, lotCZ, q.roadFaceZ, rng);
      }
      chunkAddTree(chunk, lotCX, lotCZ - q.roadFaceZ * (lotD * 0.36), 0.85, rng);
    } else {
      // Suburban Residential Neighborhood (2 Detailed Houses + Front Lawn Trees)
      chunkAddBox(chunk, lotCX, 0.165, lotCZ, lotW, 0.04, lotD, sharedMat.parkGrass, false, false);
      if(lotW > 26) {
        chunkAddHouse(chunk, lotMinX + 6.4, lotCZ, q.roadFaceZ, rng);
        chunkAddHouse(chunk, lotMaxX - 6.4, lotCZ, q.roadFaceZ, rng);
        chunkAddTree(chunk, lotCX, lotCZ + q.roadFaceZ * (lotD * 0.30), 0.82, rng);
        chunkAddTree(chunk, lotCX, lotCZ - q.roadFaceZ * (lotD * 0.32), 0.92, rng);
      } else {
        chunkAddHouse(chunk, lotCX, lotCZ, q.roadFaceZ, rng);
        chunkAddTree(chunk, lotMinX + 2.0, lotCZ + q.roadFaceZ * (lotD * 0.28), 0.85, rng);
      }
    }
  });

  if(typeof chunkDecorate === 'function') chunkDecorate(chunk);
  finalizeInstances(chunk);
  mergeChunk(chunk);
  return chunk;
}

function unloadChunk(key) {
  const chunk = activeChunks.get(key);
  if(!chunk) return;
  scene.remove(chunk.group);
  // Dispose unique per-chunk geometries while preserving shared materials/textures
  if(typeof glowFree === 'function') glowFree(chunk);
  if(typeof sigFree === 'function') sigFree(chunk);
  chunk.group.traverse(obj => {
    if(obj.isInstancedMesh) obj.dispose();
    if(obj.isMesh && obj.geometry && !obj.geometry.userData.shared) {
      obj.geometry.dispose();
    }
  });
  activeChunks.delete(key);
}

let lastCenterCX = null, lastCenterCZ = null;

function updateChunkStreaming(wx, wz, force=false) {
  const centerCX = Math.round(wx / CHUNK_SIZE);
  const centerCZ = Math.round(wz / CHUNK_SIZE);

  if(!force && centerCX === lastCenterCX && centerCZ === lastCenterCZ) return;
  lastCenterCX = centerCX;
  lastCenterCZ = centerCZ;

  const neededKeys = new Set();
  for(let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
    for(let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      const cx = centerCX + dx;
      const cz = centerCZ + dz;
      const key = `${cx},${cz}`;
      neededKeys.add(key);
      if(!activeChunks.has(key)) {
        activeChunks.set(key, buildChunk(cx, cz));
      }
    }
  }

  for(const key of activeChunks.keys()) {
    if(!neededKeys.has(key)) {
      unloadChunk(key);
    }
  }

  for(const ch of activeChunks.values()) ch.detail.visible = Math.max(Math.abs(ch.cx - centerCX), Math.abs(ch.cz - centerCZ)) <= 1;
  const currentChunk = activeChunks.get(`${centerCX},${centerCZ}`);
  chunkInfoEl.textContent = `CHUNK [${centerCX}, ${centerCZ}] · ${activeChunks.size} ACTIVE`;
  if(currentChunk) {
    districtTagEl.textContent = `${currentChunk.district} DISTRICT`;
  }
}

