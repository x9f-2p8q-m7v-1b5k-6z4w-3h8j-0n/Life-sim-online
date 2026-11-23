'use strict';
// traffic.js - Solid, synced traffic.
//  * AI cars follow lanes on the road grid, stop at red lights, turn right at intersections, brake/swerve for you, and are SOLID
//    (they take part in the same collision physics as your car; hard hits knock them off their rails into free physics).
//  * Buses run avenue routes and dwell at bus stops. Taxis, trucks, vans, a motorbike and patrol cars share the roads.
//  * Pedestrians walk the sidewalks, wait at crosswalks for the walk signal, step aside, and jump back when you honk or speed past.
//  * Police + wanted level (optional in Settings).
//  * Multiplayer: the host simulates everything and broadcasts it ~10x/second; clients interpolate and report their hits back.
//    If the host leaves, whoever becomes host adopts the traffic exactly where it was.

const TR = {cars:[], peds:[]};
const TRF = {auth:true, wasAuth:true, hitOut:[], honkSeq:0, lastPack:0, bodies:[], spawnCool:0, T0:0, tRecv:0, remoteHonk:new Map(), foci:[]};
const TR_ROSTER = ['SEDAN', 'SUV', 'TAXI', 'SEDAN', 'VAN', 'SPORT', 'TAXI', 'TRUCK', 'SUV', 'SEDAN', 'BUS', 'BIKE', 'POLICE', 'SEDAN', 'SUV', 'SEDAN',
  'SEDAN', 'SUV', 'TAXI', 'SEDAN', 'SPORT', 'VAN', 'SEDAN', 'SUV', 'TRUCK', 'BUS', 'SEDAN', 'TAXI', 'BIKE', 'SEDAN', 'SUV', 'SEDAN', 'SEDAN', 'TAXI', 'VAN', 'SUV'];
const TR_CHASE = [100, 101, 102, 103];
const TR_PAINTS = {TAXI:0xf4c400, POLICE:0xf2f4f6, BUS:0x1f6fb5, TRUCK:0xe9e9e4, BIKE:0x2f7a3a};
const NPED = 36;

function trLanes(hw) { return hw <= 5 ? [1.1] : hw <= 9 ? [2.2, 6.0] : [3.6, 10.4]; }
function trVec(axis, dir) { return axis === 'x' ? {fx:dir, fz:0, rx:0, rz:dir} : {fx:0, fz:dir, rx:-dir, rz:0}; }
function nextK(s, dir) { return dir > 0 ? Math.floor(s / 60 + 1e-6) + 1 : Math.ceil(s / 60 - 1e-6) - 1; }
function wrapAng(a) { return THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI; }

// ---- entities (one dedicated model each; fixed roster so every player has the same ids) ----
function trMakeCar(id, type, chase) {
  const color = TR_PAINTS[type] || aiPaint[(id * 3) % aiPaint.length];
  const car = type === 'BIKE' ? makeBike(0, 0, 0, color) : makeCar(0, 0, 0, color, type);
  car.root.visible = false; car.kinAI = true; car.baseHex = color;
  car.chassis.traverse(o => { if(o.isMesh && o.material === sharedMat.glassDay) o.castShadow = false; });
  const e = {id, type, car, chase:!!chase, live:false, mode:'dead', rails:false, dyn:false, axis:'z', L:0, dir:1, lane:1.1, shift:0, s:0, v:0, cruise:12, intentK:null, intent:'S', dwell:0, stuckT:0, hazard:false, brake:false, siren:false, tx:0, tz:0, try:0, tvx:0, tvz:0, tf:0, trecv:0, seen:0, freeT:0, hw:car.halfW, hl:car.halfL};
  car.ai = e; return e;
}
TR_ROSTER.forEach((t, i) => TR.cars.push(trMakeCar(i, t, false)));
TR_CHASE.forEach(id => TR.cars.push(trMakeCar(id, 'POLICE', true)));
for(let i = 0; i < NPED; i++) { const p = makePed(); p.id = i; p.live = false; p.state = 'walk'; p.axis = 'z'; p.L = 0; p.off = 3; p.s = 0; p.dir = 1; p.nud = 0; p.react = 0; p.down = 0; p.wait = 0; p.kvx = p.kvz = 0; p.px = p.pz = 0; p.tx = p.tz = p.try = 0; p.trecv = 0; p.seen = 0; p.v = 1.3; p.decK = null; p.sp = 0; TR.peds.push(p); }
const trById = new Map(); TR.cars.forEach(e => trById.set(e.id, e));
const visRadius = () => Math.min(260, RENDER_RADIUS * 120 + 50);

// ---- focus points: every player in the world (host simulates traffic around all of them) ----
function trFoci() {
  const f = TRF.foci; f.length = 0;
  const me = (inCar && activeCar) ? activeCar.root.position : player.position; f.push({x:me.x, z:me.z, id:'me'});
  if(typeof mpPlayers !== 'undefined') for(const [id, st] of mpPlayers) {
    if(id === mpLocalPeerId) continue;
    let x = st.x, z = st.z; if(st.inCar && cars[st.carIndex]) { x = cars[st.carIndex].root.position.x; z = cars[st.carIndex].root.position.z; }
    if(Number.isFinite(x) && Number.isFinite(z) && performance.now() - (st.lastSeen || 0) < 6000) f.push({x, z, id, w:st.w || 0, st});
  }
  return f;
}

// ---- collision bodies the AI looks at (cars, AI cars, pedestrians, on-foot players) ----
function trBuildBodies() {
  const B = TRF.bodies; B.length = 0;
  const push = (x, z, ang, hw, hl, vx, vz, ref, kind) => { const s = Math.sin(ang), c = Math.cos(ang); B.push({x, z, ux:c, uz:-s, vx:-s, vz:-c, hw, hl, vx_:vx, vz_:vz, ref, kind}); };
  for(const c of cars) push(c.root.position.x, c.root.position.z, c.root.rotation.y, c.halfW, c.halfL, c.vx, c.vz, c, 'car');
  for(const e of TR.cars) if(e.live) push(e.car.root.position.x, e.car.root.position.z, e.car.root.rotation.y, e.car.halfW, e.car.halfL, e.car.vx, e.car.vz, e, 'ai');
  for(const p of TR.peds) if(p.live && p.state !== 'down') push(p.g.position.x, p.g.position.z, 0, .35, .35, p.sp * Math.sin(p.g.rotation.y) * -1, p.sp * Math.cos(p.g.rotation.y) * -1, p, 'ped');
  if(!inCar) push(player.position.x, player.position.z, 0, .48, .48, 0, 0, player, 'foot');
  for(const av of mpRemoteAvatars.values()) if(av.group.visible) push(av.group.position.x, av.group.position.z, 0, .48, .48, 0, 0, av, 'foot');
  return B;
}
const PRB = {vmax:99, o:null};
function trProbe(e, fx, fz, speed, extra) {
  const rx = -fz, rz = fx, p = e.car.root.position, hwE = e.car.halfW * .92, hlE = e.car.halfL, Ld = 6 + speed * 1.4 + speed * speed / 10 + (extra || 0);
  PRB.vmax = 99; PRB.o = null;
  for(const o of TRF.bodies) {
    if(o.ref === e) continue;
    const dx = o.x - p.x, dz = o.z - p.z, al = dx*fx + dz*fz; if(al < .3 || al > Ld + 8) continue;
    const la = dx*rx + dz*rz; if(Math.abs(la) > 7) continue;
    const ha = o.hw*Math.abs(o.ux*fx + o.uz*fz) + o.hl*Math.abs(o.vx*fx + o.vz*fz), hlat = o.hw*Math.abs(o.ux*rx + o.uz*rz) + o.hl*Math.abs(o.vx*rx + o.vz*rz);
    if(Math.abs(la) > hwE + hlat - .12) continue;
    const gap = al - ha - hlE; if(gap > Ld) continue;
    const v = Math.sqrt(Math.max(0, 10 * (gap - (o.kind === 'ped' || o.kind === 'foot' ? 2.4 : 1.6)))) + Math.max(0, o.vx_*fx + o.vz_*fz);
    if(v < PRB.vmax) { PRB.vmax = v; PRB.o = o; }
  }
  return PRB;
}
function trClear(x, z, r) {
  for(const o of TRF.bodies) if(o.kind !== 'ped' && Math.hypot(o.x - x, o.z - z) < r) return false;
  return true;
}

// ---- pose helpers ----
function aiPlace(e) {
  const v = trVec(e.axis, e.dir), car = e.car, lane = e.lane + e.shift;
  const x = e.axis === 'z' ? e.L + v.rx * lane : e.s, z = e.axis === 'x' ? e.L + v.rz * lane : e.s;
  car.root.position.set(x, 0, z); car.root.rotation.y = Math.atan2(-v.fx, -v.fz); car.vx = v.fx * e.v; car.vz = v.fz * e.v;
}
function aiSpawn(e, foci) {
  const f = foci[Math.floor(Math.random() * foci.length)];
  for(let tries = 0; tries < 12; tries++) {
    const axis = Math.random() < .5 ? 'z' : 'x', base = axis === 'z' ? f.x : f.z, along = axis === 'z' ? f.z : f.x;
    const L = 60 * Math.round((base + (Math.random() - .5) * 300) / 60), hw = roadHalfW(L), lanes = trLanes(hw), avenue = hw === AVENUE_HALF_W && Math.abs(Math.round(L / 60)) % 2 === 1;
    if(e.type === 'BUS' && !avenue) continue; if(e.type === 'TRUCK' && hw <= 5) continue;
    const dir = Math.random() < .5 ? 1 : -1, wide = e.type === 'BUS' || e.type === 'TRUCK';
    const lane = wide ? lanes[lanes.length - 1] : lanes[Math.floor(Math.random() * lanes.length)];
    const s = along + (Math.random() < .5 ? -1 : 1) * (55 + Math.random() * 190), k = Math.round(s / 60);
    if(Math.abs(s - 60 * k) < roadHalfW(60 * k) + 10) continue;
    Object.assign(e, {axis, L, dir, lane, s, shift:0, v:0});
    const v = trVec(axis, dir), x = axis === 'z' ? L + v.rx * lane : s, z = axis === 'x' ? L + v.rz * lane : s;
    if(!trClear(x, z, 16)) continue;
    e.cruise = (hw > 10 ? 22 : hw > 5 ? 14 : 9) * (e.type === 'BUS' ? .8 : e.type === 'TRUCK' ? .85 : e.type === 'SPORT' ? 1.15 : .92 + Math.random() * .2);
    e.v = e.cruise * .6; e.live = true; e.mode = 'lane'; e.rails = true; e.dyn = false; e.intentK = null; e.dwell = 0; e.turnWait = 0; e.hazard = false; e.stopDone = null; e.stuckT = 0; e.freeT = 0; e.hit = false; e.turn = null;
    e.car.coast = undefined; e.car.kinAI = true; e.car.spin = 0; e.car.angularVel = 0; e.car.steerAngle = 0; e.car.inp = null; e.car.safe = null;
    aiPlace(e); e.car.root.visible = true; return true;
  }
  return false;
}
// Re-derive rails parameters from a world pose (host migration, reconnects)
function aiSnap(e) {
  const car = e.car, a = car.root.rotation.y, fx = -Math.sin(a), fz = -Math.cos(a), p = car.root.position;
  e.axis = Math.abs(fz) > Math.abs(fx) ? 'z' : 'x'; e.dir = (e.axis === 'z' ? fz : fx) >= 0 ? 1 : -1;
  const lat = e.axis === 'z' ? p.x : p.z; e.L = 60 * Math.round(lat / 60); const hw = roadHalfW(e.L), lanes = trLanes(hw);
  const raw = e.axis === 'z' ? -e.dir * (p.x - e.L) : e.dir * (p.z - e.L);
  e.lane = lanes.reduce((b, l) => Math.abs(l - raw) < Math.abs(b - raw) ? l : b, lanes[0]); e.s = e.axis === 'z' ? p.z : p.x; e.v = Math.hypot(car.vx, car.vz); e.shift = 0;
  e.mode = 'lane'; e.rails = true; e.dyn = false; e.turn = null; e.intentK = null;
}

// ---- rails driving ----
function aiRails(e, dt) {
  const car = e.car; let fx, fz, speed = e.v, vt = e.cruise;
  if(e.mode === 'turn') {
    const T = e.turn; vt = Math.min(vt, 6.5);
    const t = T.t, dx = 2*(1 - t)*(T.p1.x - T.p0.x) + 2*t*(T.p2.x - T.p1.x), dz = 2*(1 - t)*(T.p1.z - T.p0.z) + 2*t*(T.p2.z - T.p1.z), dl = Math.hypot(dx, dz) || 1;
    fx = dx / dl; fz = dz / dl;
    const pr = trProbe(e, fx, fz, e.v, 0); vt = Math.min(vt, pr.vmax);
    e.v += THREE.MathUtils.clamp(vt - e.v, -9 * dt, 3 * dt); e.brake = e.v < vt - .5;
    T.t = Math.min(1, t + e.v * dt / T.len); const u = T.t, w = 1 - u;
    car.root.position.set(w*w*T.p0.x + 2*w*u*T.p1.x + u*u*T.p2.x, 0, w*w*T.p0.z + 2*w*u*T.p1.z + u*u*T.p2.z);
    const ang = Math.atan2(-fx, -fz); let da = wrapAng(ang - car.root.rotation.y); car.steerAngle = THREE.MathUtils.damp(car.steerAngle, THREE.MathUtils.clamp(da * 3, -.5, .5), 10, dt);
    car.root.rotation.y = ang; car.vx = fx * e.v; car.vz = fz * e.v;
    if(T.t >= 1) { e.axis = T.axis; e.L = T.L; e.dir = T.dir; e.lane = T.lane; e.s = T.axis === 'z' ? T.p2.z : T.p2.x; e.mode = 'lane'; e.intentK = null; e.shift = 0; }
    return;
  }
  const vec = trVec(e.axis, e.dir); fx = vec.fx; fz = vec.fz;
  const k = nextK(e.s, e.dir), Sx = 60 * k, dist = (Sx - e.s) * e.dir, hwc = roadHalfW(Sx), stopDist = hwc + 3.9 + e.hl, ds = dist - stopDist;
  if(e.intentK !== k && dist < 48) { e.intentK = k; const lanes = trLanes(roadHalfW(e.L)); e.intent = (e.type !== 'BUS' && e.lane === lanes[lanes.length - 1] && Math.random() < (e.chase ? 0 : .3)) ? 'R' : 'S'; }
  if(e.intent === 'R' && dist < 32) vt = Math.min(vt, 7);
  // traffic signal
  e.sigStop = false;
  if(dist > hwc + .6 && !e.ignoreLights) {
    const a = e.axis === 'z' ? e.L / 60 : k, b = e.axis === 'z' ? k : e.L / 60, st = sigFor(e.axis, a, b);
    const bd = speed * speed / 8; let stop = st === 'R' || (st === 'Y' && ds > bd - .5);
    if(stop) { e.sigStop = true; vt = ds <= .25 ? 0 : Math.min(vt, Math.sqrt(2 * 3.4 * Math.max(0, ds)) + .15); }
  }
  // bus stops (every 60 m mid-block on avenues)
  if(e.type === 'BUS') {
    if(e.dwell > 0) { e.dwell -= dt; vt = 0; }
    else { const sk = e.dir > 0 ? Math.floor((e.s - 30) / 60 + 1e-6) * 60 + 90 : Math.ceil((e.s - 30) / 60 - 1e-6) * 60 - 30, dstop = (sk - e.s) * e.dir;
      if(dstop > 0 && dstop < 45 && e.stopDone !== sk) { vt = Math.min(vt, Math.sqrt(2 * 2 * Math.max(0, dstop - .3)) + .1); if(dstop < .7 && e.v < .6) { e.dwell = 5 + Math.random() * 4; e.stopDone = sk; } } }
  }
  const pr = trProbe(e, fx, fz, e.v, 0); let pv = pr.vmax;
  // swerve around your car / wrecks on wide roads, brake otherwise
  const o = pr.o, wide = roadHalfW(e.L) > 6;
  if(o && wide && (o.kind === 'car' || (o.kind === 'ai' && o.ref.mode === 'free')) && dist > 30) { const room = roadHalfW(e.L) - e.lane - e.car.halfW - .4; e.shift += (Math.min(1.7, Math.max(0, room)) - e.shift) * Math.min(1, dt * 2.5); if(pv < 99) pv = Math.max(pv, Math.min(e.cruise * .6, pv + 3)); }
  else e.shift += (0 - e.shift) * Math.min(1, dt * 2.5);
  vt = Math.min(vt, pv);
  if(e.hazard && e.type === 'TRUCK') vt = 0;
  const acc = e.type === 'BUS' ? 1.6 : e.type === 'TRUCK' ? 2 : 3, dec = vt < e.v - 4 ? 11 : 6.5;
  e.v += THREE.MathUtils.clamp(vt - e.v, -dec * dt, acc * dt); if(vt <= 0 && e.v < .15) e.v = 0;
  e.brake = e.v < vt - .3 || vt < e.v - .8 || e.v < .1; e.s += e.dir * e.v * dt;
  e.stuckT = (e.v < .2 && e.dwell <= 0 && !e.sigStop) ? e.stuckT + dt : 0;
  // start the right turn when the front reaches the cross road
  const dNow = (Sx - e.s) * e.dir;
  if(e.intent === 'R' && e.intentK === k && dNow <= hwc && dNow > hwc - 3 && e.v > .5) {
    const hwA = roadHalfW(e.L), lanesB = trLanes(hwc), oB = lanesB[lanesB.length - 1], d = e.dir; let p0, p1, p2, T;
    if(e.axis === 'z') { const xl = e.L - d * e.lane, dx = -d; p0 = {x:xl, z:Sx - d * hwc}; p1 = {x:xl, z:Sx + dx * oB}; p2 = {x:e.L + dx * hwA, z:Sx + dx * oB}; T = {axis:'x', dir:dx}; }
    else { const zl = e.L + d * e.lane; p0 = {x:Sx - d * hwc, z:zl}; p1 = {x:Sx - d * oB, z:zl}; p2 = {x:Sx - d * oB, z:e.L + d * hwA}; T = {axis:'z', dir:d}; }
    T.L = Sx; T.lane = oB; T.p0 = p0; T.p1 = p1; T.p2 = p2; T.t = 0; T.len = (2 * (Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z)) + Math.hypot(p2.x - p0.x, p2.z - p0.z)) / 3;
    // yield: do not start the turn while another vehicle is on the arc or about to arrive in the exit lane
    const ev = trVec(T.axis, T.dir), back = {x:p2.x - ev.fx * 11, z:p2.z - ev.fz * 11}, mid = {x:(p1.x + p2.x) / 2, z:(p1.z + p2.z) / 2}; let blocked = false;
    for(const o of TRF.bodies) { if(o.ref === e || o.kind === 'foot' || o.kind === 'ped' || Math.hypot(o.vx_, o.vz_) < 2) continue; for(const q of [p2, mid, back]) if(Math.hypot(o.x - q.x, o.z - q.z) < o.hl * .8 + 2.8) { blocked = true; break; } if(blocked) break; }
    if(blocked && e.turnWait < 3) { e.turnWait = (e.turnWait || 0) + dt; e.v = Math.max(0, e.v - 9 * dt); e.brake = true; aiPlace(e); return; }
    e.turnWait = 0;
    e.turn = T; e.mode = 'turn'; e.intent = 'S'; return;
  }
  aiPlace(e);
  car.steerAngle = THREE.MathUtils.damp(car.steerAngle, 0, 8, dt);
}
function aiRailsVisual(e, dt) {
  const car = e.car, D = car.D || {}; const rot = e.v * dt * (D.wheelR ? 1 / D.wheelR : 2.38); for(const w of car.wheelMeshes) w.rotation.x -= rot;
  for(const pv of car.steerPivots) pv.rotation.y = car.steerAngle;
  const blink = Math.floor(performance.now() / 380) % 2 === 0;
  for(const bl of car.brakeLights) bl.material.color.setHex(e.brake ? 0xff261b : 0x991610);
  if(e.hazard || e.mode === 'wreck') for(const bl of car.brakeLights) bl.material.color.setHex(blink ? 0xffa000 : 0x991610);
  if(car.siren && car.siren.length) { const on = e.siren && Math.floor(performance.now() / 140) % 2 === 0; car.siren[0].material.color.setHex(on ? 0xff2020 : 0x300808); car.siren[1].material.color.setHex(!on && e.siren ? 0x2050ff : 0x08102a); }
  car.chassis.rotation.z = THREE.MathUtils.damp(car.chassis.rotation.z, 0, 8, dt);
}

// ---- hits: AI cars leave their rails and become real physics bodies ----
function aiHit(e, jx, jz, px, pz) {
  const car = e.car, m = car.mass, p = car.root.position;
  if(e.mode === 'lane' || e.mode === 'turn') { e.mode = 'free'; e.rails = false; e.dyn = true; car.kinAI = false; car.coast = .975; car.inp = null; e.freeT = 0; e.hit = true; e.hazard = false; e.brake = false; e.ignoreLights = false; car.safe = null; }
  car.vx += jx / m; car.vz += jz / m; const I = m * (car.halfW*car.halfW + car.halfL*car.halfL) / 3; car.spin = (car.spin || 0) + ((pz - p.z) * jx - (px - p.x) * jz) / I;
}
function pedHit(p, vx, vz) {
  if(p.state === 'down') return; p.state = 'down'; p.down = 0; p.kvx = vx * .85; p.kvz = vz * .85; p.vy = 3.2; p.react = 0; burst?.(.25, 400, .2);
}
function trafficPedCircles() { const out = []; for(const p of TR.peds) if(p.live && p.state !== 'down') out.push({x:p.g.position.x, z:p.g.position.z, r:.35, e:p}); return out; }
// called by physics after car dynamics (dyn/kin are the lists used this frame)
function trafficPhysLists(dyn, kin) {
  for(const e of TR.cars) {
    if(!e.live) continue; const c = e.car, r = Math.hypot(c.halfW, c.halfL);
    if(e.dyn && TRF.auth) { c.kinAI = false; dyn.push({c, r, kin:false, ai:e}); } else { c.kinAI = true; kin.push({c, r, kin:true, ai:e}); }
  }
}
function pedCarContacts(dyn, kin) {
  const Q = {nx:0, nz:0, depth:0, px:0, pz:0}, O = {};
  for(const e of dyn) {
    const c = e.c, sp = Math.hypot(c.vx, c.vz); if(sp < .3) continue; physObb(c.root.position.x, c.root.position.z, c.root.rotation.y, c.halfW, c.halfL, O);
    for(const p of TR.peds) {
      if(!p.live || p.state === 'down') continue; const px = p.g.position.x, pz = p.g.position.z; if(Math.abs(px - O.x) > 8 || Math.abs(pz - O.z) > 8) continue;
      if(!physObbCircle(O, px, pz, .35, Q)) continue;
      if(sp > 2.2) {
        if(TRF.auth) pedHit(p, c.vx, c.vz); else { pedHit(p, c.vx, c.vz); TRF.hitOut.push({k:'p', id:p.id, vx:+c.vx.toFixed(2), vz:+c.vz.toFixed(2)}); }
        if(c === activeCar) wantedAdd(1.1, 'ped');
      } else p.bump = 1;
    }
  }
}
function trafficOnHits(hits) {
  // one collision produces a contact event per physics sub-step: sum them per AI car so the impulse is applied once
  const sum = new Map();
  for(const h of hits) { if(h.k !== 'ai') continue; let m = sum.get(h.e); if(!m) sum.set(h.e, m = {jx:0, jz:0, px:h.px, pz:h.pz, car:h.car}); m.jx += h.jx; m.jz += h.jz; }
  const now = performance.now();
  for(const [e, m] of sum) {
    const jm = Math.hypot(m.jx, m.jz) / e.car.mass; if(jm < 1.2) continue;
    if(m.car === activeCar) { if(TRF.auth) aiHit(e, m.jx, m.jz, m.px, m.pz); else if(now - (e.hitSent || 0) > 500) { e.hitSent = now; TRF.hitOut.push({k:'c', id:e.id, jx:+m.jx.toFixed(1), jz:+m.jz.toFixed(1), px:+m.px.toFixed(2), pz:+m.pz.toFixed(2)}); } }
    else if(TRF.auth && e.mode !== 'free' && m.car.ai) aiHit(e, m.jx, m.jz, m.px, m.pz);
  }
}
function trafficHitIn(pkt) {
  if(!TRF.auth || !pkt) return;
  if(pkt.k === 'p') { const p = TR.peds[pkt.id]; if(p && p.live) pedHit(p, +pkt.vx || 0, +pkt.vz || 0); }
  else if(pkt.k === 'c') { const e = trById.get(pkt.id); if(e && e.live && Number.isFinite(pkt.jx)) aiHit(e, +pkt.jx, +pkt.jz, +pkt.px, +pkt.pz); }
}

// ============================================================================
// PEDESTRIANS
// ============================================================================
function pedPlace(p) {
  const sgn = p.off >= 0 ? 1 : -1, o = p.off + sgn * p.nud;
  p.g.position.x = p.axis === 'z' ? p.L + o : p.s; p.g.position.z = p.axis === 'x' ? p.L + o : p.s;
}
function pedSpawn(p, foci) {
  const f = foci[Math.floor(Math.random() * foci.length)];
  for(let tries = 0; tries < 10; tries++) {
    const axis = Math.random() < .5 ? 'z' : 'x', base = axis === 'z' ? f.x : f.z, along = axis === 'z' ? f.z : f.x;
    const L = 60 * Math.round((base + (Math.random() - .5) * 240) / 60), hw = roadHalfW(L), s = along + (Math.random() - .5) * 340, k = Math.round(s / 60);
    if(Math.abs(s - 60 * k) < roadHalfW(60 * k) + 4) continue;
    p.axis = axis; p.L = L; p.off = (Math.random() < .5 ? -1 : 1) * (hw + 1.6); p.s = s; p.dir = Math.random() < .5 ? 1 : -1; p.nud = 0;
    pedPlace(p); if(Math.hypot(p.g.position.x - f.x, p.g.position.z - f.z) < 45) continue;
    p.v = 1.1 + Math.random() * .45; p.state = 'walk'; p.decK = null; p.react = 0; p.live = true; p.g.visible = true; p.g.rotation.x = 0; p.g.position.y = 0; p.wait = 0; p.sp = 0; return true;
  }
  return false;
}
function pedStep(p, dt) {
  if(p.state === 'down') {
    p.down += dt; p.g.position.x += p.kvx * dt; p.g.position.z += p.kvz * dt; p.kvx *= Math.pow(.05, dt); p.kvz *= Math.pow(.05, dt);
    p.vy -= 12 * dt; p.g.position.y = Math.max(.12, p.g.position.y + p.vy * dt); p.g.rotation.x = THREE.MathUtils.damp(p.g.rotation.x, -Math.PI / 2, 9, dt);
    if(p.down > 5) p.live = false; p.sp = 0; return;
  }
  const fx = p.axis === 'x' ? p.dir : 0, fz = p.axis === 'z' ? p.dir : 0, k = nextK(p.s, p.dir), Sx = 60 * k, hwc = roadHalfW(Sx), dc = (Sx - p.s) * p.dir - hwc;
  let speed = p.v;
  // crosswalk logic
  if(p.state !== 'cross' && dc < 1.1 && dc > -.3) {
    const a = p.axis === 'z' ? p.L / 60 : k, b = p.axis === 'z' ? k : p.L / 60; sigState(a, b, TT.T, sgAI);
    const green = p.axis === 'z' ? sgAI.z === 'G' && sgAI.zRem > hwc * 2 / 1.55 + .8 : sgAI.x === 'G' && sgAI.xRem > hwc * 2 / 1.55 + .8;
    if(p.decK !== k) { p.decK = k; p.turnIntent = Math.random() < .3; }
    if(p.turnIntent) { // turn the corner onto the cross road's sidewalk
      const side = p.off >= 0 ? 1 : -1, wasAxis = p.axis, wx = p.g.position.x, wz = p.g.position.z;
      p.axis = wasAxis === 'z' ? 'x' : 'z'; p.L = Sx; p.s = wasAxis === 'z' ? wx : wz; p.off = (wasAxis === 'z' ? (wz - Sx) : (wx - Sx)); p.off = (p.off >= 0 ? 1 : -1) * (roadHalfW(Sx) + 1.6); p.dir = Math.random() < .5 ? 1 : -1; p.decK = null; p.nud = 0; p.state = 'walk'; return;
    }
    let carNear = false; const cxw = p.axis === 'z' ? p.L + p.off : Sx, czw = p.axis === 'z' ? Sx : p.L + p.off;
    if(green) for(const o of TRF.bodies) if((o.kind === 'car' || o.kind === 'ai') && Math.hypot(o.x - cxw, o.z - czw) < 7 && Math.hypot(o.vx_, o.vz_) > 3) { carNear = true; break; }
    if(green && !carNear) { p.state = 'cross'; p.crossK = k; p.crossHw = hwc; } else { p.state = 'wait'; speed = 0; }
  }
  if(p.state === 'cross') { speed = 1.55; if((p.s - 60 * p.crossK) * p.dir > p.crossHw + .5) { p.state = 'walk'; p.decK = null; } }
  // other people / players ahead: slow, step towards the buildings
  const rx = -fz, rz = fx; let blocked = false;
  for(const o of TRF.bodies) {
    if(o.ref === p || (o.kind !== 'ped' && o.kind !== 'foot')) continue; const dx = o.x - p.g.position.x, dz = o.z - p.g.position.z, al = dx*fx + dz*fz; if(al < 0 || al > 1.5) continue;
    if(Math.abs(dx*rx + dz*rz) < .75) { blocked = true; break; }
  }
  if(blocked && p.state !== 'cross') { speed *= .25; p.nud = Math.min(1.3, p.nud + dt * 2.2); } else if(p.state !== 'cross') p.nud = Math.max(0, p.nud - dt * .8);
  // reactions: a fast car close by, or you bumped into them
  if(p.react <= 0) for(const o of TRF.bodies) { if(o.kind !== 'car' && o.kind !== 'ai') continue; const dx = o.x - p.g.position.x, dz = o.z - p.g.position.z; if(Math.abs(dx) > 3.5 || Math.abs(dz) > 3.5) continue;
    if(Math.hypot(o.vx_, o.vz_) > 5 && Math.hypot(dx, dz) < 3.4 && p.state !== 'cross') { p.react = .9; break; } }
  if(p.bump) { p.react = Math.max(p.react, .5); p.bump = 0; }
  if(p.react > 0) { p.react -= dt; p.nud = Math.min(1.45, p.nud + dt * 6); speed = Math.max(speed, 1.9); if(p.state === 'wait') p.state = 'walk'; }
  p.sp = speed; p.s += p.dir * speed * dt; pedPlace(p);
  p.g.position.y = p.react > 0 ? Math.abs(Math.sin(p.react * 10)) * .35 : Math.abs(Math.sin(performance.now() / 160 + p.s)) * .05 * (speed > 0 ? 1 : 0);
  p.g.rotation.y = Math.atan2(-fx, -fz);
}
function pedAnimate(p, dt) {
  if(p.state === 'down') { p.lL.rotation.x = p.lR.rotation.x = p.aL.rotation.x = p.aR.rotation.x = 0; return; }
  const sp = p.sp; p.ph += sp * dt * 4.5; const sw = Math.sin(p.ph) * .55 * Math.min(1, sp / 1.2);
  p.lL.rotation.x = sw; p.lR.rotation.x = -sw; p.aL.rotation.x = -sw * .8; p.aR.rotation.x = sw * .8;
  if(p.react > 0) { p.aL.rotation.z = -1.4; p.aR.rotation.z = 1.4; } else { p.aL.rotation.z = THREE.MathUtils.damp(p.aL.rotation.z, 0, 10, dt); p.aR.rotation.z = THREE.MathUtils.damp(p.aR.rotation.z, 0, 10, dt); }
}
// Honking makes pedestrians ahead of the car jump back
function pedHonk(x, z, fx, fz) { for(const p of TR.peds) { if(!p.live || p.state === 'down') continue; const dx = p.g.position.x - x, dz = p.g.position.z - z, d = Math.hypot(dx, dz); if(d < 24 && d > .5 && (dx*fx + dz*fz) / d > .55) p.react = 1.2; } }
addEventListener('keydown', e => {
  if(!running || chatOpen || e.repeat || e.target.tagName === 'INPUT' || !inCar || !activeCar) return;
  if(e.key === 'h' || e.key === 'H') { const c = activeCar, a = c.root.rotation.y; TRF.honkSeq++; if(TRF.auth) pedHonk(c.root.position.x, c.root.position.z, -Math.sin(a), -Math.cos(a)); }
});

// ============================================================================
// POLICE + WANTED LEVEL
// ============================================================================
const WANT = {heat:0, lvl:0, bust:0, light:0, inBox:false, tNear:99, lastHitT:0};
const wantedEl = document.createElement('div'); wantedEl.style.cssText = 'position:fixed;top:300px;right:16px;z-index:12;pointer-events:none;font:800 20px Inter,Arial,sans-serif;letter-spacing:.1em;text-shadow:0 2px 6px #000;display:none;text-align:right'; document.body.appendChild(wantedEl);
function wantedAdd(x, why) { if(!S.police) return; WANT.heat = Math.min(5.6, WANT.heat + x); }
function wantedOnHits(hits) {
  const now = performance.now();
  if(S.police && now - WANT.lastHitT > 1000) {
    for(const h of hits) {
      let add = 0;
      if(h.k === 'ai' && h.car === activeCar && h.v > 5) add = (h.e.chase || h.e.type === 'POLICE') ? 1.0 : .45;
      else if(h.k === 'car' && (h.car === activeCar || h.other === activeCar) && h.v > 5) { const o = h.car === activeCar ? h.other : h.car; add = (o.ai && (o.ai.chase || o.ai.type === 'POLICE')) ? 1.0 : .4; }
      if(add) { WANT.heat = Math.min(5.6, WANT.heat + add); WANT.lastHitT = now; break; }   // one crash = one charge
    }
  }
  trafficOnHits(hits);
}
function wantedTick(dt) {
  if(!S.police) { WANT.heat = 0; }
  const me = (inCar && activeCar) ? activeCar.root.position : player.position, sp = (inCar && activeCar) ? Math.hypot(activeCar.vx, activeCar.vz) : 0;
  // running a red light
  if(inCar && activeCar && S.police) {
    const a = Math.round(me.x / 60), b = Math.round(me.z / 60), inBox = Math.abs(me.x - 60 * a) < roadHalfW(60 * a) && Math.abs(me.z - 60 * b) < roadHalfW(60 * b);
    WANT.light -= dt;
    if(inBox && !WANT.inBox && sp > 6 && WANT.light <= 0) { const ang = activeCar.root.rotation.y, axis = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? 'z' : 'x'; sigState(a, b, TT.T, sgAI); if((axis === 'z' ? sgAI.z : sgAI.x) === 'R') { WANT.heat = Math.min(5.6, WANT.heat + .34); WANT.light = 4; toast('Ran a red light'); } }
    WANT.inBox = inBox;
  }
  let near = 99, nearPolice = null;
  for(const e of TR.cars) if(e.live && (e.chase || e.type === 'POLICE')) { const d = Math.hypot(e.car.root.position.x - me.x, e.car.root.position.z - me.z); if(e.chase && d < near) { near = d; nearPolice = e; } }
  WANT.tNear = near;
  if(WANT.heat > 0) WANT.heat = Math.max(0, WANT.heat - dt * (near < 90 ? .006 : .05));
  const lvl = Math.min(5, Math.floor(WANT.heat + .3)); if(lvl !== WANT.lvl) { toast(lvl > WANT.lvl ? 'Wanted level ' + lvl + (WANT.lvl === 0 ? ' - police are after you!' : '') : (lvl === 0 ? 'You lost the police' : 'Wanted level ' + lvl)); WANT.lvl = lvl; }
  if(WANT.lvl > 0 && nearPolice && near < 7 && sp < 3) WANT.bust += dt; else WANT.bust = Math.max(0, WANT.bust - dt * 2);
  if(WANT.bust > 2.5) { WANT.heat = 0; WANT.lvl = 0; WANT.bust = 0; toast('BUSTED! You are back at the city centre'); for(const e of TR.cars) if(e.chase) { e.live = false; e.car.root.visible = false; } resetPosition(); }
  const blink = near < 90 && Math.floor(performance.now() / 300) % 2 === 0;
  wantedEl.style.display = WANT.lvl > 0 ? 'block' : 'none';
  if(WANT.lvl > 0) wantedEl.innerHTML = '<span style="color:' + (blink ? '#ff5a5a' : '#ffd166') + '">' + '★'.repeat(WANT.lvl) + '<span style="opacity:.3">' + '★'.repeat(5 - WANT.lvl) + '</span></span><div style="font-size:10px;color:#cfe;letter-spacing:.12em;margin-top:2px">' + (near < 90 ? 'POLICE PURSUIT' : 'LOSE THEM TO CLEAR') + (WANT.bust > .3 ? ' · BUSTED ' + Math.round(WANT.bust / 2.5 * 100) + '%' : '') + '</div>';
}
function trTarget(info) { // info = {x,z,w,id} from foci
  return info;
}
function policeThink(e, dt, tgt) {
  const car = e.car, p = car.root.position, a = car.root.rotation.y, fx = -Math.sin(a), fz = -Math.cos(a), dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz), fs = car.vx * fx + car.vz * fz;
  let ax = tgt.x, az = tgt.z;
  // line of sight: if a building is in the way, follow the road grid toward the target instead
  let clear = true; if(dist > 12) { physGather((p.x + tgt.x) / 2, (p.z + tgt.z) / 2, dist / 2 + 4, PG.boxes, PG.cyls); for(const b of PG.boxes) { if(b.maxY < 3 || b.minY > 3) continue; if(segBox(p.x, p.z, tgt.x, tgt.z, b)) { clear = false; break; } } }
  if(!clear) {
    const ia = Math.round(p.x / 60), ib = Math.round(p.z / 60), ix = ia * 60, iz = ib * 60, dI = Math.hypot(ix - p.x, iz - p.z);
    if(e.pAxis === undefined || (dI < 14 && e.pK !== ia + ',' + ib)) { // re-plan at each intersection: move along the bigger delta first
      e.pK = ia + ',' + ib; const tx = tgt.x - ix, tz = tgt.z - iz; if(Math.abs(tx) > Math.abs(tz)) { e.pAxis = 'x'; e.pDir = Math.sign(tx) || 1; } else { e.pAxis = 'z'; e.pDir = Math.sign(tz) || 1; } }
    if(e.pAxis === 'x') { ax = ix + e.pDir * 60; az = iz; } else { ax = ix; az = iz + e.pDir * 60; }
    if(Math.hypot(ax - p.x, az - p.z) > 70) { ax = e.pAxis === 'x' ? p.x + e.pDir * 40 : ix; az = e.pAxis === 'z' ? p.z + e.pDir * 40 : iz; }
  } else e.pAxis = undefined;
  const ang = Math.atan2(-(ax - p.x), -(az - p.z)); let da = wrapAng(ang - a);
  let thr = 0, st = THREE.MathUtils.clamp(da * 2.4, -1, 1);
  const vmax = 17 + 3.2 * Math.min(5, tgt.w || 1), vd = dist < 10 ? Math.max(4, tgt.speed || 6) : vmax * (1 - Math.min(.7, Math.abs(da) * .7));
  thr = THREE.MathUtils.clamp((vd - fs) * .5, -1, 1);
  if(e.rev > 0) { e.rev -= dt; thr = -1; st = -st; car.reverseOk = true; } else { car.reverseOk = false; if(thr < 0 && fs < .5) thr = 0; }
  e.stuckT = (Math.abs(fs) < 1.2 && dist > 9) ? e.stuckT + dt : 0; if(e.stuckT > 1.6) { e.rev = 1.1; e.stuckT = 0; e.stuck2 = (e.stuck2 || 0) + 1; }
  if(e.stuck2 > 5) { e.stuck2 = 0; e.live = false; car.root.visible = false; return; }
  if(da > 2.2 || da < -2.2) st = da > 0 ? 1 : -1;
  car.inp = {thr, st, hb:false};
}
function segBox(x0, z0, x1, z1, b) { // segment vs AABB (slab test)
  let t0 = 0, t1 = 1; const d = [x1 - x0, z1 - z0], lo = [b.minX - x0, b.minZ - z0], hi = [b.maxX - x0, b.maxZ - z0];
  for(let i = 0; i < 2; i++) { if(Math.abs(d[i]) < 1e-9) { if(lo[i] > 0 || hi[i] < 0) return false; } else { let a = lo[i] / d[i], c = hi[i] / d[i]; if(a > c) { const t = a; a = c; c = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if(t0 > t1) return false; } }
  return true;
}
function policeSpawn(e, tgt) {
  for(let tries = 0; tries < 14; tries++) {
    const axis = Math.random() < .5 ? 'z' : 'x', base = axis === 'z' ? tgt.x : tgt.z, along = axis === 'z' ? tgt.z : tgt.x, L = 60 * Math.round((base + (Math.random() - .5) * 120) / 60);
    const s = along + (Math.random() < .5 ? -1 : 1) * (100 + Math.random() * 60), k = Math.round(s / 60); if(Math.abs(s - 60 * k) < roadHalfW(60 * k) + 10) continue;
    const dir = s > along ? -1 : 1, lane = trLanes(roadHalfW(L))[0], v = trVec(axis, dir), x = axis === 'z' ? L + v.rx * lane : s, z = axis === 'x' ? L + v.rz * lane : s;
    if(!trClear(x, z, 12)) continue;
    const c = e.car; c.root.position.set(x, 0, z); c.root.rotation.y = Math.atan2(-v.fx, -v.fz); c.vx = c.vz = 0; c.spin = 0; c.angularVel = 0; c.steerAngle = 0; c.safe = null; c.kinAI = false; c.coast = .985;
    e.live = true; e.mode = 'free'; e.rails = false; e.dyn = true; e.siren = true; e.stuckT = 0; e.pAxis = undefined; e.rev = 0; e.stuck2 = 0; c.root.visible = true; return true;
  }
  return false;
}

// ============================================================================
// MAIN TICK
// ============================================================================
function trafficAuth() { return typeof mpStarted === 'undefined' || !mpStarted || mpIsHost || !mpConnected; }
function trafficTick(dt) {
  const auth = TRF.auth = trafficAuth(), foci = trFoci(), me = foci[0], now = performance.now();
  if(auth && !TRF.wasAuth) { for(const e of TR.cars) if(e.live && !e.dyn && e.mode !== 'free' && e.mode !== 'wreck') aiSnap(e); for(const p of TR.peds) if(p.live && p.state !== 'down') { p.axis = Math.abs(p.g.rotation.y % Math.PI) < .7 || Math.abs(Math.abs(p.g.rotation.y) - Math.PI) < .7 ? 'z' : 'x'; p.L = 60 * Math.round((p.axis === 'z' ? p.g.position.x : p.g.position.z) / 60); p.off = (p.axis === 'z' ? p.g.position.x : p.g.position.z) - p.L; p.s = p.axis === 'z' ? p.g.position.z : p.g.position.x; p.dir = Math.cos(p.g.rotation.y) < 0 ? 1 : -1; if(p.axis === 'x') p.dir = Math.sin(p.g.rotation.y) < 0 ? 1 : -1; p.nud = 0; p.decK = null; p.state = 'walk'; } }
  TRF.wasAuth = auth;
  trBuildBodies();
  const visR = visRadius();
  if(auth) {
    TT.T += dt;
    // wanted -> police assignment
    const want = []; if(S.police && WANT.lvl > 0) want.push({x:me.x, z:me.z, w:WANT.lvl, id:'me', speed:(inCar && activeCar) ? Math.hypot(activeCar.vx, activeCar.vz) : 0});
    for(const f of foci) if(f.id !== 'me' && f.w > 0) want.push({x:f.x, z:f.z, w:f.w, id:f.id, speed:0});
    let slots = 0; const asg = [];
    for(const w of want) { const n = [0, 1, 2, 2, 3, 4][Math.min(5, w.w)]; for(let i = 0; i < n && slots < 4; i++, slots++) asg.push(w); }
    TR.cars.filter(e => e.chase).forEach((e, i) => {
      const tgt = asg[i];
      if(!tgt) { if(e.live) { e.live = false; e.siren = false; e.car.root.visible = false; e.dyn = false; } return; }
      if(!e.live) { if(Math.random() < .1) policeSpawn(e, tgt); return; }
      e.tgtSpeed = tgt.speed; policeThink(e, dt, tgt);
    });
    TRF.spawnCool -= dt;
    for(const e of TR.cars) {
      if(e.chase) continue;
      if(e.live) {
        const p = e.car.root.position; let dMin = 1e9; for(const f of foci) dMin = Math.min(dMin, Math.hypot(p.x - f.x, p.z - f.z));
        if(e.mode === 'free') { const sp = Math.hypot(e.car.vx, e.car.vz); e.freeT += dt; if(sp < .5 && e.freeT > 2.5) { e.mode = 'wreck'; e.hazard = true; e.freeT = 0; } }
        else if(e.mode === 'wreck') { e.freeT += dt; if(Math.hypot(e.car.vx, e.car.vz) > 1) { e.mode = 'free'; e.hazard = false; } else if(e.freeT > 30 && dMin > 45) e.live = false; else if(e.freeT > 75) e.live = false; }
        else if(e.stuckT > 75) e.live = false;
        if(dMin > 280) e.live = false;
        if(!e.live) { e.car.root.visible = false; e.dyn = false; continue; }
        if(e.rails) aiRails(e, dt);
      } else if(TRF.spawnCool <= 0) { aiSpawn(e, foci); TRF.spawnCool = .25; }
    }
    for(const p of TR.peds) {
      if(p.live) { let dMin = 1e9; for(const f of foci) dMin = Math.min(dMin, Math.hypot(p.g.position.x - f.x, p.g.position.z - f.z)); if(dMin > 270) p.live = false; else pedStep(p, dt); if(!p.live) p.g.visible = false; }
      else if(Math.random() < .08) pedSpawn(p, foci);
    }
    for(const f of foci) if(f.id !== 'me' && f.st) { const seq = f.st.hn | 0, last = TRF.remoteHonk.get(f.id); if(last !== undefined && seq !== last && f.st.carIndex >= 0 && cars[f.st.carIndex]) { const c = cars[f.st.carIndex], a = c.root.rotation.y; pedHonk(c.root.position.x, c.root.position.z, -Math.sin(a), -Math.cos(a)); } TRF.remoteHonk.set(f.id, seq); }
    if(now - TRF.lastPack > 100 && typeof mpIsHost !== 'undefined' && mpIsHost && mpStarted) { TRF.lastPack = now; mpBroadcast(trafficPack()); }
  } else {
    // client: interpolate the host's entities
    const k = 1 - Math.exp(-dt * 12);
    for(const e of TR.cars) {
      if(!e.live) continue; if(now - e.seen > 1800) { e.live = false; e.car.root.visible = false; continue; }
      const age = Math.min(.3, (now - e.trecv) / 1000), c = e.car, p = c.root.position;
      p.x += (e.tx + e.tvx * age - p.x) * k; p.z += (e.tz + e.tvz * age - p.z) * k; c.root.rotation.y += wrapAng(e.try - c.root.rotation.y) * k; c.vx = e.tvx; c.vz = e.tvz;
      e.v = Math.hypot(e.tvx, e.tvz); e.brake = !!(e.tf & 2); e.hazard = !!(e.tf & 4); e.siren = !!(e.tf & 8); e.mode = (e.tf & 1) ? 'free' : 'lane'; e.rails = false;
    }
    for(const p of TR.peds) {
      if(!p.live) continue; if(now - p.seen > 1800) { p.live = false; p.g.visible = false; continue; }
      const age = Math.min(.3, (now - p.trecv) / 1000), g = p.g.position, ox = g.x, oz = g.z;
      g.x += (p.tx - g.x) * k; g.z += (p.tz - g.z) * k; if(p.state !== 'down') { p.g.rotation.y += wrapAng(p.try - p.g.rotation.y) * k; p.g.rotation.x = 0; }
      p.sp = Math.min(2.2, Math.hypot(g.x - ox, g.z - oz) / Math.max(dt, .001));
      if(p.state === 'down') { p.g.rotation.x = THREE.MathUtils.damp(p.g.rotation.x, -Math.PI / 2, 9, dt); g.y = .12; } else g.y = p.react > 0 ? Math.abs(Math.sin(now / 90)) * .3 : 0;
      if(p.react > 0) p.react -= dt;
    }
  }
  // ---- shared per-frame visuals ----
  for(const e of TR.cars) {
    if(!e.live) { if(e.car.root.visible) e.car.root.visible = false; continue; }
    const p = e.car.root.position, d = Math.hypot(p.x - me.x, p.z - me.z); e.car.root.visible = d < visR;
    if(e.rails || e.mode === 'turn') aiRailsVisual(e, dt);
    else if(e.siren || e.hazard || e.mode === 'wreck') { aiRailsVisual(e, 0); }
    e.car.isBraking = e.brake;
  }
  for(const p of TR.peds) { if(!p.live) { p.g.visible = false; continue; } const d = Math.hypot(p.g.position.x - me.x, p.g.position.z - me.z); p.g.visible = d < visR; if(p.g.visible) pedAnimate(p, dt); }
  wantedTick(dt); sigVisualUpdate(); policeAudio();
}
function policeAudio() {
  if(!A.ctx) return;
  if(!A.sir) { const c = A.ctx; A.sir = c.createOscillator(); A.sir.type = 'sawtooth'; A.sirG = c.createGain(); A.sirG.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; A.sir.connect(lp); lp.connect(A.sirG); A.sirG.connect(A.master); A.sir.start(); }
  let near = 1e9; const me = (inCar && activeCar) ? activeCar.root.position : player.position;
  for(const e of TR.cars) if(e.live && e.siren) near = Math.min(near, Math.hypot(e.car.root.position.x - me.x, e.car.root.position.z - me.z));
  const t = A.ctx.currentTime; A.sirG.gain.setTargetAtTime(near < 160 ? .035 * (1 - near / 160) : 0, t, .1); A.sir.frequency.setTargetAtTime(700 + 350 * Math.sin(t * 5), t, .02);
}

// ============================================================================
// NETWORK: pack / apply
// ============================================================================
function trafficPack() {
  const r2 = v => Math.round(v * 100) / 100, c = [], p = [];
  for(const e of TR.cars) if(e.live) { const q = e.car.root.position; c.push([e.id, r2(q.x), r2(q.z), r2(e.car.root.rotation.y), r2(e.car.vx), r2(e.car.vz), (e.mode === 'free' || e.mode === 'wreck' ? 1 : 0) | (e.brake ? 2 : 0) | (e.hazard || e.mode === 'wreck' ? 4 : 0) | (e.siren ? 8 : 0)]); }
  for(const q of TR.peds) if(q.live) p.push([q.id, r2(q.g.position.x), r2(q.g.position.z), r2(q.g.rotation.y), q.state === 'down' ? 3 : q.react > 0 ? 4 : 0]);
  return {type:'TRAFFIC', T:r2(TT.T), c, p, at:Date.now()};
}
function trafficApply(pkt) {
  if(!pkt || TRF.auth) return; const now = performance.now();
  if(Number.isFinite(pkt.T)) TT.T += (pkt.T - TT.T) * (Math.abs(pkt.T - TT.T) > 2 ? 1 : .2);
  if(Array.isArray(pkt.c)) for(const a of pkt.c) {
    const e = trById.get(a[0]); if(!e) continue;
    if(!e.live) { e.car.root.position.set(a[1], 0, a[2]); e.car.root.rotation.y = a[3]; e.live = true; e.car.kinAI = true; }
    e.tx = a[1]; e.tz = a[2]; e.try = a[3]; e.tvx = a[4]; e.tvz = a[5]; e.tf = a[6]; e.trecv = now; e.seen = now;
  }
  if(Array.isArray(pkt.p)) for(const a of pkt.p) {
    const p = TR.peds[a[0]]; if(!p) continue;
    if(!p.live) { p.g.position.set(a[1], 0, a[2]); p.g.rotation.y = a[3]; p.live = true; p.g.visible = true; }
    p.tx = a[1]; p.tz = a[2]; p.try = a[3]; p.react = a[4] === 4 ? .3 : 0; if(a[4] === 3 && p.state !== 'down') { p.state = 'down'; } else if(a[4] !== 3 && p.state === 'down') { p.state = 'walk'; p.g.rotation.x = 0; } p.trecv = now; p.seen = now;
  }
}
