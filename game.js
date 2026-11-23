'use strict';
// game.js - Input, camera, vehicle entry/exit, collisions, player/vehicle update, HUD and radar
// ============================================================================
// INPUT, CAMERA & VEHICLE ENTRY/EXIT
// ============================================================================
const keys = {};
let yaw = 0, pitch = -0.12, cameraMode = 2, onGround = true, verticalVelocity = 0, inCar = false;
let mouseLocked = false, running = false, clock = new THREE.Clock();
const playerRadius = 0.48;
const PL = {kt:0, kvx:0, kvz:0, stuck:0};

function onKey(e, down) {
  const k = e.key.toLowerCase();
  if(chatOpen) {
    if(down && k === 'escape') { e.preventDefault(); closeChat(); }
    return;
  }
  if(down && !e.repeat && k === 't' && running) {
    e.preventDefault();
    openChat();
    return;
  }
  keys[k] = down;
  if([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if(down && !e.repeat) {
    if(k === 'v') { cameraMode = cameraMode === 2 ? 1 : cameraMode === 1 ? 3 : 2; toast(cameraMode === 1 ? 'Cockpit camera' : cameraMode === 3 ? 'Hood camera' : 'Third-person camera'); }
    if(k === 'e') toggleCar();
    if(k === 'r') resetPosition();
    if(k === ' ' && !inCar && onGround) { verticalVelocity = 7.4; onGround = false; }
  }
}
addEventListener('keydown', e => onKey(e, true));
addEventListener('keyup', e => onKey(e, false));
addEventListener('blur', () => { for(const k in keys) keys[k] = false; });
// Pointer lock can reject (e.g. right after pressing Esc); that is harmless, so never let it surface as an error
let lastLockTry = 0;
function lockPointer() {
  const now = performance.now(); if(now - lastLockTry < 1400) return; lastLockTry = now;
  try { const p = renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock(); if(p && p.catch) p.catch(() => {}); } catch(e) {}
}
renderer.domElement.addEventListener('click', () => { if(running && !mouseLocked) lockPointer(); });
document.addEventListener('pointerlockchange', () => { mouseLocked = document.pointerLockElement === renderer.domElement; });
document.addEventListener('mousemove', e => {
  if(mouseLocked) {
    yaw -= e.movementX * 0.0025;
    pitch -= e.movementY * 0.002;
    pitch = THREE.MathUtils.clamp(pitch, -0.85, 0.35);
  }
});

function toggleCar() {
  if(inCar) {
    activeCar.headlights.forEach(hl => hl.intensity = 0);
    const spot = physExitSpot(activeCar);
    player.position.set(spot.x, 0.16, spot.z);
    PL.kt = 0; PL.stuck = 0;
    const exitedIndex = cars.indexOf(activeCar);
    inCar = false; activeCar = null; player.visible = true;
    mpSetCarOwner(exitedIndex, null);
    toast('Exited vehicle');
  } else {
    let nearest = null, dist = 5.5;
    for(const c of cars) {
      const d = Math.hypot(c.root.position.x - player.position.x, c.root.position.z - player.position.z);
      if(d < dist) { nearest = c; dist = d; }
    }
    if(nearest) {
      const nearestIndex = cars.indexOf(nearest);
      const currentOwner = mpCarOwners.get(nearestIndex);
      if(mpStarted && currentOwner && currentOwner !== mpLocalPeerId) {
        toast('That vehicle is currently being driven by another player');
        return;
      }
      activeCar = nearest; inCar = true; player.visible = false;
      if(mpStarted) mpSetCarOwner(nearestIndex, mpLocalPeerId);
      if(!isDayMode) activeCar.headlights.forEach(hl => hl.intensity = 5.4);
      yaw = nearest.root.rotation.y;
      toast('Vehicle entered · Hold SPACE while turning to drift');
    } else {
      toast('Move closer to a vehicle to enter it');
    }
  }
}

function resetPosition() {
  if(inCar && activeCar) {
    const rc = physFindCarSpot(activeCar, 2.2, 14.0, 0);
    activeCar.root.position.set(rc.x, 0, rc.z);
    activeCar.root.rotation.set(0, 0, 0);
    activeCar.vx = 0; activeCar.vz = 0; activeCar.angularVel = 0; activeCar.spin = 0; activeCar.steerAngle = 0; activeCar.safe = null; mpNoteTeleport();
  }
  if(activeCar) mpSetCarOwner(cars.indexOf(activeCar), null);
  inCar = false; activeCar = null; player.visible = true;
  { const fs = physFindFreeSpot(6.2, 12.0, playerRadius + .1, 14); player.position.set(fs.x, 0.16, fs.z); }
  PL.kt = 0; PL.stuck = 0; mpNoteTeleport?.();
  verticalVelocity = 0; yaw = 0;
  updateChunkStreaming(player.position.x, player.position.z, true);
  toast('Position reset to Metropolis Center');
}

// Collision physics (SAT contacts, impulses, sub-stepping, safe-pose recovery) now lives in physics.js

// ============================================================================
// PLAYER, VEHICLE & CAMERA UPDATE LOOPS
// ============================================================================
function updatePlayer(dt) {
  if(inCar) return;
  // The crouch is an articulated squat: hips/knees bend and the upper body leans forward.
  playerModel.scale.y = 1;
  let forward = (keys.w||keys.arrowup?1:0) - (keys.s||keys.arrowdown?1:0);
  let side = (keys.d||keys.arrowright?1:0) - (keys.a||keys.arrowleft?1:0);
  const len = Math.hypot(forward, side);
  if(len > 0) { forward /= len; side /= len; }
  const speed = keys.shift ? 2.65 : 5.8;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);

  let dx = (fx * forward + rx * side) * speed * dt * (PL.kt > 0 ? .25 : 1);
  let dz = (fz * forward + rz * side) * speed * dt * (PL.kt > 0 ? .25 : 1);
  if(PL.kt > 0) { dx += PL.kvx * dt; dz += PL.kvz * dt; PL.kt -= dt; PL.kvx *= Math.pow(.02, dt); PL.kvz *= Math.pow(.02, dt); }
  // sub-stepped movement: never more than 0.2 m per step, so thin walls and posts cannot be skipped
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .2));
  let hitCar = null, lastRes = null;
  for(let i = 0; i < steps; i++) {
    const res = resolveCircleWorld(player.position.x + dx / steps, player.position.z + dz / steps, playerRadius, {peds:true});
    player.position.x = res.x; player.position.z = res.z; lastRes = res; if(res.car) hitCar = res.car;
  }
  if(hitCar) { const sp = Math.hypot(hitCar.vx, hitCar.vz); if(sp > 3.5 && PL.kt <= 0) { PL.kt = .5; PL.kvx = hitCar.vx * .7; PL.kvz = hitCar.vz * .7; } }
  // trapped in geometry (e.g. a car parked on top of the player)? find the nearest free spot
  if(lastRes && lastRes.pen > .25) { if(++PL.stuck > 6) { const fs = physFindFreeSpot(player.position.x, player.position.z, playerRadius + .05, 12); player.position.x = fs.x; player.position.z = fs.z; PL.stuck = 0; } } else PL.stuck = 0;
  verticalVelocity -= 19.5 * dt;
  player.position.y += verticalVelocity * dt;
  if(player.position.y <= 0) { player.position.y = 0; verticalVelocity = 0; onGround = true; }

  if(len > 0.05) {
    const moveX = fx * forward + rx * side, moveZ = fz * forward + rz * side;
    player.rotation.y = Math.atan2(-moveX, -moveZ);
    const t = performance.now() * 0.010, stride = Math.min(1, len) * (keys.shift ? 0.55 : 1);
    const swing = Math.sin(t) * 0.62 * stride;
    characterRig.legPivots[0].rotation.x = swing;
    characterRig.legPivots[1].rotation.x = -swing;
    characterRig.kneePivots[0].rotation.x = Math.max(0, -Math.sin(t)) * 0.55 * stride;
    characterRig.kneePivots[1].rotation.x = Math.max(0,  Math.sin(t)) * 0.55 * stride;
    characterRig.armPivots[0].rotation.x = -swing * 0.62;
    characterRig.armPivots[1].rotation.x =  swing * 0.62;
    characterRig.forearmPivots[0].rotation.x = -0.12 + Math.max(0,  Math.sin(t)) * 0.16 * stride;
    characterRig.forearmPivots[1].rotation.x = -0.12 + Math.max(0, -Math.sin(t)) * 0.16 * stride;
  } else {
    player.rotation.y = THREE.MathUtils.damp(player.rotation.y, yaw, 8, dt);
    for(const limb of characterRig.legPivots) limb.rotation.x = THREE.MathUtils.damp(limb.rotation.x, 0, 12, dt);
    for(const limb of characterRig.kneePivots) limb.rotation.x = THREE.MathUtils.damp(limb.rotation.x, 0, 12, dt);
    for(const limb of characterRig.armPivots) limb.rotation.x = THREE.MathUtils.damp(limb.rotation.x, 0, 12, dt);
    for(const limb of characterRig.forearmPivots) limb.rotation.x = THREE.MathUtils.damp(limb.rotation.x, 0, 12, dt);
  }
  const crouch = !!keys.shift;
  upperBodyPivot.position.y = THREE.MathUtils.damp(upperBodyPivot.position.y, crouch ? .68 : .88, 15, dt);
  upperBodyPivot.rotation.x = THREE.MathUtils.damp(upperBodyPivot.rotation.x, crouch ? -.22 : 0, 15, dt);
  for(let i=0;i<2;i++) {
    characterRig.legPivots[i].rotation.x = THREE.MathUtils.damp(characterRig.legPivots[i].rotation.x, crouch ? -.48 : 0, 15, dt);
    characterRig.kneePivots[i].rotation.x = THREE.MathUtils.damp(characterRig.kneePivots[i].rotation.x, crouch ? 1.18 : 0, 15, dt);
    characterRig.armPivots[i].rotation.x = THREE.MathUtils.damp(characterRig.armPivots[i].rotation.x, crouch ? .30 : 0, 15, dt);
    characterRig.forearmPivots[i].rotation.x = THREE.MathUtils.damp(characterRig.forearmPivots[i].rotation.x, crouch ? -.12 : 0, 15, dt);
  }
  if(typeof avatarLocalAnim === 'function') avatarLocalAnim(dt, len, crouch);
}

// updateCars(dt) lives in physics.js

function updateCameraAndEnvironment(dt) {
  if(typeof avatarApplyVisibility === 'function') avatarApplyVisibility(!inCar && cameraMode !== 1); else playerModel.visible = !inCar && cameraMode !== 1;
  const focusPos = (inCar && activeCar) ? activeCar.root.position : player.position;

  // Keep directional sun shadow frustum and sky dome centered on the active player/car
  sun.position.set(focusPos.x + fxSun.x*220, fxSun.y*220, focusPos.z + fxSun.z*220);
  sun.target.position.set(focusPos.x, 0, focusPos.z);
  sun.target.updateMatrixWorld();
  sky.position.copy(focusPos);
  starField.position.copy(focusPos);
  sunDisc.position.set(focusPos.x + fxSunRaw.x*520, fxSunRaw.y*520, focusPos.z + fxSunRaw.z*520);

  let target, desired;
  if(inCar && activeCar) {
    const p = activeCar.root.position, a = activeCar.root.rotation.y;
    const speed = Math.hypot(activeCar.vx, activeCar.vz);
    camera.fov = THREE.MathUtils.damp(camera.fov, fxFov + Math.min(14, speed * 0.35), 6, dt);
    camera.updateProjectionMatrix();

    target = new THREE.Vector3(p.x, 1.5, p.z);
    if(cameraMode === 1 || cameraMode === 3) {
      const D0 = activeCar.D, hood = cameraMode === 3;
      const seatOffset = (hood ? new THREE.Vector3(0, D0 ? D0.belt + .1 : 1.1, D0 ? -D0.L * .3 : -1.3) : new THREE.Vector3(0.43, D0 ? Math.min(D0.belt + .4, (D0.roof ? D0.roof[2] : 3) - .14) : 1.46, D0 ? -D0.seats[0] - .05 : -0.28)).applyAxisAngle(new THREE.Vector3(0,1,0), a);
      desired = p.clone().add(seatOffset);
      camera.position.lerp(desired, 1 - Math.pow(0.00005, dt));
      const lookDir = new THREE.Vector3(-Math.sin(a)*Math.cos(pitch), Math.sin(pitch), -Math.cos(a)*Math.cos(pitch));
      camera.lookAt(camera.position.clone().add(lookDir.multiplyScalar(20)));
    } else {
      desired = new THREE.Vector3(p.x + Math.sin(a)*6.8, 3.8 + pitch*3.5, p.z + Math.cos(a)*6.8);
      camera.position.lerp(desired, 1 - Math.pow(0.0002, dt));
      camera.lookAt(target);
    }
    yaw = a;
  } else {
    if(Math.abs(camera.fov - fxFov) > 0.01) {
      camera.fov = THREE.MathUtils.damp(camera.fov, fxFov, 8, dt);
      camera.updateProjectionMatrix();
    }
    target = new THREE.Vector3(player.position.x, player.position.y + (cameraMode === 1 ? 1.65 : 1.3), player.position.z);
    if(cameraMode === 1) {
      camera.position.copy(target);
      const dir = new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch));
      camera.lookAt(target.clone().add(dir));
    } else {
      const distance = 6.5;
      desired = new THREE.Vector3(player.position.x + Math.sin(yaw)*distance, player.position.y + 2.8 - pitch*3, player.position.z + Math.cos(yaw)*distance);
      camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
      camera.lookAt(target);
    }
  }
  crosshair.style.display = (cameraMode === 1 && mouseLocked) ? 'block' : 'none';
}

// ============================================================================
// TELEMETRY HUD & LIVE CITY RADAR MINIMAP
// ============================================================================
function updateHUDAndRadar() {
  const focusPos = (inCar && activeCar) ? activeCar.root.position : player.position;
  const focusHeading = (inCar && activeCar) ? activeCar.root.rotation.y : yaw;

  if(inCar && activeCar) {
    const speedMs = Math.hypot(activeCar.vx, activeCar.vz);
    const kmh = Math.round(speedMs * 3.6);
    const fwdX = -Math.sin(activeCar.root.rotation.y), fwdZ = -Math.cos(activeCar.root.rotation.y);
    const fwdVel = activeCar.vx * fwdX + activeCar.vz * fwdZ;
    const gear = fwdVel < -0.5 ? 'R' : kmh === 0 ? 'N' : (activeCar.gear || Math.min(6, Math.floor(kmh / 24) + 1));
    speedEl.innerHTML = `${kmh} <small style="font-size:12px;color:#9fb2c1">KM/H</small>`;
    gearInfoEl.textContent = `GEAR ${gear}`;
    modeEl.textContent = `DRIVING · ${['', 'COCKPIT', 'THIRD PERSON', 'HOOD'][cameraMode]}`;
  } else {
    speedEl.innerHTML = `0 <small style="font-size:12px;color:#9fb2c1">KM/H</small>`;
    gearInfoEl.textContent = 'ON FOOT';
    modeEl.textContent = `${cameraMode === 1 ? 'FIRST' : 'THIRD'} PERSON`;
  }

  // Draw Live City Radar showing Highways, Avenues, Local Streets, Chunks & Cars
  const w = radarCanvas.width, h = radarCanvas.height;
  const scale = 0.42; // 1 meter = 0.42px (~350m diameter view)
  radarCtx.clearRect(0, 0, w, h);
  radarCtx.fillStyle = '#0c1520';
  radarCtx.fillRect(0, 0, w, h);

  radarCtx.save();
  radarCtx.translate(w/2, h/2);
  radarCtx.rotate(focusHeading); // Heading-up radar

  const centerCX = Math.round(focusPos.x / CHUNK_SIZE);
  const centerCZ = Math.round(focusPos.z / CHUNK_SIZE);

  // Draw surrounding chunks' districts & roads
  for(let dx = -2; dx <= 2; dx++) {
    for(let dz = -2; dz <= 2; dz++) {
      const cx = centerCX + dx;
      const cz = centerCZ + dz;
      const relX = (cx * CHUNK_SIZE - focusPos.x) * scale;
      const relZ = (cz * CHUNK_SIZE - focusPos.z) * scale;
      const sizePx = CHUNK_SIZE * scale;

      const distType = getChunkDistrict(cx, cz);
      radarCtx.fillStyle = distType === 'PARK' ? '#173326' : distType === 'DOWNTOWN' ? '#182433' : '#131d29';
      radarCtx.fillRect(relX - sizePx/2, relZ - sizePx/2, sizePx, sizePx);

      // Local streets
      radarCtx.fillStyle = '#334155';
      radarCtx.fillRect(relX - sizePx/2, relZ - 9*scale/2, sizePx, 9*scale);
      radarCtx.fillRect(relX - 9*scale/2, relZ - sizePx/2, 9*scale, sizePx);

      // West & North boundary avenues/highways
      const westW = getBoundaryHalfWidth(cx) * 2 * scale;
      const northW = getBoundaryHalfWidth(cz) * 2 * scale;
      radarCtx.fillStyle = getBoundaryRoadType(cx) === 'HIGHWAY' ? '#f59e0b' : '#64748b';
      radarCtx.fillRect(relX - sizePx/2 - westW/2, relZ - sizePx/2, westW, sizePx);

      radarCtx.fillStyle = getBoundaryRoadType(cz) === 'HIGHWAY' ? '#f59e0b' : '#64748b';
      radarCtx.fillRect(relX - sizePx/2, relZ - sizePx/2 - northW/2, sizePx, northW);
    }
  }

  // Draw Nearby Cars
  for(const c of cars) {
    if(c === activeCar) continue;
    const rx = (c.root.position.x - focusPos.x) * scale;
    const rz = (c.root.position.z - focusPos.z) * scale;
    radarCtx.fillStyle = '#38bdf8';
    radarCtx.beginPath();
    radarCtx.arc(rx, rz, 3.2, 0, Math.PI * 2);
    radarCtx.fill();
  }

  radarCtx.restore();

  // Player / Active Vehicle Center Arrow
  radarCtx.fillStyle = '#ffffff';
  radarCtx.beginPath();
  radarCtx.moveTo(w/2, h/2 - 6);
  radarCtx.lineTo(w/2 + 4.5, h/2 + 5);
  radarCtx.lineTo(w/2, h/2 + 2.5);
  radarCtx.lineTo(w/2 - 4.5, h/2 + 5);
  radarCtx.closePath();
  radarCtx.fill();
}


