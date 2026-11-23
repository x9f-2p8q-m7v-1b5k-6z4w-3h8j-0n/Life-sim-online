'use strict';
// physics.js - Stable collision physics
//  * fixed sub-stepping (displacement per step is capped, so nothing tunnels through thin barriers or lamp posts)
//  * exact SAT contacts (oriented box vs box / box vs circle) with a real contact point, so hits make cars spin
//  * sequential impulses with friction and restitution, mass-aware car vs car
//  * statics are always resolved last, and a "safe pose" snapshot rescues any car that still ends up trapped
//  * circle resolver for the on-foot player that also fixes the old "stuck inside a wall" case
// Replaces the point-sampling collision code that used to live in game.js.

const PH = {E_WALL:.22, E_CAR:.34, MU:.35, SLOP:.004, MAX_CORR:.4, MAX_DISP:.18, hits:[], kin:[], dyn:[], hitPed:[], t:0};
const PO = {A:{}, B:{}, S:{depth:0, nx:0, nz:0}, K:{x:0, z:0}, Q:{nx:0, nz:0, depth:0, px:0, pz:0}};
const PSTATIC = {x:0, z:0, vx:0, vz:0, w:0, im:0, ii:0};

function physObb(cx, cz, ang, hw, hl, o) { // ang = rotation.y. u = right axis, v = forward axis
  const s = Math.sin(ang), c = Math.cos(ang);
  o.x = cx; o.z = cz; o.ux = c; o.uz = -s; o.vx = -s; o.vz = -c; o.hw = hw; o.hl = hl; return o;
}
function physBoxObb(b) {
  return b._o || (b._o = {x:(b.minX + b.maxX) / 2, z:(b.minZ + b.maxZ) / 2, ux:1, uz:0, vx:0, vz:1, hw:(b.maxX - b.minX) / 2, hl:(b.maxZ - b.minZ) / 2});
}
// Kept for compatibility: oriented box + corners of a car
function getCarOBB(c) {
  const o = physObb(c.root.position.x, c.root.position.z, c.root.rotation.y, c.halfW, c.halfL, {});
  o.cx = o.x; o.cz = o.z;
  o.corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => ({x:o.x + o.ux*o.hw*a + o.vx*o.hl*b, z:o.z + o.uz*o.hw*a + o.vz*o.hl*b}));
  return o;
}

// ---- SAT: returns true if overlapping. out.nx/nz = direction that pushes A out of B, out.depth = minimum translation ----
function physSat(A, B, out) {
  const dx = B.x - A.x, dz = B.z - A.z;
  let best = Infinity, bx = 0, bz = 0;
  for(let i = 0; i < 4; i++) {
    let ax, az;
    if(i === 0) { ax = A.ux; az = A.uz; } else if(i === 1) { ax = A.vx; az = A.vz; } else if(i === 2) { ax = B.ux; az = B.uz; } else { ax = B.vx; az = B.vz; }
    const rA = A.hw * Math.abs(ax*A.ux + az*A.uz) + A.hl * Math.abs(ax*A.vx + az*A.vz);
    const rB = B.hw * Math.abs(ax*B.ux + az*B.uz) + B.hl * Math.abs(ax*B.vx + az*B.vz);
    const d = dx*ax + dz*az, ov = rA + rB - Math.abs(d);
    if(ov <= 0) return false;
    if(ov < best) { best = ov; if(d > 0) { bx = -ax; bz = -az; } else { bx = ax; bz = az; } }
  }
  out.depth = best; out.nx = bx; out.nz = bz; return true;
}
// Contact point = average of the corners of each box that lie inside the other (falls back to the face centre)
function physContact(A, B, nx, nz, depth, out) {
  let px = 0, pz = 0, k = 0;
  for(let i = 0; i < 8; i++) {
    const O = i < 4 ? A : B, T = i < 4 ? B : A, j = i & 3, sx = (j & 1) ? 1 : -1, sz = (j & 2) ? 1 : -1;
    const x = O.x + O.ux*O.hw*sx + O.vx*O.hl*sz, z = O.z + O.uz*O.hw*sx + O.vz*O.hl*sz, rx = x - T.x, rz = z - T.z;
    if(Math.abs(rx*T.ux + rz*T.uz) <= T.hw + .02 && Math.abs(rx*T.vx + rz*T.vz) <= T.hl + .02) { px += x; pz += z; k++; }
  }
  if(k) { out.x = px / k; out.z = pz / k; return; }
  const rA = A.hw * Math.abs(nx*A.ux + nz*A.uz) + A.hl * Math.abs(nx*A.vx + nz*A.vz);
  out.x = A.x - nx * (rA - depth * .5); out.z = A.z - nz * (rA - depth * .5);
}
// Oriented box vs circle. Q.n pushes the BOX away from the circle.
function physObbCircle(A, cx, cz, cr, Q) {
  const rx = cx - A.x, rz = cz - A.z, lu = rx*A.ux + rz*A.uz, lv = rx*A.vx + rz*A.vz;
  const qu = Math.max(-A.hw, Math.min(A.hw, lu)), qv = Math.max(-A.hl, Math.min(A.hl, lv));
  const du = lu - qu, dv = lv - qv, d2 = du*du + dv*dv;
  let a, b, depth;
  if(d2 > 1e-10) {
    const d = Math.sqrt(d2); if(d >= cr) return false;
    depth = cr - d; a = -du / d; b = -dv / d;
  } else {
    const pu = A.hw - Math.abs(lu), pv = A.hl - Math.abs(lv);
    if(pu < pv) { a = lu > 0 ? -1 : 1; b = 0; depth = pu + cr; } else { a = 0; b = lv > 0 ? -1 : 1; depth = pv + cr; }
  }
  Q.nx = a*A.ux + b*A.vx; Q.nz = a*A.uz + b*A.vz; Q.depth = depth;
  Q.px = A.x + qu*A.ux + qv*A.vx; Q.pz = A.z + qu*A.uz + qv*A.vz; return true;
}

// ---- Rigid-body helpers (planar: velocity + yaw rate) ----
function physBody(c) {
  const m = c.mass || 1500;
  return {x:c.root.position.x, z:c.root.position.z, vx:c.vx, vz:c.vz, w:(c.angularVel || 0) + (c.spin || 0), im:1/m, ii:3 / (m * (c.halfW*c.halfW + c.halfL*c.halfL))};
}
// Applies an impulse between A (always applied) and B (applied only if applyB). Returns the normal impulse magnitude.
function physImpulse(A, B, nx, nz, px, pz, e, mu, applyB) {
  const rAx = px - A.x, rAz = pz - A.z, rBx = px - B.x, rBz = pz - B.z;
  let rvx = (A.vx + A.w*rAz) - (B.vx + B.w*rBz), rvz = (A.vz - A.w*rAx) - (B.vz - B.w*rBx);
  const vn = rvx*nx + rvz*nz;
  if(vn >= 0) return 0;
  const raN = rAz*nx - rAx*nz, rbN = rBz*nx - rBx*nz, den = A.im + B.im + raN*raN*A.ii + rbN*rbN*B.ii;
  if(den <= 0) return 0;
  const j = -(1 + (-vn > 1.6 ? e : 0)) * vn / den, jx = j*nx, jz = j*nz;
  A.vx += jx * A.im; A.vz += jz * A.im; A.w += (rAz*jx - rAx*jz) * A.ii;
  if(applyB) { B.vx -= jx * B.im; B.vz -= jz * B.im; B.w -= (rBz*jx - rBx*jz) * B.ii; }
  // Coulomb friction along the contact tangent
  rvx = (A.vx + A.w*rAz) - (B.vx + B.w*rBz); rvz = (A.vz - A.w*rAx) - (B.vz - B.w*rBx);
  const vt = rvx*nx + rvz*nz; let tx = rvx - vt*nx, tz = rvz - vt*nz; const tl = Math.hypot(tx, tz);
  if(tl > 1e-3) {
    tx /= tl; tz /= tl;
    const raT = rAz*tx - rAx*tz, rbT = rBz*tx - rBx*tz, dt2 = A.im + B.im + raT*raT*A.ii + rbT*rbT*B.ii;
    let jt = -tl / dt2; const lim = mu * j; if(jt > lim) jt = lim; else if(jt < -lim) jt = -lim;
    const fx = jt*tx, fz = jt*tz;
    A.vx += fx * A.im; A.vz += fz * A.im; A.w += (rAz*fx - rAx*fz) * A.ii;
    if(applyB) { B.vx -= fx * B.im; B.vz -= fz * B.im; B.w -= (rBz*fx - rBx*fz) * B.ii; }
  }
  return j;
}
function physApply(c, b, w0) { c.vx = b.vx; c.vz = b.vz; c.spin = (c.spin || 0) + (b.w - w0); }

// ---- Static world broad phase (3x3 chunk neighbourhood, filtered by distance) ----
function getNearbyChunks(wx, wz) {
  const cx = Math.round(wx / CHUNK_SIZE), cz = Math.round(wz / CHUNK_SIZE), list = [];
  for(let dx = -1; dx <= 1; dx++) for(let dz = -1; dz <= 1; dz++) { const ch = activeChunks.get((cx + dx) + ',' + (cz + dz)); if(ch) list.push(ch); }
  return list;
}
function physGather(x, z, r, boxes, cyls) {
  boxes.length = 0; cyls.length = 0;
  for(const ch of getNearbyChunks(x, z)) {
    for(const b of ch.colliders) {
      if(b.maxY < 0 || b.minY > 3.4) continue;
      if(b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
      boxes.push(b);
    }
    for(const c of ch.cylinders) { if(Math.abs(c.x - x) > r + c.r || Math.abs(c.z - z) > r + c.r) continue; cyls.push(c); }
  }
}
const PG = {boxes:[], cyls:[]};

// ---- Who is dynamic and who is kinematic this frame ----
function physIsKin(c) {
  if(c.kinAI) return true;
  if(typeof mpStarted !== 'undefined' && mpStarted && c.idx !== undefined) {
    const ow = mpCarOwners.get(c.idx);
    if(ow && ow !== mpLocalPeerId) return true;
    if(MPC.has(c.idx)) return true;
    if(mpCarTargets.has(c.idx) && performance.now() - (c.netT || 0) < 800) return true;
  }
  return false;
}
function physInput(c) {
  if(inCar && c === activeCar) return {thr:(keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0), st:(keys.a || keys.arrowleft ? 1 : 0) - (keys.d || keys.arrowright ? 1 : 0), hb:!!keys[' '], drv:true};
  if(c.inp) return {thr:c.inp.thr, st:c.inp.st, hb:!!c.inp.hb, drv:false, ai:true};
  return {thr:0, st:0, hb:false, drv:false};
}

// ---- One fixed sub-step of car dynamics (same handling model as before, now parameterised per vehicle) ----
function carDynamics(c, h, I) {
  const D = c.D || {}, heading = c.root.rotation.y;
  const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading), rightX = Math.cos(heading), rightZ = -Math.sin(heading);
  let fs = c.vx*fwdX + c.vz*fwdZ, ls = c.vx*rightX + c.vz*rightZ;
  const steerScale = 1 - Math.min(.42, Math.abs(fs) / 72), maxSteer = D.steerMax || .62;
  c.steerAngle = THREE.MathUtils.damp(c.steerAngle, I.st * maxSteer * steerScale, I.st !== 0 ? 18 : 22, h);
  const accelForce = 28 * (c.acc || 1) * (I.drv ? driveTorque(c, fs, I.thr, h) : 1);
  let la = 0;
  if(I.thr > 0) { if(fs < -.5) la = 40; else la = Math.max(-6, accelForce * (1 - Math.max(0, fs) / ((c.top || 42) * (c.gearCap || 1)))); }
  else if(I.thr < 0) { if(fs > .5) la = -40; else la = -17 * (1 - Math.max(0, -fs) / 15); }
  if(I.ai && I.thr < 0 && fs < .5 && !c.reverseOk) la = 0;
  if(I.hb || !I.drv) fs *= Math.pow(I.hb ? .92 : (I.ai || c.coast ? (c.coast || .985) : .90), h * 60);
  fs += la * h; fs *= Math.pow(.989, h * 60); fs -= .011 * fs * Math.abs(fs) * h;
  c.isBraking = (I.drv || I.ai) && ((I.thr < 0 && fs > .4) || (I.thr > 0 && fs < -.4) || I.hb); c.lAccel = la;
  const wb = D.wb || 2.7, speedMag = Math.abs(fs);
  if(speedMag > .15) {
    const yawT = (fs / wb) * Math.tan(c.steerAngle) * (D.agility || 1.35);
    c.angularVel = THREE.MathUtils.damp(c.angularVel, yawT, I.hb ? 14 : 18, h);
  } else c.angularVel = THREE.MathUtils.damp(c.angularVel, 0, 14, h);
  c.spin = (c.spin || 0) * Math.exp(-(speedMag < 1 ? 7 : 3.2) * h);
  c.root.rotation.y += (c.angularVel + c.spin) * h;
  const nh = c.root.rotation.y, nfx = -Math.sin(nh), nfz = -Math.cos(nh), nrx = Math.cos(nh), nrz = -Math.sin(nh);
  ls = THREE.MathUtils.damp(ls, 0, I.hb ? 2.4 : 11.5 * (c.grip || 1), h);
  c.vx = nfx*fs + nrx*ls; c.vz = nfz*fs + nrz*ls; c.ls = ls; c.fs = fs;
  c.root.position.x += c.vx * h; c.root.position.z += c.vz * h;
}

// ---- Contacts ----
function physPairContact(ea, eb, it) {
  // ea.c is dynamic. eb.c is dynamic or kinematic (eb.kin). Returns impact speed.
  const a = ea.c, b = eb.c, pa = a.root.position, pb = b.root.position;
  const reach = ea.r + eb.r; if(Math.abs(pa.x - pb.x) > reach || Math.abs(pa.z - pb.z) > reach) return 0;
  physObb(pa.x, pa.z, a.root.rotation.y, a.halfW, a.halfL, PO.A); physObb(pb.x, pb.z, b.root.rotation.y, b.halfW, b.halfL, PO.B);
  if(!physSat(PO.A, PO.B, PO.S)) return 0;
  const nx = PO.S.nx, nz = PO.S.nz, depth = PO.S.depth; physContact(PO.A, PO.B, nx, nz, depth, PO.K);
  const A = physBody(a), B = physBody(b), wa = A.w, wb = B.w;
  const j = physImpulse(A, B, nx, nz, PO.K.x, PO.K.z, PH.E_CAR, PH.MU, !eb.kin);
  const speed = j * A.im;
  if(!eb.kin) { if(a === activeCar && b.idx !== undefined) b.touchedT = performance.now(); if(b === activeCar && a.idx !== undefined) a.touchedT = performance.now(); }
  if(j > 0) {
    physApply(a, A, wa); if(!eb.kin) physApply(b, B, wb);
    if(eb.ai) PH.hits.push({k:'ai', e:eb.ai, car:a, jx:-j*nx, jz:-j*nz, px:PO.K.x, pz:PO.K.z, v:speed});
    else if(!eb.kin) PH.hits.push({k:'car', car:a, other:b, v:speed});
    if(speed > 2.4 && it === 0) for(let s = 0; s < 5; s++) emitParticle(new THREE.Vector3(PO.K.x, .5, PO.K.z), new THREE.Vector3(A.vx, 2, A.vz), 4.5);
  }
  const push = Math.min(Math.max(depth - PH.SLOP, 0) * .85, PH.MAX_CORR * 2);
  if(push > 0) {
    if(eb.kin) { pa.x += nx*push; pa.z += nz*push; }
    else { const sa = A.im / (A.im + B.im); pa.x += nx*push*sa; pa.z += nz*push*sa; pb.x -= nx*push*(1 - sa); pb.z -= nz*push*(1 - sa); b.touched = 1; }
  }
  a.touched = 1; return depth;
}
function physStaticContacts(c) {
  const p = c.root.position; let worst = 0, speedHit = 0;
  for(const b of c._sb) {
    physObb(p.x, p.z, c.root.rotation.y, c.halfW, c.halfL, PO.A);
    const o = physBoxObb(b); if(!physSat(PO.A, o, PO.S)) continue;
    const nx = PO.S.nx, nz = PO.S.nz, depth = PO.S.depth; physContact(PO.A, o, nx, nz, depth, PO.K);
    const A = physBody(c), w0 = A.w, j = physImpulse(A, PSTATIC, nx, nz, PO.K.x, PO.K.z, PH.E_WALL, PH.MU, false);
    if(j > 0) { physApply(c, A, w0); speedHit = Math.max(speedHit, j * A.im); }
    const push = Math.min(Math.max(depth - PH.SLOP, 0), PH.MAX_CORR); p.x += nx*push; p.z += nz*push; worst = Math.max(worst, depth);
  }
  for(const cy of c._sc) {
    physObb(p.x, p.z, c.root.rotation.y, c.halfW, c.halfL, PO.A);
    if(!physObbCircle(PO.A, cy.x, cy.z, cy.r, PO.Q)) continue;
    const nx = PO.Q.nx, nz = PO.Q.nz, depth = PO.Q.depth;
    const A = physBody(c), w0 = A.w, j = physImpulse(A, PSTATIC, nx, nz, PO.Q.px, PO.Q.pz, PH.E_WALL, PH.MU, false);
    if(j > 0) { physApply(c, A, w0); speedHit = Math.max(speedHit, j * A.im); }
    const push = Math.min(Math.max(depth - PH.SLOP, 0), PH.MAX_CORR); p.x += nx*push; p.z += nz*push; worst = Math.max(worst, depth);
  }
  if(speedHit > 3.2 && c._spark !== PH.t) { c._spark = PH.t; for(let s = 0; s < 4; s++) emitParticle(new THREE.Vector3(p.x, .5, p.z), new THREE.Vector3(c.vx, 2, c.vz), 4); }
  c._wall = Math.max(c._wall || 0, speedHit);
  return worst;
}

// ---- Main per-frame car update: fixed sub-steps of dynamics + contacts ----
function updateCars(dt) {
  PH.t++; PH.hits.length = 0; PH.hitPed.length = 0;
  const dyn = PH.dyn; dyn.length = 0; const kin = PH.kin; kin.length = 0;
  for(const c of cars) { c.kinAI = false; (physIsKin(c) ? kin : dyn).push({c, r:Math.hypot(c.halfW, c.halfL), kin:physIsKin(c)}); }
  if(typeof trafficPhysLists === 'function') trafficPhysLists(dyn, kin);
  let maxSp = 0; for(const e of dyn) { const sp = Math.hypot(e.c.vx, e.c.vz); if(sp > maxSp) maxSp = sp; }
  const n = Math.max(1, Math.min(12, Math.ceil(Math.max(maxSp * dt / PH.MAX_DISP, dt * 60 - .001)))), h = dt / n;
  const inputs = new Map();
  for(const e of dyn) {
    const c = e.c, I0 = physInput(c); inputs.set(c, I0);
    if(!c._sb) { c._sb = []; c._sc = []; }
    const quiet = !I0.thr && !I0.st && !I0.hb && Math.abs(c.vx) + Math.abs(c.vz) < .04 && Math.abs(c.spin || 0) < .01 && !c.touched;
    c._tp = c.touched; c.touched = 0;
    if(quiet) { c._sb.length = 0; c._sc.length = 0; }
    else physGather(c.root.position.x, c.root.position.z, c.halfL + c.halfW + Math.hypot(c.vx, c.vz) * dt + 1.5, c._sb, c._sc);
    c._wall = 0;
  }
  const hitCars = [];
  for(let s = 0; s < n; s++) {
    for(const e of dyn) {
      const c = e.c, I = inputs.get(c), idle = !I.thr && !I.st && !I.hb && Math.abs(c.vx) + Math.abs(c.vz) < .04 && Math.abs(c.spin || 0) < .01;
      if(idle) { c.vx = 0; c.vz = 0; c.fs = 0; c.ls = 0; c.isBraking = false; c.angularVel = THREE.MathUtils.damp(c.angularVel, 0, 14, h); continue; }
      carDynamics(c, h, I);
    }
    let deepest = 0;
    for(let it = 0; it < 3; it++) {
      for(let i = 0; i < dyn.length; i++) {
        const a = dyn[i];
        for(let j = i + 1; j < dyn.length; j++) physPairContact(a, dyn[j], it);
        for(const k of kin) physPairContact(a, k, it);
      }
      for(const e of dyn) { const w = physStaticContacts(e.c); if(it === 2 && w > deepest) deepest = w; }
    }
    for(const e of dyn) { // safe-pose recovery: remember last clean pose, rescue if buried
      const c = e.c, p = c.root.position;
      if(c._deep === undefined) c._deep = 0;
      let buried = false;
      for(const b of c._sb) { physObb(p.x, p.z, c.root.rotation.y, c.halfW, c.halfL, PO.A); if(physSat(PO.A, physBoxObb(b), PO.S) && PO.S.depth > .5) { buried = true; break; } }
      if(!buried) { c._deep = 0; if(!c.safe) c.safe = {x:p.x, z:p.z, ry:c.root.rotation.y}; if(s === n - 1) { c.safe.x = p.x; c.safe.z = p.z; c.safe.ry = c.root.rotation.y; } }
      else if(++c._deep > 6 && c.safe) { p.x = c.safe.x; p.z = c.safe.z; c.root.rotation.y = c.safe.ry; c.vx = c.vz = 0; c.spin = 0; c._deep = 0; if(c === activeCar) toast('Vehicle recovered'); }
    }
  }
  // visuals, brake lights, skids, wheel spin (all cars, including kinematic ones)
  const all = dyn.concat(kin);
  for(const e of all) {
    const c = e.c, I = e.kin ? {thr:0, st:0, hb:false, drv:false} : inputs.get(c);
    if(c.ai && c.ai.rails) continue;
    const D = c.D || {}, fs = e.kin ? (c.vx * -Math.sin(c.root.rotation.y) + c.vz * -Math.cos(c.root.rotation.y)) : (c.fs || 0), ls = e.kin ? 0 : (c.ls || 0);
    c.steerPivots.forEach(pv => pv.rotation.y = c.steerAngle);
    if(c.brakeLights) { const br = c.isBraking || c.ai && c.ai.brake; for(const bl of c.brakeLights) bl.material.color.setHex(br ? 0xff261b : 0x991610); }
    const rollMax = D.rollMax || .09;
    const lateralG = ls * c.angularVel, la = c.lAccel || 0;
    const tr = THREE.MathUtils.clamp(-lateralG * .012 - c.steerAngle * (fs / 30) * (D.rollGain || .06), -rollMax, rollMax), tp = THREE.MathUtils.clamp(-la * .0018, -.045, .045);
    c.roll = THREE.MathUtils.damp(c.roll, tr, 12, dt); c.pitch = THREE.MathUtils.damp(c.pitch, tp, 10, dt);
    c.chassis.rotation.z = c.roll; c.chassis.rotation.x = c.pitch;
    const sp = Math.hypot(c.vx, c.vz), slip = e.kin ? 0 : Math.abs(ls);
    const drift = (c === activeCar && inCar) ? (slip > 2.2 || (I.hb && sp > 4) || (c.isBraking && sp > 10)) : (!e.kin && (slip > 3 || (c.isBraking && sp > 12)));
    if(drift && sp > 3) {
      const h0 = c.root.rotation.y, wx = (D.W || 2.14) / 2 - .04, wz = (D.L || 4.4) * .32, ax = new THREE.Vector3(0, 1, 0);
      const rl = new THREE.Vector3(-wx, 0, wz).applyAxisAngle(ax, h0).add(c.root.position), rr = new THREE.Vector3(wx, 0, wz).applyAxisAngle(ax, h0).add(c.root.position);
      if(c === activeCar || Math.random() < .5) { emitParticle(rl, new THREE.Vector3(c.vx, 0, c.vz)); emitParticle(rr, new THREE.Vector3(c.vx, 0, c.vz)); }
      const id = c.idx !== undefined ? c.idx : (c.ai ? 'a' + c.ai.id : 'x'); skidAdd(id + 'L', rl); skidAdd(id + 'R', rr); c._skid = true;
    } else if(c._skid) { const id = c.idx !== undefined ? c.idx : (c.ai ? 'a' + c.ai.id : 'x'); skidBreak(id + 'L'); skidBreak(id + 'R'); c._skid = false; }
    const rot = (c.D && c.D.wheelR ? 1 / c.D.wheelR : 2.38) * fs * dt; for(const w of c.wheelMeshes) w.rotation.x -= rot;
  }
  if(typeof pedCarContacts === 'function') pedCarContacts(dyn, kin);
  if(typeof wantedOnHits === 'function') wantedOnHits(PH.hits);
}

// ============================================================================
// ON-FOOT COLLISION: circle vs boxes, cylinders, cars (dynamic + AI) and pedestrians
// ============================================================================
function resolveCircleWorld(x, z, r, opt) {
  let cx = x, cz = z, collided = false, nxT = 0, nzT = 0, pen = 0, hitCar = null;
  physGather(cx, cz, r + 1, PG.boxes, PG.cyls);
  const carOb = PO.B, Q = PO.Q, bodies = PH.dyn.concat(PH.kin);
  for(let it = 0; it < 4; it++) {
    let any = false;
    for(const b of PG.boxes) {
      const px = Math.max(b.minX, Math.min(b.maxX, cx)), pz = Math.max(b.minZ, Math.min(b.maxZ, cz)), dx = cx - px, dz = cz - pz, d2 = dx*dx + dz*dz;
      if(d2 >= r*r) continue;
      let nx, nz, ov;
      if(d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; ov = r - d; }
      else { const l = cx - b.minX, rr = b.maxX - cx, t = cz - b.minZ, bt = b.maxZ - cz, m = Math.min(l, rr, t, bt); if(m === l) { nx = -1; nz = 0; } else if(m === rr) { nx = 1; nz = 0; } else if(m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; } ov = m + r; }
      cx += nx*ov; cz += nz*ov; nxT += nx; nzT += nz; any = collided = true; if(ov > pen) pen = ov;
    }
    for(const cy of PG.cyls) {
      const dx = cx - cy.x, dz = cz - cy.z, mr = r + cy.r, d2 = dx*dx + dz*dz;
      if(d2 >= mr*mr) continue;
      const d = Math.sqrt(d2) || .0001, ov = mr - d, nx = d2 > 1e-10 ? dx / d : 1, nz = d2 > 1e-10 ? dz / d : 0;
      cx += nx*ov; cz += nz*ov; nxT += nx; nzT += nz; any = collided = true; if(ov > pen) pen = ov;
    }
    for(const e of bodies) {
      const c = e.c, p = c.root.position; if(Math.abs(p.x - cx) > e.r + r + .5 || Math.abs(p.z - cz) > e.r + r + .5) continue;
      physObb(p.x, p.z, c.root.rotation.y, c.halfW, c.halfL, carOb);
      if(!physObbCircle(carOb, cx, cz, r, Q)) continue;
      cx -= Q.nx * Q.depth; cz -= Q.nz * Q.depth; nxT -= Q.nx; nzT -= Q.nz; any = collided = true; hitCar = c; if(Q.depth > pen) pen = Q.depth;
    }
    if(opt && opt.peds && typeof trafficPedCircles === 'function') {
      for(const pd of trafficPedCircles()) {
        const dx = cx - pd.x, dz = cz - pd.z, mr = r + pd.r, d2 = dx*dx + dz*dz; if(d2 >= mr*mr) continue;
        const d = Math.sqrt(d2) || .0001, ov = (mr - d) * .6; cx += dx / d * ov; cz += dz / d * ov; any = collided = true; if(pd.e) pd.e.bump = 1;
      }
    }
    if(!any) break;
  }
  const nl = Math.hypot(nxT, nzT); if(nl > 0) { nxT /= nl; nzT /= nl; }
  return {x:cx, z:cz, collided, nx:nxT, nz:nzT, pen, car:hitCar};
}
// Finds the nearest circle-free spot to (x,z) (spiral search). Returns {x,z}.
function physFindFreeSpot(x, z, r, maxR) {
  let res = resolveCircleWorld(x, z, r, null); if(!res.collided || res.pen < .001) return {x, z};
  for(let rad = .8; rad <= (maxR || 10); rad += .8) for(let a = 0; a < 12; a++) {
    const ang = a / 12 * Math.PI * 2, tx = x + Math.cos(ang) * rad, tz = z + Math.sin(ang) * rad;
    const q = resolveCircleWorld(tx, tz, r, null); if(!q.collided) return {x:tx, z:tz};
  }
  return {x, z};
}
// True if a car-shaped box at (x,z,ang) overlaps nothing (statics + other cars)
function physCarSpotFree(c, x, z, ang) {
  physGather(x, z, c.halfL + c.halfW + 1, PG.boxes, PG.cyls);
  const A = physObb(x, z, ang, c.halfW + .25, c.halfL + .25, {}), S = {};
  for(const b of PG.boxes) if(physSat(A, physBoxObb(b), S)) return false;
  for(const cy of PG.cyls) if(physObbCircle(A, cy.x, cy.z, cy.r, {})) return false;
  for(const o of cars) { if(o === c) continue; const B = physObb(o.root.position.x, o.root.position.z, o.root.rotation.y, o.halfW, o.halfL, {}); if(physSat(A, B, S)) return false; }
  return true;
}
function physFindCarSpot(c, x, z, ang) {
  if(physCarSpotFree(c, x, z, ang)) return {x, z};
  for(let rad = 2; rad <= 30; rad += 2) for(let a = 0; a < 16; a++) {
    const t = a / 16 * Math.PI * 2, tx = x + Math.cos(t) * rad, tz = z + Math.sin(t) * rad;
    if(physCarSpotFree(c, tx, tz, ang)) return {x:tx, z:tz};
  }
  return {x, z};
}
// Exit position beside a car: tries left, right, behind, in front, then searches
function physExitSpot(c) {
  const a = c.root.rotation.y, rx = Math.cos(a), rz = -Math.sin(a), fx = -Math.sin(a), fz = -Math.cos(a), px = c.root.position.x, pz = c.root.position.z;
  const side = c.halfW + playerRadius + .35, ends = c.halfL + playerRadius + .35;
  for(const [dx, dz] of [[-rx*side, -rz*side], [rx*side, rz*side], [-fx*ends, -fz*ends], [fx*ends, fz*ends]]) {
    const q = resolveCircleWorld(px + dx, pz + dz, playerRadius + .08, null); if(!q.collided) return {x:px + dx, z:pz + dz};
  }
  return physFindFreeSpot(px - rx*side, pz - rz*side, playerRadius + .08, 12);
}
