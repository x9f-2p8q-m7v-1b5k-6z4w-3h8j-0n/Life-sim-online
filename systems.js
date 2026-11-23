'use strict';
// systems.js - Audio, day/night, paint, damage, traffic, pedestrians, performance merging, settings
// ============================================================================
// UPGRADES: AUDIO, LIGHTS, PAINT, DAMAGE, DAY/NIGHT, AMBIENT TRAFFIC, SETTINGS
// ============================================================================
const S = Object.assign({vol:.7, fov:70, dist:2, quality:2, day:10, police:1, mirrors:1}, (()=>{ try { return JSON.parse(localStorage.getItem('lifesimSettings')) || {}; } catch(e) { return {}; } })());
let fxFov = S.fov, fxMode = 0, timeOfDay = 0.4;
const PAINTS = [0xc0392b,0x2980b9,0x27ae60,0xf1c40f,0x8e44ad,0xecf0f1,0x2c3e50,0xe67e22,0xff4fa3,0x16a085];
const cDmg = new THREE.Color(0x2a2a2a);
for(const c of cars) { c.baseHex = c.paint.color.getHex(); c.paintIdx = -1; c.dmg = 0; c.ind = 0; c.sp0 = 0; c._k = ''; }

// ---- Procedural audio ----
const A = {};
function audioInit() {
  if(A.ctx) { A.ctx.resume?.(); return; }
  try {
    const c = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = c.createGain(); A.master.gain.value = S.vol; A.master.connect(c.destination);
    const nb = A.nb = c.createBuffer(1, c.sampleRate*2, c.sampleRate), d = nb.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
    const loopNoise = (type, f, q) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(A.master); s.start(); return g; };
    A.scr = loopNoise('bandpass', 2200, 4); A.wind = loopNoise('lowpass', 500, 0.7);
    A.eng = c.createGain(); A.eng.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(A.eng); A.eng.connect(A.master);
    A.o1 = c.createOscillator(); A.o1.type = 'sawtooth'; A.o2 = c.createOscillator(); A.o2.type = 'square';
    A.o1.connect(lp); A.o2.connect(lp); A.o1.start(); A.o2.start();
    A.horn = c.createGain(); A.horn.gain.value = 0; A.horn.connect(A.master);
    for(const f of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(A.horn); o.start(); }
  } catch(e) { A.ctx = null; }
}
addEventListener('pointerdown', audioInit); addEventListener('keydown', audioInit);
function burst(vol, freq, dur) {
  if(!A.ctx || !A.nb) return;
  const c = A.ctx, s = c.createBufferSource(); s.buffer = A.nb;
  const f = c.createBiquadFilter(); f.frequency.value = freq;
  const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(A.master); s.start(c.currentTime, Math.random()); s.stop(c.currentTime + dur);
}

// ---- Day / night cycle ----
const cNT=new THREE.Color(0x02050c), cDT=new THREE.Color(0x2d6ba4), cNH=new THREE.Color(0x111d30), cDH=new THREE.Color(0xb6dbed),
      cUT=new THREE.Color(0x35405e), cUH=new THREE.Color(0xe8864a), tT=new THREE.Color(), tH=new THREE.Color(),
      cLampN=new THREE.Color(0xffefbd), cLampD=new THREE.Color(0x6a6d6c);
function fxCycleTime() {
  fxMode = (fxMode + 1) % 3;
  if(fxMode === 1) timeOfDay = .5; if(fxMode === 2) timeOfDay = 0;
  document.getElementById('dayButton').textContent = ['🕒 Auto','☀ Day','☾ Night'][fxMode];
}
function fxSky(dt) {
  if(fxMode === 0) timeOfDay = (timeOfDay + dt / (S.day * 60)) % 1;
  const s = Math.sin((timeOfDay - .25) * Math.PI * 2), d = THREE.MathUtils.clamp((s + .15) / .45, 0, 1), n = 1 - d;
  const k = THREE.MathUtils.clamp(1 - Math.abs(s) / .35, 0, 1) * .8;
  tT.copy(cNT).lerp(cDT, d).lerp(cUT, k * .5); tH.copy(cNH).lerp(cDH, d).lerp(cUH, k);
  skyMat.uniforms.top.value.copy(tT); skyMat.uniforms.horizon.value.copy(tH);
  scene.background.copy(tH); scene.fog.color.copy(tH);
  sun.intensity = .24 + 2.96 * d; hemi.intensity = .34 + 1.51 * d;
  starField.material.opacity = n;
  sharedMat.winLit.emissive.setHex(0xffc970); sharedMat.winLit.emissiveIntensity = .85 * n;
  for(const fm of sharedMat.facade) fm.emissiveIntensity = .9 * n;
  sharedMat.lampBulb.color.copy(cLampD).lerp(cLampN, n);
  isDayMode = d > .5; fxDayLevel = d;
  fxSunUpdate(d, k);
  hls.forEach(h => h.intensity = (inCar && activeCar && n > .5) ? 5.4 : 0);
}

// ---- Ambient traffic & pedestrians (local, cosmetic) ----
const aiB = new THREE.BoxGeometry(2.1,.8,4.3), aiC = new THREE.BoxGeometry(1.8,.7,2.2), aiGlass = new THREE.MeshStandardMaterial({color:0x1b2a36, roughness:.2});
const aiCols = [0xb0b8c0,0x3a4b5c,0x9c2f2f,0xe8e4d8,0x2f6b4f,0xc9a227].map(c => new THREE.MeshStandardMaterial({color:c, roughness:.4, metalness:.4}));
const pdB = new THREE.BoxGeometry(.5,1.0,.3), pdH = new THREE.SphereGeometry(.16,8,6), pdHead = new THREE.MeshStandardMaterial({color:0xd8b08c});
const pdCols = [0x3b5bdb,0xc92a2a,0x2b8a3e,0xf08c00,0x7048e8,0x343a40].map(c => new THREE.MeshStandardMaterial({color:c}));
const aiPaint = [0xc7ccd1,0x1b1d20,0xf2f2f0,0x23395b,0x8b1e1e,0x5b6770,0x2f4f3f,0xb8bcc2], aiArch = ['SEDAN','SEDAN','SUV','SUV','SPORT','VAN'];
// (AI cars are now created in traffic.js)
// ---- Realistic pedestrians: vertex-coloured merged bodies + swinging limbs (5 draw calls each) ----
const pdMat = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.85});
const SKIN=[0xf1c9a5,0xe0ac82,0xc68a62,0x8d5a3b,0x6b4328,0xffdbc0], HAIR=[0x16110d,0x3b2a1c,0x6b4a2b,0xa8793a,0xcfcfcf,0x5a2a1a],
      SHIRT=[0x3b5bdb,0xc92a2a,0x2b8a3e,0xf08c00,0x7048e8,0x343a40,0xe9ecef,0x0b7285,0xd6336c], PANTS=[0x1c2230,0x3a4252,0x5c4a3a,0x22262b,0x6b7280,0x2c3e50];
const pc = (g, hex, x=0, y=0, z=0, sx=1, sy=1, sz=1) => {
  g.scale(sx,sy,sz); g.translate(x,y,z); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n*3);
  for(let i=0;i<n;i++) { a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a,3)); return g;
};
function pdMerge(gs) {
  gs = gs.map(g => g.index ? g.toNonIndexed() : g); let n = 0; gs.forEach(g => n += g.attributes.position.count);
  const P = new Float32Array(n*3), N = new Float32Array(n*3), C = new Float32Array(n*3); let o = 0;
  for(const g of gs) { P.set(g.attributes.position.array,o*3); N.set(g.attributes.normal.array,o*3); C.set(g.attributes.color.array,o*3); o += g.attributes.position.count; g.dispose(); }
  const r = new THREE.BufferGeometry(); r.setAttribute('position',new THREE.BufferAttribute(P,3)); r.setAttribute('normal',new THREE.BufferAttribute(N,3)); r.setAttribute('color',new THREE.BufferAttribute(C,3)); return r;
}
function makePed() {
  const rnd = Math.random, pick = a => a[Math.floor(rnd()*a.length)];
  const skin = pick(SKIN), shirt = pick(SHIRT), pants = pick(PANTS), hair = pick(HAIR), shoe = rnd() < .5 ? 0x1a1a1a : 0xe8e8e8, longS = rnd() < .45, fem = rnd() < .5;
  const g = new THREE.Group(), inner = new THREE.Group(); inner.rotation.y = Math.PI; g.add(inner);
  const body = [
    pc(new THREE.CapsuleGeometry(.15,.3,4,10), shirt, 0,1.3,0, fem?1.05:1.2,1,.72),
    pc(new THREE.CapsuleGeometry(.15,.1,4,10), pants, 0,.98,0, fem?1.15:1.12,1,.74),
    pc(new THREE.CylinderGeometry(.045,.05,.1,8), skin, 0,1.58,0),
    pc(new THREE.SphereGeometry(.105,14,12), skin, 0,1.7,0, .9,1.12,1),
    pc(new THREE.SphereGeometry(.112,12,8,0,Math.PI*2,0,Math.PI*.45), hair, 0,1.72,-.012, .95,1.12,1.05),
    pc(new THREE.SphereGeometry(.015,6,4), 0x15110e, -.04,1.71,.09), pc(new THREE.SphereGeometry(.015,6,4), 0x15110e, .04,1.71,.09)
  ];
  if(fem) body.push(pc(new THREE.CapsuleGeometry(.11,.2,4,8), hair, 0,1.62,-.07, 1,1,.7));
  if(rnd() < .3) body.push(pc(new THREE.BoxGeometry(.28,.34,.12), pick(SHIRT), 0,1.32,-.16));
  inner.add(new THREE.Mesh(pdMerge(body), pdMat));
  const limb = (x, y, geos) => { const p = new THREE.Group(); p.position.set(x,y,0); p.add(new THREE.Mesh(pdMerge(geos), pdMat)); inner.add(p); return p; };
  const leg = s => limb(s*.09, .93, [pc(new THREE.CylinderGeometry(.075,.055,.84,10), pants, 0,-.42,0), pc(new THREE.BoxGeometry(.1,.07,.27), shoe, 0,-.875,.05)]);
  const arm = s => limb(s*.2, 1.44, [pc(new THREE.CylinderGeometry(.05,.045,.3,8), shirt, 0,-.15,0), pc(new THREE.CylinderGeometry(.042,.036,.27,8).translate(0,-.135,0).rotateX(-.35), longS?shirt:skin, 0,-.3,0), pc(new THREE.SphereGeometry(.04,8,6), skin, 0,-.5535,.0926)]);
  g.scale.setScalar(.93 + rnd()*.12); g.visible = false; scene.add(g);
  return {g, lL:leg(-1), lR:leg(1), aL:arm(-1), aR:arm(1), ph:0, live:false};
}
// roadPick/respawn/trafficUpdate were replaced by the lane-based, solid, synced traffic system in traffic.js

// ---- Per-frame upgrade update ----
function fxUpdate(dt) {
  fxSky(dt); fxAdapt(dt); driveFrame(dt);
  if(inCar && activeCar) { hlRig.position.copy(activeCar.root.position); hlRig.rotation.y = activeCar.root.rotation.y; }
  for(const c of cars) if(c !== activeCar) c.root.visible = Math.hypot(c.root.position.x - player.position.x, c.root.position.z - player.position.z) < 260;
  const f = (inCar && activeCar) ? activeCar.root.position : player.position;
  for(const [i, t] of mpCarTargets) { const c = cars[i]; if(c && i !== mpGetCarIndex()) { c.paintIdx = Number.isInteger(t.p) ? t.p : -1; c.dmg = t.d || 0; c.ind = t.n || 0; } }
  const blink = Math.floor(performance.now() / 380) % 2 === 0;
  for(const c of cars) {
    const sp = Math.hypot(c.vx, c.vz);
    if(c === activeCar && inCar) {
      const drop = c.sp0 - sp;
      if(drop > 4) { c.dmg = Math.min(1, c.dmg + drop * .012); burst(Math.min(.6, drop * .05), 180, .35); }
      if(c.dmg > .3) { const k = 1 - c.dmg * .35 * dt; c.vx *= k; c.vz *= k; }
    }
    c.sp0 = sp;
    const key = c.paintIdx + '|' + c.dmg.toFixed(2);
    if(key !== c._k) { c._k = key; c.paint.color.setHex(c.paintIdx < 0 ? c.baseHex : PAINTS[c.paintIdx]).lerp(cDmg, c.dmg * .7); c.chassis.scale.y = 1 - c.dmg * .06; }
    if(c.dmg > .45 && Math.random() < dt * 10) emitParticle(new THREE.Vector3(c.root.position.x - Math.sin(c.root.rotation.y) * 1.8, .6, c.root.position.z - Math.cos(c.root.rotation.y) * 1.8), new THREE.Vector3(0,0,0), .6);
    if(c.ind) c.brakeLights[c.ind > 0 ? 0 : 1].material.color.setHex(blink ? 0xffa000 : 0x991610);
  }
  if(A.ctx) {
    const t = A.ctx.currentTime, c = activeCar, drv = inCar && c, sp = drv ? Math.hypot(c.vx, c.vz) : 0;
    const lat = drv ? Math.abs(c.vx * Math.cos(c.root.rotation.y) - c.vz * Math.sin(c.root.rotation.y)) : 0;
    const rev = (c && c.rpm) ? Math.min(1, (c.rpm - 900) / 6300) : Math.min(1, ((sp % 12) / 12) * .5 + (sp / 45) * .7);
    A.o1.frequency.setTargetAtTime(38 + rev * 130, t, .05); A.o2.frequency.setTargetAtTime(19 + rev * 65, t, .05);
    A.eng.gain.setTargetAtTime(drv ? 0.05 + (keys.w ? 0.07 : 0) + 0.03 * rev : 0, t, .08);
    A.scr.gain.setTargetAtTime(drv && sp > 6 && (lat > 2.6 || keys[' ']) ? Math.min(.35, .06 * lat) : 0, t, .05);
    A.wind.gain.setTargetAtTime(drv ? Math.min(.25, sp / 150) : .03, t, .2);
    A.horn.gain.setTargetAtTime(drv && keys.h ? .12 : 0, t, .02);
    if(!inCar) {
      const d = Math.hypot(player.position.x - (A.px||0), player.position.z - (A.pz||0)) / Math.max(dt, .001);
      A.st = (A.st || 0) + dt;
      if(d > 1.2 && onGround && A.st > (keys.shift ? .6 : .38)) { A.st = 0; burst(.07, keys.shift ? 500 : 900, .07); }
    }
    A.px = player.position.x; A.pz = player.position.z;
  }
  trafficTick(dt);
}
addEventListener('keydown', e => {
  if(!running || chatOpen || e.repeat || e.target.tagName === 'INPUT' || !inCar || !activeCar) return;
  const k = e.key.toLowerCase();
  if(k === 'c') { activeCar.paintIdx = (activeCar.paintIdx + 1) % PAINTS.length; toast('Paint changed'); }
  if(k === 'z') activeCar.ind = activeCar.ind === -1 ? 0 : -1;
  if(k === 'x') activeCar.ind = activeCar.ind === 1 ? 0 : 1;
  if(k === 'f') { activeCar.dmg = 0; toast('Vehicle repaired'); }
});

// ---- PERFORMANCE & GRAPHICS PASS ----
// Merge every chunk's static meshes into one mesh per material (hundreds of draw calls -> a handful per chunk)
function mergeChunk(chunk) {
  const d = chunk.detail; if(d) chunk.group.remove(d);
  mergeGroup(chunk.group);
  if(d) { mergeGroup(d); chunk.group.add(d); }
}
function mergeGroup(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), groups = new Map(), all = [];
  g.traverse(o => { if(o.isMesh && !o.isInstancedMesh && o.geometry.index && !Array.isArray(o.material)) all.push(o); });
  for(const o of all) {
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    let e = groups.get(key); if(!e) groups.set(key, e = {m:o.material, c:o.castShadow, r:o.receiveShadow, list:[]});
    e.list.push(o);
  }
  for(const e of groups.values()) {
    if(e.list.length < 2) continue;
    let nv = 0, ni = 0;
    const geos = e.list.map(o => { const gg = o.geometry.clone().applyMatrix4(new THREE.Matrix4().copy(inv).multiply(o.matrixWorld)); nv += gg.attributes.position.count; ni += gg.index.count; return gg; });
    const pos = new Float32Array(nv*3), nor = new Float32Array(nv*3), uv = new Float32Array(nv*2), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for(const gg of geos) {
      pos.set(gg.attributes.position.array, vo*3); nor.set(gg.attributes.normal.array, vo*3);
      if(gg.attributes.uv) uv.set(gg.attributes.uv.array, vo*2);
      for(let i=0;i<gg.index.count;i++) idx[io+i] = gg.index.array[i] + vo;
      vo += gg.attributes.position.count; io += gg.index.count; gg.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor,3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    geo.setIndex(new THREE.BufferAttribute(idx,1)); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, e.m); m.castShadow = e.c; m.receiveShadow = e.r; g.add(m);
    for(const o of e.list) { o.parent.remove(o); o.geometry.dispose(); }
  }
}
// Only 2 shared headlight spots exist (the other 16 per-car lights were costing every pixel, even at intensity 0)
const hlRig = new THREE.Group(); scene.add(hlRig);
const hls = [-.72, .72].map(x => { const l = new THREE.SpotLight(0xfff4d4, 0, 44, Math.PI/5.5, .45, 1); l.position.set(x, .84, -2.2); l.target.position.set(x, -.5, -18); hlRig.add(l, l.target); return l; });
cars.forEach(c => { c.headlights.forEach(h => h.visible = false); c.root.traverse(o => { if(o.isMesh && o.castShadow) { o.geometry.computeBoundingBox(); const z = new THREE.Vector3(); o.geometry.boundingBox.getSize(z); if(Math.max(z.x,z.y,z.z) < .6) o.castShadow = false; } }); });
// Moving sun + environment reflections
const fxSun = new THREE.Vector3(-.5, .8, .4), fxSunRaw = new THREE.Vector3(), cSunD = new THREE.Color(0xfff5e4), cSunU = new THREE.Color(0xff9a50);
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100,16,8), skyMat));
scene.environment = pmrem.fromScene(envScene, 0.04).texture;
function fxSunUpdate(d, k) {
  const a = (timeOfDay - .25) * Math.PI * 2;
  fxSunRaw.set(-Math.cos(a), Math.sin(a), .35).normalize(); fxSun.copy(fxSunRaw); fxSun.y = Math.max(fxSun.y, .12); fxSun.normalize();
  sun.color.copy(cSunD).lerp(cSunU, k); sunDisc.visible = fxSunRaw.y > .02;
  const ei = .1 + .45 * d; for(const m of Object.values(sharedMat)) if(m.isMeshStandardMaterial) m.envMapIntensity = ei;
  for(const c of cars) c.paint.envMapIntensity = .15 + 1.1 * d;
}
// Adaptive resolution: drops render scale when FPS dips, restores it when there is headroom
let fxAvg = 16, fxT = 0, fxGood = 0, fxFrames = 0, fxClock = 0;
const fpsEl = document.createElement('div'); fpsEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:20;font:11px monospace;color:#9fdcff;text-shadow:0 1px 2px #000;pointer-events:none'; document.body.appendChild(fpsEl);
function fxAdapt(dt) {
  fxAvg += (dt * 1000 - fxAvg) * .05; fxT += dt; fxFrames++; fxClock += dt;
  if(fxClock >= .5) { fpsEl.textContent = Math.round(fxFrames / fxClock) + ' FPS · ' + renderer.getPixelRatio().toFixed(2) + 'x · ' + renderer.info.render.calls + ' draws'; fxFrames = 0; fxClock = 0; }
  if(fxT < 1.2) return; fxT = 0;
  const maxPR = [1, 1.5, Math.min(devicePixelRatio, 2)][S.quality]; let pr = renderer.getPixelRatio();
  if(fxAvg > 22) { pr = Math.max(.6, pr - .15); fxGood = 0; } else if(fxAvg < 18 && pr < maxPR && ++fxGood > 4) { pr = Math.min(maxPR, pr + .1); fxGood = 0; }
  if(Math.abs(pr - renderer.getPixelRatio()) > .001) { renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
}

// ---- Settings menu ----
function fxApply() {
  fxFov = S.fov; RENDER_RADIUS = S.dist; if(A.master) A.master.gain.value = S.vol;
  renderer.setPixelRatio([1, 1.5, Math.min(devicePixelRatio, 2)][S.quality]); renderer.setSize(innerWidth, innerHeight);
  sun.castShadow = S.quality > 0;
  const ms = [512, 1024, 2048][S.quality]; if(sun.shadow.mapSize.x !== ms) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(ms, ms); }
  try { localStorage.setItem('lifesimSettings', JSON.stringify(S)); } catch(e) {}
}
const sp = document.createElement('div'); sp.className = 'panel';
sp.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:30;padding:14px 16px;width:250px;display:none;pointer-events:auto;font:12px Inter,Arial,sans-serif;color:#d8e4ec';
const rows = [['vol','Volume',0,1,.05],['fov','Field of view',55,100,1],['dist','Render distance (chunks)',1,3,1],['quality','Graphics (0 low – 2 high)',0,2,1],['day','Day length (minutes)',2,30,1]];
sp.innerHTML = '<strong style="letter-spacing:.12em;color:#79d6ff">SETTINGS</strong>' + rows.map(r => `<label style="display:block;margin-top:9px">${r[1]}: <b id="sv_${r[0]}">${S[r[0]]}</b><input data-k="${r[0]}" type="range" min="${r[2]}" max="${r[3]}" step="${r[4]}" value="${S[r[0]]}" style="width:100%"></label>`).join('');
sp.insertAdjacentHTML('beforeend', [['police', 'Police chases (wanted level)'], ['mirrors', 'Working mirrors (cockpit / hood cam)']].map(r => `<label style="display:block;margin-top:9px;cursor:pointer"><input data-t="${r[0]}" type="checkbox" ${S[r[0]] ? 'checked' : ''}> ${r[1]}</label>`).join(''));
sp.addEventListener('change', e => { const t = e.target.dataset && e.target.dataset.t; if(!t) return; S[t] = e.target.checked ? 1 : 0; fxApply(); });
document.getElementById('hud').appendChild(sp);
sp.addEventListener('input', e => {
  const k = e.target.dataset.k; if(!k) return;
  S[k] = +e.target.value; document.getElementById('sv_' + k).textContent = S[k]; fxApply();
  if(k === 'dist') { const p = (inCar && activeCar) ? activeCar.root.position : player.position; updateChunkStreaming(p.x, p.z, true); }
});
const sb = document.createElement('button'); sb.className = 'tool'; sb.textContent = '⚙ Settings';
sb.onclick = () => { sp.style.display = sp.style.display === 'none' ? 'block' : 'none'; document.exitPointerLock?.(); };
document.getElementById('corner').prepend(sb);
document.querySelector('#help p').insertAdjacentHTML('beforeend', '<br><kbd>H</kbd> Horn &nbsp; <kbd>C</kbd> Paint &nbsp; <kbd>Z</kbd><kbd>X</kbd> Indicators &nbsp; <kbd>F</kbd> Repair &nbsp; <kbd>V</kbd> Camera/mirrors &nbsp; <kbd>G</kbd> Emotes');
document.getElementById('dayButton').textContent = '🕒 Auto';
fxApply();

