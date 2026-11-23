'use strict';
// drive.js - gearbox (auto + manual), RPM, per-car handling, dials HUD, turning steering wheel
const GEAR_TOP = [.16, .30, .46, .64, .82, 1.0];   // share of top speed reachable in each gear
const GEAR_TQ  = [1.2, 1.1, 1.05, 1.0, .97, .94];  // torque by gear
const IDLE = 900, REDLINE = 7200;
let manualGears = false;
function driveTorque(c, fs, throttle, dt) {
  const top = c.top || 42, v = Math.abs(fs);
  if(c.gear === undefined) { c.gear = 1; c.rpm = IDLE; c.gearCap = 1; }
  if(fs < -.5) c.gear = 0; else if(c.gear === 0) c.gear = 1;
  if(c.gear > 0 && !manualGears) {
    const frac = v / top;
    if(c.gear < 6 && frac > GEAR_TOP[c.gear - 1] * .92) c.gear++;
    else if(c.gear > 1 && frac < GEAR_TOP[c.gear - 2] * .78) c.gear--;
  }
  c.gearCap = c.gear === 0 ? 1 : manualGears ? GEAR_TOP[c.gear - 1] : 1;
  const hi = c.gear > 0 ? GEAR_TOP[c.gear - 1] : .3;
  const target = IDLE + Math.min(1.05, v / (top * hi)) * (REDLINE - IDLE) * (throttle > 0 ? 1 : .94);
  c.rpm += (target - c.rpm) * Math.min(1, dt * 8);
  return c.gear > 0 ? GEAR_TQ[c.gear - 1] : 1;
}
addEventListener('keydown', e => {
  if(!running || chatOpen || e.repeat || e.target.tagName === 'INPUT' || !inCar || !activeCar) return;
  const c = activeCar;
  if(e.key === 'm' || e.key === 'M') { manualGears = !manualGears; toast(manualGears ? 'Manual gearbox: [ down, ] up' : 'Automatic gearbox'); }
  if(manualGears && c.gear !== undefined) { if(e.key === ']' && c.gear >= 1 && c.gear < 6) c.gear++; if(e.key === '[' && c.gear > 1) c.gear--; }
});
// ---- dials ----
const dials = document.createElement('canvas'); dials.width = 340; dials.height = 150;
dials.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:12;pointer-events:none;display:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))';
document.body.appendChild(dials); const dg = dials.getContext('2d');
function gauge(cx, cy, r, val, max, ticks, red, text, label) {
  const a0 = Math.PI * .8, a1 = Math.PI * 2.2, f = Math.min(1, val / max);
  dg.lineWidth = 7; dg.lineCap = 'round'; dg.strokeStyle = 'rgba(255,255,255,.16)'; dg.beginPath(); dg.arc(cx, cy, r, a0, a1); dg.stroke();
  dg.strokeStyle = red && f > .85 ? '#ff4d4d' : '#5ad1ff'; dg.beginPath(); dg.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); dg.stroke();
  dg.lineWidth = 2; dg.strokeStyle = 'rgba(255,255,255,.55)';
  for(let i = 0; i <= ticks; i++) { const a = a0 + (a1 - a0) * i / ticks; dg.beginPath(); dg.moveTo(cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13)); dg.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); dg.stroke(); }
  const an = a0 + (a1 - a0) * f; dg.lineWidth = 3; dg.strokeStyle = '#fff'; dg.beginPath(); dg.moveTo(cx, cy); dg.lineTo(cx + Math.cos(an) * (r - 16), cy + Math.sin(an) * (r - 16)); dg.stroke();
  dg.textAlign = 'center'; dg.fillStyle = '#fff'; dg.font = 'bold 22px sans-serif'; dg.fillText(text, cx, cy + 32); dg.fillStyle = '#9fb2c1'; dg.font = '11px sans-serif'; dg.fillText(label, cx, cy + 46);
}
function driveFrame(dt) {
  for(const c of cars) if(c.sw) c.sw.rotation.z = -c.steerAngle * 2.6;
  const on = inCar && activeCar && activeCar.gear !== undefined;
  dials.style.display = on ? 'block' : 'none'; if(!on) return;
  const c = activeCar, kmh = Math.round(Math.hypot(c.vx, c.vz) * 3.6);
  dg.clearRect(0, 0, 340, 150);
  gauge(80, 68, 56, kmh, 260, 13, false, kmh, 'KM/H');
  gauge(260, 68, 56, c.rpm, 8000, 8, c.rpm > 6600, (c.rpm / 1000).toFixed(1), 'x1000 RPM');
  dg.textAlign = 'center'; dg.fillStyle = '#fff'; dg.font = 'bold 44px sans-serif';
  dg.fillText(c.gear === 0 ? 'R' : kmh === 0 ? 'N' : c.gear, 170, 76);
  dg.fillStyle = '#9fb2c1'; dg.font = '11px sans-serif'; dg.fillText(manualGears ? 'MANUAL  [ ]' : 'AUTO  (M)', 170, 98);
}


// ============================================================================
// WORKING MIRRORS (rear-view + side mirrors in the cockpit and hood cameras)
// Each mirror renders the scene from behind the car into a small render target, which is then drawn flipped (like a real mirror).
// Mirrors update on a rotating schedule so the extra cost stays low. Toggle in Settings.
// ============================================================================
const MIR = {ok:true, k:0, rt:[], quad:null, quadCam:null, defs:null};
function mirrorInit() {
  const sizes = [[384, 96], [128, 96], [128, 96]];
  MIR.rt = sizes.map(([w, h]) => new THREE.WebGLRenderTarget(w, h, {colorSpace:THREE.SRGBColorSpace}));
  MIR.cams = sizes.map(() => new THREE.PerspectiveCamera(60, 4, .4, 420));
  MIR.cams[1].aspect = MIR.cams[2].aspect = 128 / 96;
  MIR.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); MIR.quadScene = new THREE.Scene();
  MIR.mat = new THREE.ShaderMaterial({uniforms:{t:{value:null}}, depthTest:false, depthWrite:false, toneMapped:false,
    vertexShader:'varying vec2 vUv; void main(){ vUv = vec2(1. - uv.x, uv.y); gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader:'uniform sampler2D t; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv); vec2 d = abs(vUv - .5) * 2.; float vig = 1. - .35 * pow(max(d.x, d.y), 4.); gl_FragColor = vec4(c.rgb * vig, 1.); }'});
  MIR.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), MIR.mat); MIR.quad.frustumCulled = false; MIR.quadScene.add(MIR.quad);
}
function mirrorRender() {
  if(!S.mirrors || !MIR.ok || !inCar || !activeCar || (cameraMode !== 1 && cameraMode !== 3) || S.quality < 1) return;
  try {
    if(!MIR.rt.length) mirrorInit();
    const c = activeCar, D = c.D || {}, h = c.root.rotation.y, fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), p = c.root.position, hy = (D.belt || 1) + .45, L = (D.L || 4.4) / 2, W = (D.W || 2.1) / 2;
    const idx = MIR.k++ % 3, rt = MIR.rt[idx], cam = MIR.cams[idx];
    // rear-view mirror sits behind the car looking back; side mirrors sit outside the doors looking back and slightly out
    if(idx === 0) { cam.position.set(p.x - fx * (L + .3), hy + .15, p.z - fz * (L + .3)); cam.lookAt(p.x - fx * (L + 40), hy, p.z - fz * (L + 40)); }
    else { const s = idx === 1 ? -1 : 1; cam.position.set(p.x + rx * s * (W + .1) + fx * .4, hy, p.z + rz * s * (W + .1) + fz * .4); cam.lookAt(cam.position.x - fx * 30 + rx * s * 7, hy, cam.position.z - fz * 30 + rz * s * 7); }
    const pv = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = pv;
    // draw all three mirrors every frame from their latest render target
    const W0 = innerWidth, H0 = innerHeight, rects = [[W0 / 2 - 190, H0 - 70, 380, 60], [14, H0 * .42, 110, 82], [W0 - 124, H0 * .42, 110, 82]];
    const sc = renderer.getScissorTest(), ao = renderer.autoClear; renderer.autoClear = false; renderer.setScissorTest(true);
    MIR.ready = MIR.ready || [false, false, false]; MIR.ready[idx] = true;
    for(let i = 0; i < 3; i++) { if(!MIR.ready[i]) continue; const r = rects[i]; renderer.setViewport(r[0], H0 - r[1] - r[3], r[2], r[3]); renderer.setScissor(r[0], H0 - r[1] - r[3], r[2], r[3]); MIR.mat.uniforms.t.value = MIR.rt[i].texture; renderer.render(MIR.quadScene, MIR.quadCam); }
    renderer.setScissorTest(sc); renderer.autoClear = ao; renderer.setViewport(0, 0, W0, H0);
  } catch(e) { console.warn('Mirrors disabled', e); MIR.ok = false; renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.shadowMap.autoUpdate = true; }
}
