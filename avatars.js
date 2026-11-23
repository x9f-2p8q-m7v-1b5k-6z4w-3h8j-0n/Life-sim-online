'use strict';
// avatars.js - Better avatars.
//  * "Citizen" avatar: built like the new pedestrians (same proportions, merged meshes) with outfit choice
//  * the original detailed character is still available as the "Classic" style
//  * walking / crouching / emote animations, shown to other players too (appearance + emote ride along in the network state)
//  * Outfit panel (button, top-left) and emote bar (G, then 1-6)

const AV_SHOES = [0x1a1a1a, 0xe8e8e8, 0x7a4a2a, 0xc92a2a], AV_HATS = ['None', 'Cap', 'Beanie'], AV_HATC = [0x2b6cb0, 0xc92a2a, 0x2b8a3e, 0x343a40, 0xf08c00];
const AV_EMOTES = [[1, 'Wave', '👋'], [2, 'Dance', '🕺'], [3, 'Clap', '👏'], [4, 'Point', '👉'], [5, 'Cheer', '🙌'], [6, 'Sit', '🪑']];
const AV = {ap:{s:0, sk:0, hr:1, sh:0, pt:0, so:0, ht:0, fm:0}, cit:null, emote:0, emoteT:0, bar:null};
try { const sv = JSON.parse(localStorage.getItem('lifesimAvatar')); if(sv && typeof sv === 'object') Object.assign(AV.ap, sv); } catch(e) {}
if(!localStorage.getItem('lifesimAvatar')) { const r = n => Math.floor(Math.random() * n); AV.ap = {s:0, sk:r(SKIN.length), hr:r(HAIR.length), sh:r(SHIRT.length), pt:r(PANTS.length), so:r(AV_SHOES.length), ht:0, fm:r(2)}; }
const avClamp = ap => { const m = (v, n) => Math.max(0, Math.min(n - 1, v | 0)); return {s:m(ap.s, 2), sk:m(ap.sk, SKIN.length), hr:m(ap.hr, HAIR.length), sh:m(ap.sh, SHIRT.length), pt:m(ap.pt, PANTS.length), so:m(ap.so, AV_SHOES.length), ht:m(ap.ht, 3), fm:m(ap.fm, 2)}; };
function avKey(ap) { return [ap.s, ap.sk, ap.hr, ap.sh, ap.pt, ap.so, ap.ht, ap.fm].join('.'); }

// ---- builder (same construction as makePed, with a hip pivot so the torso can lean/crouch) ----
function avBuild(apIn) {
  const ap = avClamp(apIn), skin = SKIN[ap.sk], hair = HAIR[ap.hr], shirt = SHIRT[ap.sh], pants = PANTS[ap.pt], shoe = AV_SHOES[ap.so], fem = !!ap.fm, hatC = AV_HATC[(ap.sh + ap.pt) % AV_HATC.length];
  const g = new THREE.Group(), inner = new THREE.Group(); inner.rotation.y = Math.PI; g.add(inner);
  const hip = new THREE.Group(); hip.position.y = .95; inner.add(hip);
  const Y = y => y - .95, body = [
    pc(new THREE.CapsuleGeometry(.15, .3, 4, 10), shirt, 0, Y(1.3), 0, fem ? 1.05 : 1.2, 1, .72),
    pc(new THREE.CapsuleGeometry(.15, .1, 4, 10), pants, 0, Y(.98), 0, fem ? 1.15 : 1.12, 1, .74),
    pc(new THREE.CylinderGeometry(.045, .05, .1, 8), skin, 0, Y(1.58), 0),
    pc(new THREE.SphereGeometry(.105, 14, 12), skin, 0, Y(1.7), 0, .9, 1.12, 1),
    pc(new THREE.SphereGeometry(.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * .45), hair, 0, Y(1.72), -.012, .95, 1.12, 1.05),
    pc(new THREE.SphereGeometry(.015, 6, 4), 0x15110e, -.04, Y(1.71), .09), pc(new THREE.SphereGeometry(.015, 6, 4), 0x15110e, .04, Y(1.71), .09)
  ];
  if(fem) body.push(pc(new THREE.CapsuleGeometry(.11, .2, 4, 8), hair, 0, Y(1.62), -.07, 1, 1, .7));
  if(ap.ht === 1) body.push(pc(new THREE.SphereGeometry(.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * .5), hatC, 0, Y(1.74), 0, 1, .9, 1.02), pc(new THREE.BoxGeometry(.2, .018, .12), hatC, 0, Y(1.745), .13));
  if(ap.ht === 2) body.push(pc(new THREE.SphereGeometry(.125, 12, 10, 0, Math.PI * 2, 0, Math.PI * .62), hatC, 0, Y(1.73), 0, 1, 1.1, 1.05));
  hip.add(new THREE.Mesh(pdMerge(body), pdMat));
  const limb = (parent, x, y, geos) => { const p = new THREE.Group(); p.position.set(x, y, 0); p.add(new THREE.Mesh(pdMerge(geos), pdMat)); parent.add(p); return p; };
  const leg = s => limb(inner, s * .09, .93, [pc(new THREE.CylinderGeometry(.075, .055, .84, 10), pants, 0, -.42, 0), pc(new THREE.BoxGeometry(.1, .07, .27), shoe, 0, -.875, .05)]);
  const longS = ap.sh % 2 === 0;
  const arm = s => limb(hip, s * .2, Y(1.44), [pc(new THREE.CylinderGeometry(.05, .045, .3, 8), shirt, 0, -.15, 0), pc(new THREE.CylinderGeometry(.042, .036, .27, 8).translate(0, -.135, 0).rotateX(-.35), longS ? shirt : skin, 0, -.3, 0), pc(new THREE.SphereGeometry(.04, 8, 6), skin, 0, -.58, .05)]);
  g.traverse(o => { if(o.isMesh) { o.castShadow = true; } });
  const P = {inner, hip, lL:leg(-1), lR:leg(1), aL:arm(-1), aR:arm(1), ph:0, spd:0};
  g.traverse(o => { if(o.isMesh) o.castShadow = true; });
  return {g, P};
}
function avDisposeModel(c) { if(!c) return; c.g.traverse(o => { if(o.isMesh && o.geometry) o.geometry.dispose(); }); if(c.g.parent) c.g.parent.remove(c.g); }

// ---- animation shared by local + remote avatars ----
function avAnimate(P, dt, speed, crouch, em, emStart) {
  const D = THREE.MathUtils.damp, now = performance.now() / 1000, et = em ? now - emStart : 0;
  P.ph += Math.min(speed, 7) * dt * 1.6; P.spd = D(P.spd, Math.min(1, speed / 2.2), 10, dt);
  const sw = Math.sin(P.ph * 2.6) * .75 * P.spd * (crouch ? .6 : 1);
  let lL = sw, lR = -sw, aLx = -sw * .85, aRx = sw * .85, aLz = 0, aRz = 0, hipX = 0, drop = 0, spin = 0, bob = Math.abs(Math.sin(P.ph * 2.6)) * .045 * P.spd;
  if(crouch) { hipX = .32; drop = .3; lL -= .55; lR -= .55; aLx += .3; aRx += .3; }
  if(em && speed < .3) {
    bob = 0; lL = lR = aLx = aRx = 0;
    if(em === 1) { aRz = 2.6 + Math.sin(et * 10) * .35; aRx = 0; }
    else if(em === 2) { const b = Math.sin(et * 9); lL = b * .5; lR = -b * .5; aLz = -2.2 - b * .5; aRz = 2.2 - b * .5; aLx = aRx = 0; bob = Math.abs(b) * .1; spin = Math.sin(et * 4.5) * .35; hipX = Math.sin(et * 9) * .08; }
    else if(em === 3) { aLx = aRx = -1.35; aLz = -.25 + Math.sin(et * 15) * .25; aRz = .25 - Math.sin(et * 15) * .25; }
    else if(em === 4) { aRx = -1.55; aRz = .15; }
    else if(em === 5) { aLz = -2.9; aRz = 2.9; bob = Math.abs(Math.sin(et * 8)) * .16; lL = Math.sin(et * 8) * .2; lR = -lL; }
    else if(em === 6) { lL = lR = -1.45; aLx = aRx = -.5; drop = .5; hipX = -.05; }
  }
  P.lL.rotation.x = D(P.lL.rotation.x, lL, 16, dt); P.lR.rotation.x = D(P.lR.rotation.x, lR, 16, dt);
  P.aL.rotation.x = D(P.aL.rotation.x, aLx, 16, dt); P.aR.rotation.x = D(P.aR.rotation.x, aRx, 16, dt);
  P.aL.rotation.z = D(P.aL.rotation.z, aLz, 16, dt); P.aR.rotation.z = D(P.aR.rotation.z, aRz, 16, dt);
  P.hip.rotation.x = D(P.hip.rotation.x, hipX, 12, dt); P.inner.position.y = D(P.inner.position.y, bob - drop, 14, dt);
  P.inner.rotation.y = Math.PI + D(P.inner.rotation.y - Math.PI, spin, 10, dt);
}

// ---- local avatar ----
function avatarSetLocal() {
  avDisposeModel(AV.cit); AV.cit = null;
  AV.ap = avClamp(AV.ap); try { localStorage.setItem('lifesimAvatar', JSON.stringify(AV.ap)); } catch(e) {}
  if(AV.ap.s === 0) { AV.cit = avBuild(AV.ap); player.add(AV.cit.g); }
}
function avatarApplyVisibility(vis) { playerModel.visible = vis && AV.ap.s === 1; if(AV.cit) AV.cit.g.visible = vis; }
function avatarState() { const a = AV.ap; return [a.s, a.sk, a.hr, a.sh, a.pt, a.so, a.ht, a.fm]; }
function avatarEmoteState() { return AV.emote ? [AV.emote, AV.emoteT] : 0; }
let avLast = {x:0, z:0};
function avatarLocalAnim(dt, len, crouch) {
  if(len > .05 && AV.emote) AV.emote = 0;
  if(AV.cit) avAnimate(AV.cit.P, dt, len > .05 ? (keys.shift ? 2.6 : 5.8) : 0, crouch, AV.emote, AV.emoteT / 1000);
  else if(AV.emote) { // classic character: arms only
    const t = (performance.now() - AV.emoteT) / 1000, A0 = characterRig.armPivots; const set = (i, x, z) => { A0[i].rotation.x = x; A0[i].rotation.z = z; };
    if(AV.emote === 1) set(1, 0, 2.6 + Math.sin(t * 10) * .35); else if(AV.emote === 2) { const b = Math.sin(t * 9); set(0, 0, -2.2 - b * .5); set(1, 0, 2.2 - b * .5); } else if(AV.emote === 3) { set(0, -1.35, -.25 + Math.sin(t * 15) * .25); set(1, -1.35, .25 - Math.sin(t * 15) * .25); } else if(AV.emote === 4) set(1, -1.55, 0); else if(AV.emote === 5) { set(0, 0, -2.9); set(1, 0, 2.9); }
  } else for(const a of characterRig.armPivots) a.rotation.z = THREE.MathUtils.damp(a.rotation.z, 0, 12, dt);
}
function avatarEmote(id) {
  if(inCar || chatOpen) return; AV.emote = AV.emote === id ? 0 : id; AV.emoteT = performance.now(); if(AV.emote) toast(AV_EMOTES.find(e => e[0] === id)[1] + ' - move to stop');
}

// ---- remote avatars (called from net.js) ----
function avatarApplyRemote(rec, st) {
  if(Array.isArray(st.ap)) {
    const ap = avClamp({s:st.ap[0], sk:st.ap[1], hr:st.ap[2], sh:st.ap[3], pt:st.ap[4], so:st.ap[5], ht:st.ap[6], fm:st.ap[7]}), key = avKey(ap);
    if(key !== rec.apKey) {
      rec.apKey = key; avDisposeModel(rec.cit); rec.cit = null;
      if(ap.s === 0) { rec.cit = avBuild(ap); rec.group.add(rec.cit.g); rec.model.visible = false; } else rec.model.visible = true;
    }
  }
  rec.em = Array.isArray(st.em) ? st.em : 0;
}
function avatarRemoteUpdate(rec, s, dt) {
  const p = rec.group.position, lp = rec.lp || (rec.lp = {x:p.x, z:p.z}), spd = Math.hypot(p.x - lp.x, p.z - lp.z) / Math.max(dt, .001); lp.x = p.x; lp.z = p.z;
  rec.spd = THREE.MathUtils.damp(rec.spd || 0, Math.min(spd, 8), 8, dt);
  if(rec.cit) { rec.model.visible = false; avAnimate(rec.cit.P, dt, rec.spd, !!s.crouching, rec.em ? rec.em[0] : 0, rec.em ? rec.em[1] / 1000 : 0); }
  else if(rec.model) { // classic remote: swing legs/arms while walking
    const t = performance.now() / 1000, sw = Math.sin(t * 10) * .6 * Math.min(1, rec.spd / 3);
    for(let i = 0; i < 2; i++) { const leg = rec.model.getObjectByName('crouchLeg' + i), arm = rec.model.getObjectByName('armPivot' + i); if(leg && !s.crouching) leg.rotation.x = i ? -sw : sw; if(arm) { arm.rotation.x = i ? sw * .6 : -sw * .6; const em = rec.em ? rec.em[0] : 0; arm.rotation.z = em === 1 && i === 1 ? 2.6 + Math.sin(t * 10) * .35 : em === 5 ? (i ? 2.9 : -2.9) : 0; } }
  }
}
function avatarDispose(rec) { avDisposeModel(rec.cit); rec.cit = null; }

// ---- UI: outfit panel + emote bar ----
(function() {
  const css = document.createElement('style');
  css.textContent = '.av-btn{position:fixed;left:16px;z-index:5;padding:8px 12px;border:1px solid #ffffff25;border-radius:10px;background:#0a111bdc;color:#c9d9e5;font:700 11px Inter,Arial,sans-serif;letter-spacing:.06em;cursor:pointer}.av-btn:hover{background:#12202f}' +
    '#avPanel{position:fixed;left:16px;top:176px;z-index:7;width:268px;padding:14px;border:1px solid #ffffff30;border-radius:14px;background:#0a111bf2;color:#dfe9f0;font:12px Inter,Arial,sans-serif;display:none;box-shadow:0 14px 40px #000a}#avPanel h4{margin:10px 0 6px;font-size:10px;letter-spacing:.12em;color:#8fa6b8}' +
    '.av-sw{display:inline-block;width:22px;height:22px;margin:0 5px 5px 0;border-radius:50%;border:2px solid transparent;cursor:pointer;box-sizing:border-box}.av-sw.on{border-color:#fff}.av-ch{display:inline-block;padding:6px 10px;margin:0 6px 6px 0;border:1px solid #ffffff30;border-radius:8px;cursor:pointer}.av-ch.on{background:#55df9a;color:#04210f;border-color:#55df9a}' +
    '#avBar{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:7;display:none;gap:8px;padding:10px;border:1px solid #ffffff30;border-radius:14px;background:#0a111bf2}#avBar div{padding:8px 10px;border-radius:10px;background:#16263a;color:#e6eef4;font:700 12px Inter,Arial,sans-serif;cursor:pointer;text-align:center}#avBar div:hover{background:#1f3a58}#avBar small{display:block;opacity:.6;font-size:9px}';
  document.head.appendChild(css);
  const mk = (txt, top, fn) => { const b = document.createElement('div'); b.className = 'av-btn'; b.style.top = top + 'px'; b.textContent = txt; b.onclick = fn; document.body.appendChild(b); return b; };
  const panel = document.createElement('div'); panel.id = 'avPanel'; document.body.appendChild(panel);
  const swatches = (title, key, list) => { let h = `<h4>${title}</h4>`; list.forEach((c, i) => h += `<span class="av-sw ${AV.ap[key] === i ? 'on' : ''}" data-k="${key}" data-v="${i}" style="background:#${c.toString(16).padStart(6, '0')}"></span>`); return h; };
  const choices = (title, key, list) => { let h = `<h4>${title}</h4>`; list.forEach((c, i) => h += `<span class="av-ch ${AV.ap[key] === i ? 'on' : ''}" data-k="${key}" data-v="${i}">${c}</span>`); return h; };
  function render() {
    panel.innerHTML = '<b style="letter-spacing:.1em">OUTFIT</b>' + choices('STYLE', 's', ['Citizen', 'Classic']) + (AV.ap.s === 0 ? choices('BUILD', 'fm', ['A', 'B']) + swatches('SKIN', 'sk', SKIN) + swatches('HAIR', 'hr', HAIR) + swatches('SHIRT', 'sh', SHIRT) + swatches('PANTS', 'pt', PANTS) + swatches('SHOES', 'so', AV_SHOES) + choices('HAT', 'ht', AV_HATS) : '<div style="margin-top:10px;color:#8fa6b8">The original detailed character.</div>');
    panel.querySelectorAll('[data-k]').forEach(el => el.onclick = () => { AV.ap[el.dataset.k] = +el.dataset.v; avatarSetLocal(); render(); });
  }
  mk('👕 OUTFIT', 130, () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; render(); });
  mk('🕺 EMOTES (G)', 158, () => toggleBar());
  const bar = document.createElement('div'); bar.id = 'avBar'; AV.bar = bar; document.body.appendChild(bar);
  AV_EMOTES.forEach(([id, name, ic], i) => { const d = document.createElement('div'); d.innerHTML = `${ic}<br>${name}<small>${i + 1}</small>`; d.onclick = () => { avatarEmote(id); bar.style.display = 'none'; }; bar.appendChild(d); });
  function toggleBar() { bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex'; }
  addEventListener('keydown', e => {
    if(!running || chatOpen || e.target.tagName === 'INPUT' || e.repeat) return;
    const k = e.key.toLowerCase();
    if(k === 'g' && !inCar) toggleBar();
    else if(bar.style.display === 'flex' && k >= '1' && k <= '6') { avatarEmote(+k); bar.style.display = 'none'; }
  });
})();
avatarSetLocal();
