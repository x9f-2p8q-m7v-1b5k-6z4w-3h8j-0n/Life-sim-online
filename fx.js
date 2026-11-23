'use strict';
// fx.js - skid marks, soft tire smoke support and bloom (post-processing)

// ---- Skid marks: a ring buffer of dark quads laid on the road ----
const SK = {N:1800, last:new Map()};
SK.pos = new Float32Array(SK.N * 12); SK.n = 0;
SK.geo = new THREE.BufferGeometry();
SK.geo.setAttribute('position', new THREE.BufferAttribute(SK.pos, 3));
{ const idx = new Uint32Array(SK.N * 6); for(let i=0;i<SK.N;i++) { const v = i*4; idx.set([v,v+1,v+2, v+2,v+1,v+3], i*6); } SK.geo.setIndex(new THREE.BufferAttribute(idx, 1)); }
SK.mesh = new THREE.Mesh(SK.geo, new THREE.MeshBasicMaterial({color:0x090909, transparent:true, opacity:.5, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, side:THREE.DoubleSide}));
SK.mesh.frustumCulled = false; scene.add(SK.mesh);
function skidAdd(k, p) {
  const l = SK.last.get(k);
  if(l) {
    const dx = p.x - l.x, dz = p.z - l.z, d = Math.hypot(dx, dz);
    if(d > 3) { l.copy(p); return; }
    if(d < .35) return;
    const sx = -dz / d * .11, sz = dx / d * .11, o = (SK.n % SK.N) * 12, a = SK.pos;
    a[o]=l.x+sx; a[o+1]=.05; a[o+2]=l.z+sz;  a[o+3]=l.x-sx; a[o+4]=.05; a[o+5]=l.z-sz;
    a[o+6]=p.x+sx; a[o+7]=.05; a[o+8]=p.z+sz; a[o+9]=p.x-sx; a[o+10]=.05; a[o+11]=p.z-sz;
    SK.n++; SK.geo.attributes.position.needsUpdate = true; l.copy(p);
  } else SK.last.set(k, p.clone());
}
function skidBreak(k) { if(k === undefined) SK.last.clear(); else SK.last.delete(k); }

// ---- Bloom (highest Graphics setting only; falls back to a normal render if unavailable) ----
const BL = {composer:null, pass:null, key:'', ok:true};
function bloomInit() {
  const F = window.THREE_FX; if(!F) return;
  try {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {type:THREE.HalfFloatType, samples:4});
    const c = new F.EffectComposer(renderer, rt);
    c.addPass(new F.RenderPass(scene, camera));
    BL.pass = new F.UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .5, .55, .9);
    c.addPass(BL.pass); c.addPass(new F.OutputPass()); BL.composer = c;
  } catch(e) { console.warn('Bloom unavailable', e); BL.composer = null; }
}
bloomInit();
let fxDayLevel = 1; // set every frame by fxSky()
const softTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32,32,0,32,32,32); r.addColorStop(0,'rgba(255,255,255,1)'); r.addColorStop(.4,'rgba(255,255,255,.55)'); r.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })();
particleMat.uniforms.tex.value = softTex;
function fxRender() { fxRenderMain(); if(typeof mirrorRender === 'function') mirrorRender(); }
function fxRenderMain() {
  particleMat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  const pr = renderer.getPixelRatio();
  if(BL.composer && S.quality === 2) { if(pr < .8) BL.ok = false; else if(pr >= .95) BL.ok = true; }
  if(!BL.composer || S.quality !== 2 || !BL.ok) { renderer.render(scene, camera); return; }
  const key = pr + '|' + innerWidth + '|' + innerHeight;
  if(key !== BL.key) { BL.key = key; BL.composer.setPixelRatio(pr); BL.composer.setSize(innerWidth, innerHeight); }
  const n = 1 - fxDayLevel; BL.pass.strength = .12 + .55 * n; BL.pass.threshold = .95 - .18 * n; BL.pass.radius = .55;
  BL.composer.render();
}
