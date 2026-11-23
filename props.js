'use strict';
// props.js - world details: night glow halos, traffic signals, crosswalks and stop lines, bus stops,
// parked cars along the curb, hydrants, bins, benches, mailboxes and speed-limit signs.
// Repeated things are drawn with instancing (one draw call per kind per chunk).

// ============================================================================
// GLOW HALOS (instanced additive billboards, fade in at night)
// ============================================================================
const GL = {N:4600, free:[], hw:0, night:{value:0}};
GL.mat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, uniforms:{tex:{value:softTex}, night:GL.night},
  vertexShader:'varying vec2 vUv; varying vec3 vCol; void main(){ vUv = uv; vCol = instanceColor; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float size = length(instanceMatrix[0].xyz); c.xy += position.xy * size; gl_Position = projectionMatrix * c; }',
  fragmentShader:'uniform sampler2D tex; uniform float night; varying vec2 vUv; varying vec3 vCol; void main(){ float a = texture2D(tex, vUv).a * night; if(a < .01) discard; gl_FragColor = vec4(vCol, a * .9); }'
});
GL.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), GL.mat, GL.N);
GL.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GL.N * 3), 3);
GL.mesh.frustumCulled = false; GL.mesh.count = 0; GL.mesh.renderOrder = 5; scene.add(GL.mesh);
const glTmp = new THREE.Object3D(), glCol = new THREE.Color();
function glowAdd(x, y, z, size, hex) {
  const i = GL.free.length ? GL.free.pop() : (GL.hw < GL.N ? GL.hw++ : -1);
  if(i < 0) return -1;
  glowSet(i, x, y, z, size, hex); GL.mesh.count = GL.hw; return i;
}
function glowSet(i, x, y, z, size, hex) {
  if(i < 0) return;
  glTmp.position.set(x, y, z); glTmp.scale.set(size, size, size); glTmp.updateMatrix(); GL.mesh.setMatrixAt(i, glTmp.matrix);
  glCol.setHex(hex); GL.mesh.setColorAt(i, glCol); GL.mesh.instanceMatrix.needsUpdate = true; GL.mesh.instanceColor.needsUpdate = true;
}
function glowFree(chunk) { for(const i of chunk.glow) { if(i < 0) continue; glTmp.scale.set(0, 0, 0); glTmp.updateMatrix(); GL.mesh.setMatrixAt(i, glTmp.matrix); GL.free.push(i); } chunk.glow.length = 0; GL.mesh.instanceMatrix.needsUpdate = true; }

// ============================================================================
// TRAFFIC SIGNAL HEADS (instanced lamps, recoloured as the phase changes)
// ============================================================================
const TT = {T:0};            // shared traffic clock (host-synced in multiplayer)
const SGC = {off:0x1b1b1b, R:0xff2418, Y:0xffc21a, G:0x28ff6a};
const SG = {N:3300, free:[], hw:0};
SG.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.26, .26, .26), new THREE.MeshBasicMaterial({color:0xffffff}), SG.N);
SG.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SG.N * 3), 3); SG.mesh.frustumCulled = false; SG.mesh.count = 0; scene.add(SG.mesh);
function sgAlloc(x, y, z) {
  const i = SG.free.length ? SG.free.pop() : (SG.hw < SG.N ? SG.hw++ : -1); if(i < 0) return -1;
  glTmp.position.set(x, y, z); glTmp.scale.set(1, 1, 1); glTmp.updateMatrix(); SG.mesh.setMatrixAt(i, glTmp.matrix); SG.mesh.count = SG.hw; SG.mesh.instanceMatrix.needsUpdate = true;
  glCol.setHex(SGC.off); SG.mesh.setColorAt(i, glCol); SG.mesh.instanceColor.needsUpdate = true; return i;
}
function sigFree(chunk) {
  for(const s of chunk.sigSlots) for(const h of s.heads) {
    for(const l of h.lamps) if(l >= 0) { glTmp.scale.set(0, 0, 0); glTmp.updateMatrix(); SG.mesh.setMatrixAt(l, glTmp.matrix); SG.free.push(l); }
    if(h.glow >= 0) { glTmp.scale.set(0, 0, 0); glTmp.updateMatrix(); GL.mesh.setMatrixAt(h.glow, glTmp.matrix); GL.free.push(h.glow); }
  }
  chunk.sigSlots.length = 0; SG.mesh.instanceMatrix.needsUpdate = true; GL.mesh.instanceMatrix.needsUpdate = true;
}
const sgTmp = {};
function sigVisualUpdate() {
  GL.night.value = Math.max(0, Math.min(1, 1 - fxDayLevel)) * (S.quality >= 1 ? 1 : 0);
  let dirty = false, gdirty = false;
  for(const ch of activeChunks.values()) for(const s of ch.sigSlots) {
    sigState(s.a, s.b, TT.T, sgTmp);
    for(const h of s.heads) {
      const st = h.axis === 'z' ? sgTmp.z : sgTmp.x; if(st === h.st) continue; h.st = st;
      const lit = st === 'R' ? 0 : st === 'Y' ? 1 : 2;
      for(let k = 0; k < 3; k++) if(h.lamps[k] >= 0) { glCol.setHex(k === lit ? SGC[st] : SGC.off); SG.mesh.setColorAt(h.lamps[k], glCol); }
      if(h.glow >= 0) { glowSet(h.glow, h.x, h.y + (lit === 0 ? .36 : lit === 1 ? 0 : -.36), h.z, 2.2, SGC[st]); gdirty = true; }
      dirty = true;
    }
  }
  if(dirty) SG.mesh.instanceColor.needsUpdate = true;
}
// Signal state for traffic moving along 'axis' at crossing (a,b), used by the AI
const sgAI = {};
function sigFor(axis, a, b) { sigState(a, b, TT.T, sgAI); return axis === 'z' ? sgAI.z : sgAI.x; }

// ============================================================================
// SHARED PROP GEOMETRY
// ============================================================================
const PR = {};
(function() {
  const vc = (g, hex, x=0, y=0, z=0, sx=1, sy=1, sz=1) => pc(g, hex, x, y, z, sx, sy, sz);
  const carGeo = (h, roofH, len) => pdMerge([
    vc(new THREE.BoxGeometry(2.0, .72, 4.3), 0xffffff, 0, .62, 0), vc(new THREE.BoxGeometry(1.74, .1, len), 0xffffff, 0, .62 + .36 + roofH + .24, -.15),
    vc(new THREE.BoxGeometry(1.78, roofH * .6 + .15, len - .05), 0x16212c, 0, .98 + roofH * .5 + .14, -.15),
    vc(new THREE.BoxGeometry(1.7, roofH, len - .4), 0xffffff, 0, .98 + roofH * .5 - .1, -.15, 1, .35, 1),
    vc(new THREE.BoxGeometry(1.5, .12, .08), 0xfff2c8, 0, .72, 2.15), vc(new THREE.BoxGeometry(1.5, .12, .08), 0xb01818, 0, .72, -2.15),
    ...[[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]].map(([sx, z]) => vc(new THREE.CylinderGeometry(.35, .35, .26, 12).rotateZ(Math.PI / 2), 0x0d0e10, sx * .98, .35, z))
  ]);
  PR.sedan = carGeo(0, .5, 2.2); PR.suv = carGeo(0, .62, 2.9);
  PR.parkMat = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.35, metalness:.45});
  PR.hydrant = pdMerge([vc(new THREE.CylinderGeometry(.13, .15, .55, 10), 0xffffff, 0, .28, 0), vc(new THREE.SphereGeometry(.14, 10, 6), 0xffffff, 0, .58, 0), vc(new THREE.CylinderGeometry(.06, .06, .4, 8).rotateZ(Math.PI / 2), 0xffffff, 0, .4, 0)]);
  PR.bin = pdMerge([vc(new THREE.CylinderGeometry(.27, .22, .8, 10), 0xffffff, 0, .4, 0), vc(new THREE.CylinderGeometry(.29, .29, .06, 10), 0x303338, 0, .83, 0)]);
  PR.bench = pdMerge([vc(new THREE.BoxGeometry(1.7, .08, .45), 0xffffff, 0, .5, 0), vc(new THREE.BoxGeometry(1.7, .4, .06), 0xffffff, 0, .78, -.2), vc(new THREE.BoxGeometry(.08, .5, .4), 0x2b2f35, -.75, .25, 0), vc(new THREE.BoxGeometry(.08, .5, .4), 0x2b2f35, .75, .25, 0)]);
  PR.mail = pdMerge([vc(new THREE.BoxGeometry(.5, .8, .5), 0xffffff, 0, .75, 0), vc(new THREE.BoxGeometry(.1, .4, .1), 0x303338, 0, .2, 0)]);
  PR.pole = new THREE.CylinderGeometry(.04, .04, 2.6, 6); PR.plate = new THREE.BoxGeometry(.55, .7, .04);
  for(const k in PR) if(PR[k].isBufferGeometry) PR[k].userData.shared = true;
  PR.mats = {hydrant:new THREE.MeshStandardMaterial({vertexColors:true, roughness:.5}), bin:new THREE.MeshStandardMaterial({vertexColors:true, roughness:.7}),
    bench:new THREE.MeshStandardMaterial({vertexColors:true, roughness:.8}), mail:new THREE.MeshStandardMaterial({vertexColors:true, roughness:.5, metalness:.3}),
    pole:sharedMat.lampPole, plate:new THREE.MeshBasicMaterial({map:makeSignTexture('SPEED LIMIT 50', '#f4f4f0', '#111111')})};
  PR.def = {parked0:{geo:PR.sedan, mat:PR.parkMat, shadow:true, detail:false}, parked1:{geo:PR.suv, mat:PR.parkMat, shadow:true, detail:false},
    hydrant:{geo:PR.hydrant, mat:PR.mats.hydrant, shadow:false, detail:true}, bin:{geo:PR.bin, mat:PR.mats.bin, shadow:false, detail:true}, bench:{geo:PR.bench, mat:PR.mats.bench, shadow:true, detail:true},
    mail:{geo:PR.mail, mat:PR.mats.mail, shadow:false, detail:true}, pole:{geo:PR.pole, mat:PR.mats.pole, shadow:false, detail:true}, plate:{geo:PR.plate, mat:PR.mats.plate, shadow:false, detail:true}};
})();
const PARK_COLORS = [0xc7ccd1, 0x1b1d20, 0xf2f2f0, 0x23395b, 0x8b1e1e, 0x5b6770, 0x2f4f3f, 0xb8bcc2, 0xc9a227, 0x6a3d9a, 0x1f7a8c];
function propInst(chunk, kind, lx, y, lz, ry, hex) { chunk.instDefs[kind] = PR.def[kind]; chunkInst(chunk, kind, lx, y, lz, 1, ry, 1, hex); }

// ============================================================================
// CHUNK DECORATION (runs once per chunk, deterministic so every player sees the same city)
// ============================================================================
function chunkDecorate(chunk) {
  const rng = mulberry32(hashChunk(chunk.cx, chunk.cz, 7)), cx = chunk.cx, cz = chunk.cz;
  const westHW = getBoundaryHalfWidth(cx), eastHW = getBoundaryHalfWidth(cx + 1), northHW = getBoundaryHalfWidth(cz), southHW = getBoundaryHalfWidth(cz + 1);
  const white = sharedMat.whiteLine;

  // ---- crosswalks, stop lines and signals at the 4 intersections this chunk owns ----
  for(const ix of [-HALF_CHUNK, 0]) for(const iz of [-HALF_CHUNK, 0]) {
    const a = (chunk.worldX + ix) / 60, b = (chunk.worldZ + iz) / 60, hw1 = roadHalfW(60 * a), hw2 = roadHalfW(60 * b);
    for(const sz of [-1, 1]) { // crosswalks across the arms of the road that runs along Z
      const zc = iz + sz * (hw2 + 1.7);
      for(let x = ix - hw1 + .6; x <= ix + hw1 - .5; x += 1.2) chunkAddBox(chunk, x, .05, zc, .6, .02, 3.0, white, false, false);
    }
    for(const sx of [-1, 1]) { // ...and of the road that runs along X
      const xc = ix + sx * (hw1 + 1.7);
      for(let z = iz - hw2 + .6; z <= iz + hw2 - .5; z += 1.2) chunkAddBox(chunk, xc, .05, z, 3.0, .02, .6, white, false, false);
    }
    // stop lines: right-hand traffic approaches on the right half of each arm
    chunkAddBox(chunk, ix - hw1/2, .05, iz - (hw2 + 3.9), hw1 - .4, .02, .4, white, false, false);
    chunkAddBox(chunk, ix + hw1/2, .05, iz + (hw2 + 3.9), hw1 - .4, .02, .4, white, false, false);
    chunkAddBox(chunk, ix - (hw1 + 3.9), .05, iz + hw2/2, .4, .02, hw2 - .4, white, false, false);
    chunkAddBox(chunk, ix + (hw1 + 3.9), .05, iz - hw2/2, .4, .02, hw2 - .4, white, false, false);
    // signal poles: one per corner, each with a head facing outward along Z and one along X
    const rec = {a, b, heads:[]}; chunk.sigSlots.push(rec);
    for(const sx of [-1, 1]) for(const sz of [-1, 1]) {
      const px = ix + sx * (hw1 + 1.9), pz = iz + sz * (hw2 + 1.9);
      chunkAddBox(chunk, px, 2.3, pz, .18, 4.6, .18, sharedMat.lampPole, true, false);
      chunk.cylinders.push({x:chunk.worldX + px, z:chunk.worldZ + pz, r:.14});
      for(const axis of ['z', 'x']) {
        const fx = axis === 'x' ? sx : 0, fz = axis === 'z' ? sz : 0, hx = px + fx * .22, hz = pz + fz * .22, hy = 3.9;
        chunkAddBox(chunk, hx, hy, hz, axis === 'z' ? .4 : .3, 1.1, axis === 'z' ? .3 : .4, sharedMat.steelDark, false, false, true);
        const lamps = [.36, 0, -.36].map(dy => sgAlloc(chunk.worldX + hx + fx * .16, hy + dy, chunk.worldZ + hz + fz * .16));
        const glow = glowAdd(chunk.worldX + hx + fx * .2, hy, chunk.worldZ + hz + fz * .2, .01, 0x000000);
        rec.heads.push({axis, lamps, glow, st:'', x:chunk.worldX + hx + fx * .2, y:hy, z:chunk.worldZ + hz + fz * .2});
      }
    }
  }

  // ---- bus stops on the avenue sides (right-hand side of each bus route), every 60 m at mid-block ----
  const stops = [];
  if(getBoundaryRoadType(cx) === 'AVENUE') for(const z of [-30, 30]) stops.push([-HALF_CHUNK + westHW, z, 1, 0]);
  if(getBoundaryRoadType(cx + 1) === 'AVENUE') for(const z of [-30, 30]) stops.push([HALF_CHUNK - eastHW, z, -1, 0]);
  if(getBoundaryRoadType(cz) === 'AVENUE') for(const x of [-30, 30]) stops.push([x, -HALF_CHUNK + northHW, 0, 1]);
  if(getBoundaryRoadType(cz + 1) === 'AVENUE') for(const x of [-30, 30]) stops.push([x, HALF_CHUNK - southHW, 0, -1]);
  const busBlue = new THREE.MeshBasicMaterial({color:0x2f6fd0});
  for(const [ex, ez, nx, nz] of stops) {
    const alongZ = nx !== 0, P = e => [ex + nx * e, ez + nz * e], dims = (along, deep) => alongZ ? [deep, along] : [along, deep];
    let [x, z] = P(3.05); chunkAddBox(chunk, x, 1.2, z, alongZ ? .06 : 3.6, 2.4, alongZ ? 3.6 : .06, sharedMat.glassDay, false, false, true);
    [x, z] = P(2.1); { const d = dims(3.8, 2.3); chunkAddBox(chunk, x, 2.55, z, d[0], .12, d[1], sharedMat.steelDark, true, false, true); }
    for(const o of [-1.7, 1.7]) { const px = alongZ ? ex + nx * 2.9 : ex + o, pz = alongZ ? ez + o : ez + nz * 2.9; chunkAddBox(chunk, px, 1.25, pz, .1, 2.5, .1, sharedMat.steelLight, true, false, true); chunk.cylinders.push({x:chunk.worldX + px, z:chunk.worldZ + pz, r:.1}); }
    [x, z] = P(2.55); propInst(chunk, 'bench', x, 0, z, Math.atan2(-nx, -nz), 0x7a5a3a);
    chunk.colliders.push(alongZ ? {minX:chunk.worldX + x - .3, maxX:chunk.worldX + x + .3, minZ:chunk.worldZ + z - .85, maxZ:chunk.worldZ + z + .85, minY:.1, maxY:1} : {minX:chunk.worldX + x - .85, maxX:chunk.worldX + x + .85, minZ:chunk.worldZ + z - .3, maxZ:chunk.worldZ + z + .3, minY:.1, maxY:1});
    [x, z] = P(.55); const sx0 = alongZ ? x : x - 1.9, sz0 = alongZ ? z - 1.9 : z; // bus stop sign pole just behind the stopping point
    chunkAddBox(chunk, sx0, 1.3, sz0, .07, 2.6, .07, sharedMat.lampPole, false, false, true); chunk.cylinders.push({x:chunk.worldX + sx0, z:chunk.worldZ + sz0, r:.08});
    chunkAddBox(chunk, sx0, 2.45, sz0, alongZ ? .05 : .6, .6, alongZ ? .6 : .05, busBlue, false, false, true);
  }

  // ---- parked cars along local-street curbs (static, solid, instanced) ----
  const homes = cars.map(c => c.home).filter(Boolean);
  const slot = (lx, lz, ry, ax) => {
    const wx = chunk.worldX + lx, wz = chunk.worldZ + lz;
    for(const h of homes) if(Math.hypot(h.x - wx, h.z - wz) < 9) return;
    const suv = rng() < .35, hex = PARK_COLORS[Math.floor(rng() * PARK_COLORS.length)];
    propInst(chunk, suv ? 'parked1' : 'parked0', lx, 0, lz, ry, hex);
    const hwid = 1.06, hlen = suv ? 2.3 : 2.2;
    chunk.colliders.push(ax === 'z' ? {minX:wx - hwid, maxX:wx + hwid, minZ:wz - hlen, maxZ:wz + hlen, minY:.1, maxY:1.7} : {minX:wx - hlen, maxX:wx + hlen, minZ:wz - hwid, maxZ:wz + hwid, minY:.1, maxY:1.7});
  };
  for(let z = -HALF_CHUNK + northHW + 12; z <= HALF_CHUNK - southHW - 12; z += 9.6) { if(Math.abs(z) < 12) continue; if(rng() < .3) slot(3.3, z, 0, 'z'); if(rng() < .3) slot(-3.3, z, Math.PI, 'z'); }
  for(let x = -HALF_CHUNK + westHW + 12; x <= HALF_CHUNK - eastHW - 12; x += 9.6) { if(Math.abs(x) < 12) continue; if(rng() < .3) slot(x, 3.3, -Math.PI / 2, 'x'); if(rng() < .3) slot(x, -3.3, Math.PI / 2, 'x'); }

  // ---- street furniture along the sidewalk edges of every quadrant ----
  const quads = [[-HALF_CHUNK + westHW, -LOCAL_HALF_W, -HALF_CHUNK + northHW, -LOCAL_HALF_W], [LOCAL_HALF_W, HALF_CHUNK - eastHW, -HALF_CHUNK + northHW, -LOCAL_HALF_W],
                 [-HALF_CHUNK + westHW, -LOCAL_HALF_W, LOCAL_HALF_W, HALF_CHUNK - southHW], [LOCAL_HALF_W, HALF_CHUNK - eastHW, LOCAL_HALF_W, HALF_CHUNK - southHW]];
  for(const [x0, x1, z0, z1] of quads) {
    const edges = [[x0 + .5, null, 1, 0, z0, z1, 'x'], [x1 - .5, null, -1, 0, z0, z1, 'x'], [null, z0 + .5, 0, 1, x0, x1, 'z'], [null, z1 - .5, 0, -1, x0, x1, 'z']];
    for(const [fx, fz, nx, nz, t0, t1, along] of edges) {
      const n = Math.floor(rng() * 3); // 0..2 items per edge
      for(let i = 0; i < n; i++) {
        const t = t0 + 10 + rng() * (t1 - t0 - 20), px = fx === null ? t : fx, pz = fz === null ? t : fz;
        const nearBus = stops.some(([ex, ez]) => Math.hypot(ex - px, ez - pz) < 6); if(nearBus) continue;
        const k = rng(), wx = chunk.worldX + px, wz = chunk.worldZ + pz;
        if(k < .28) { propInst(chunk, 'hydrant', px, 0, pz, 0, 0xd02020); chunk.cylinders.push({x:wx, z:wz, r:.2}); }
        else if(k < .55) { propInst(chunk, 'bin', px, 0, pz, 0, 0x2f5a3a); chunk.cylinders.push({x:wx, z:wz, r:.28}); }
        else if(k < .75) { const ry = Math.atan2(-nx, -nz); propInst(chunk, 'bench', px + nx * .4, 0, pz + nz * .4, ry, 0x7a5a3a); chunk.colliders.push(nx !== 0 ? {minX:wx + nx*.4 - .3, maxX:wx + nx*.4 + .3, minZ:wz - .85, maxZ:wz + .85, minY:.1, maxY:1} : {minX:wx - .85, maxX:wx + .85, minZ:wz + nz*.4 - .3, maxZ:wz + nz*.4 + .3, minY:.1, maxY:1}); }
        else if(k < .9) { propInst(chunk, 'mail', px, 0, pz, 0, 0x2457b5); chunk.cylinders.push({x:wx, z:wz, r:.26}); }
        else { propInst(chunk, 'pole', px, 1.3, pz, 0, null); chunk.instDefs.plate = PR.def.plate; chunkInst(chunk, 'plate', px - nx * .06, 2.1, pz - nz * .06, 1, Math.atan2(-nx, -nz), 1, null); chunk.cylinders.push({x:wx, z:wz, r:.08}); }
      }
    }
  }
}
